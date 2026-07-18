'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  buildGrammarLessonPrompt,
  grammarLessonResponseSchema,
  japaneseLevelFromKnownWords,
  parseJsonText,
  scheduleGrammarResult,
  selectGrammarQueue,
  type GrammarPromptItem,
  type LessonVocabulary,
} from '@/lib/grammar-coach';
import { tokenizePassage } from '@/lib/speed-reading';

function grammarData(value: unknown) {
  const data = value as Record<string, unknown>;
  return {
    pattern: String(data.pattern ?? ''),
    meaning: String(data.meaning ?? ''),
    jlptLevel: String(data.jlptLevel ?? ''),
    examples: Array.isArray(data.examples) ? data.examples.filter((item): item is string => typeof item === 'string') : [],
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

async function lessonVocabulary(courseId: string): Promise<LessonVocabulary[]> {
  const leeches = await prisma.ankiCardSnapshot.findMany({
    where: { isLeech: true, mapping: { courseId } },
    orderBy: [{ lapses: 'desc' }, { ease: 'asc' }],
    take: 8,
  });
  if (leeches.length) {
    return leeches.map((card) => ({ source: 'anki-leech', term: card.front, meaning: card.back, lapses: card.lapses }));
  }

  const known = await prisma.knownWord.findMany({
    where: { language: 'ja' },
    orderBy: { createdAt: 'desc' },
    distinct: ['looseKey'],
    take: 12,
  });
  return known.map((word) => ({ source: 'known-word', term: word.surface }));
}

export async function generateGrammarLessonAction() {
  const now = new Date();
  const existing = await prisma.grammarLesson.findFirst({
    where: { status: 'GENERATED' },
    orderBy: { scheduledFor: 'desc' },
  });

  const course = await prisma.course.findUniqueOrThrow({ where: { slug: 'japanese' } });
  const progress = await prisma.grammarProgress.findMany({ include: { learningItem: true }, orderBy: { curriculumOrder: 'asc' } });
  const selected = selectGrammarQueue(progress, now);
  const selectedIds = [...selected.reviewIds, ...selected.newIds];
  if (!selectedIds.length) {
    revalidatePath('/japanese/grammar');
    return;
  }

  const byId = new Map(progress.map((row) => [row.learningItemId, row]));
  const items: GrammarPromptItem[] = selectedIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Missing grammar item ${id}.`);
    return { learningItemId: id, kind: selected.newIds.includes(id) ? 'new' : 'review', ...grammarData(row.learningItem.data) };
  });
  const wordStat = await prisma.knownWordStat.findFirst({ where: { language: 'ja' }, orderBy: { date: 'desc' } });
  const knownWords = wordStat?.lower ?? 0;
  const vocabulary = await lessonVocabulary(course.id);
  const lessonId = existing?.id ?? crypto.randomUUID();
  const levelLabel = japaneseLevelFromKnownWords(knownWords);
  const prompt = buildGrammarLessonPrompt({ lessonId, levelLabel, knownWords, items, vocabulary });

  const lessonData = {
    scheduledFor: now,
    levelLabel,
    prompt,
    grammarItemIds: selectedIds,
    vocabulary: JSON.parse(JSON.stringify(vocabulary)),
  };
  if (existing) await prisma.grammarLesson.update({ where: { id: existing.id }, data: lessonData });
  else await prisma.grammarLesson.create({ data: { id: lessonId, ...lessonData } });
  revalidatePath('/japanese/grammar');
}

export async function importGrammarLessonResponseAction(input: string) {
  try {
    const response = grammarLessonResponseSchema.parse(parseJsonText(input));
    const lesson = await prisma.grammarLesson.findUnique({ where: { id: response.lessonId } });
    if (!lesson) return { ok: false as const, error: 'That lesson ID does not exist.' };
    if (lesson.status === 'COMPLETED') return { ok: false as const, error: 'That lesson was already imported.' };

    const expectedIds = Array.isArray(lesson.grammarItemIds)
      ? lesson.grammarItemIds.filter((id): id is string => typeof id === 'string')
      : [];
    const resultIds = response.grammarResults.map((result) => result.learningItemId);
    const uniqueResultIds = new Set(resultIds);
    if (uniqueResultIds.size !== resultIds.length || expectedIds.length !== resultIds.length || expectedIds.some((id) => !uniqueResultIds.has(id))) {
      return { ok: false as const, error: 'The JSON must contain exactly one result for every scheduled grammar point.' };
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const result of response.grammarResults) {
        const current = await tx.grammarProgress.findUniqueOrThrow({ where: { learningItemId: result.learningItemId } });
        const scheduled = scheduleGrammarResult({
          status: current.status,
          ease: current.ease,
          intervalDays: current.intervalDays,
          repetitions: current.repetitions,
          lapseCount: current.lapseCount,
          isLeech: current.isLeech,
        }, result.rating, result.masteredOnPlacement, now);
        const next = scheduled.next;
        await tx.grammarProgress.update({
          where: { id: current.id },
          data: {
            status: scheduled.status,
            ease: next.ease,
            intervalDays: next.intervalDays,
            dueAt: next.dueAt,
            repetitions: next.repetitions,
            lapseCount: next.lapseCount,
            isLeech: next.isLeech,
            introducedAt: current.introducedAt ?? now,
            lastStudiedAt: now,
            lastRating: result.rating,
            totalCorrect: { increment: Math.min(result.correct, result.total) },
            totalQuestions: { increment: result.total },
          },
        });
      }

      if (response.speedReadingPassage) {
        const passage = response.speedReadingPassage;
        await tx.speedReadingPassage.create({
          data: {
            title: passage.title,
            topic: passage.topic,
            category: passage.category,
            difficulty: passage.difficulty,
            sourceUrl: passage.sourceUrl,
            text: passage.text,
            wordCount: tokenizePassage(passage.text).length,
            questions: passage.questions,
            answerKey: passage.answerKey,
            source: 'grammar-lesson',
          },
        });
      }

      await tx.grammarLesson.update({ where: { id: lesson.id }, data: { status: 'COMPLETED', response, completedAt: now } });
    });
    revalidatePath('/japanese/grammar');
    revalidatePath('/japanese');
    revalidatePath('/daily');
    revalidatePath('/');
    revalidatePath('/speed-reading');
    return { ok: true as const, updated: response.grammarResults.length, passageCreated: Boolean(response.speedReadingPassage) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not import the lesson JSON.' };
  }
}
