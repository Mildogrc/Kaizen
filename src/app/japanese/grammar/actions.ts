'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { japaneseGrammarConfiguration, japaneseGrammarTutorConfiguration } from '@/lib/app-settings';
import { GRAMMAR_IMPORT_REFRESH_PATHS } from '@/lib/grammar-import';
import {
  buildGrammarLessonPrompt,
  classifyGrammarLessonImport,
  grammarResultScheduleError,
  grammarLessonResponseSchema,
  grammarRatingSubmissionSchema,
  grammarResultFromAppRating,
  japaneseLevelFromKnownWords,
  parseJsonText,
  scheduleGrammarResult,
  selectDailyGrammarVocabulary,
  selectGrammarQueue,
  type GrammarPromptItem,
  type LessonVocabulary,
} from '@/lib/grammar-coach';
import { tokenizePassage } from '@/lib/speed-reading';

class GrammarImportError extends Error {}

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

async function lessonVocabulary(itemCount: number, now: Date): Promise<LessonVocabulary[]> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [knownWords, recentLessons] = await Promise.all([
    prisma.knownWord.findMany({
      where: { language: 'ja', source: { in: ['anki', 'migaku'] } },
      select: { surface: true, lemma: true, reading: true, strictKey: true, source: true },
    }),
    prisma.grammarLesson.findMany({
      where: { scheduledFor: { lt: today } },
      orderBy: { scheduledFor: 'desc' },
      take: 7,
      select: { vocabulary: true },
    }),
  ]);
  const recentlyUsed = new Set<string>();
  for (const lesson of recentLessons) {
    if (!Array.isArray(lesson.vocabulary)) continue;
    for (const value of lesson.vocabulary) {
      if (!value || typeof value !== 'object') continue;
      const word = value as Record<string, unknown>;
      if (typeof word.key === 'string') recentlyUsed.add(word.key);
      if (typeof word.term === 'string') recentlyUsed.add(`term:${word.term}`);
    }
  }
  const candidates: LessonVocabulary[] = knownWords.map((word) => ({
    source: word.source === 'anki' ? 'anki-mature' : 'migaku',
    term: word.surface || word.lemma,
    reading: word.reading ?? undefined,
    key: word.strictKey,
  }));
  const freshCandidates = candidates.filter((word) => !recentlyUsed.has(word.key ?? '') && !recentlyUsed.has(`term:${word.term}`));
  const requiredCount = itemCount * 3;
  const pool = freshCandidates.length >= requiredCount ? freshCandidates : candidates;
  return selectDailyGrammarVocabulary(pool, requiredCount, now);
}

export async function generateGrammarLessonAction() {
  const now = new Date();
  const generatedLessons = await prisma.grammarLesson.findMany({
    where: { status: 'GENERATED' },
    orderBy: { scheduledFor: 'desc' },
  });
  const existing = generatedLessons[0] ?? null;

  const [progress, user] = await Promise.all([
    prisma.grammarProgress.findMany({ include: { learningItem: true }, orderBy: { curriculumOrder: 'asc' } }),
    prisma.user.findFirst({ select: { settings: true } }),
  ]);
  const grammarConfiguration = japaneseGrammarConfiguration(user?.settings);
  const selected = selectGrammarQueue(progress, now, grammarConfiguration);
  const selectedIds = [...selected.reviewIds, ...selected.newIds];
  if (!selectedIds.length) {
    await prisma.grammarLesson.updateMany({
      where: { status: 'GENERATED' },
      data: { status: 'COMPLETED', completedAt: now },
    });
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
  const vocabulary = await lessonVocabulary(items.length, now);
  const lessonId = existing?.id ?? crypto.randomUUID();
  const levelLabel = japaneseLevelFromKnownWords(knownWords);
  const prompt = buildGrammarLessonPrompt({ lessonId, levelLabel, knownWords, items, vocabulary, newGrammarSchedule: grammarConfiguration });

  const lessonData = {
    scheduledFor: now,
    levelLabel,
    prompt,
    grammarItemIds: selectedIds,
    vocabulary: JSON.parse(JSON.stringify(vocabulary)),
  };
  await prisma.$transaction([
    existing
      ? prisma.grammarLesson.update({ where: { id: existing.id }, data: lessonData })
      : prisma.grammarLesson.create({ data: { id: lessonId, ...lessonData } }),
    prisma.grammarLesson.updateMany({
      where: { status: 'GENERATED', id: { not: existing?.id ?? lessonId } },
      data: { status: 'COMPLETED', completedAt: now },
    }),
  ]);
  revalidatePath('/japanese/grammar');
}

export async function updateGrammarTutorConfigurationAction(formData: FormData) {
  const user = await prisma.user.findFirst();
  if (!user) return;
  const currentSettings = user.settings && typeof user.settings === 'object'
    ? user.settings as Record<string, unknown>
    : {};
  const submittedIds = [...new Set(formData.getAll('learningItemId')
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  const validRows = submittedIds.length
    ? await prisma.grammarProgress.findMany({
        where: { learningItemId: { in: submittedIds } },
        select: { learningItemId: true },
      })
    : [];
  const validIds = new Set(validRows.map((row) => row.learningItemId));
  const itemOverrides = Object.fromEntries(submittedIds.flatMap((learningItemId) => {
    if (!validIds.has(learningItemId)) return [];
    const missRateValue = formData.get(`missRatePercent:${learningItemId}`);
    const missRateText = typeof missRateValue === 'string' ? missRateValue.trim() : '';
    const excluded = formData.get(`excluded:${learningItemId}`) === 'on';
    const override: { missRatePercent?: string; excluded?: boolean } = {};
    if (missRateText) override.missRatePercent = missRateText;
    if (excluded) override.excluded = true;
    return Object.keys(override).length ? [[learningItemId, override]] : [];
  }));
  const configuration = japaneseGrammarTutorConfiguration({
    japaneseGrammarTutor: {
      planSize: formData.get('planSize'),
      itemOverrides,
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { settings: JSON.parse(JSON.stringify({ ...currentSettings, japaneseGrammarTutor: configuration })) },
  });
  revalidatePath('/japanese/grammar');
}

export async function importGrammarLessonResponseAction(input: string) {
  let parsed: unknown;
  try {
    parsed = parseJsonText(input);
  } catch {
    return { ok: false as const, error: 'Invalid JSON. Check the commas, quotation marks, and closing braces, then try again.' };
  }
  const validation = grammarLessonResponseSchema.safeParse(parsed);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    const field = issue.path.length ? issue.path.map(String).join('.') : 'lesson JSON';
    return { ok: false as const, error: `Invalid lesson result at ${field}: ${issue.message}` };
  }
  const response = validation.data;
  const responseJson = JSON.parse(JSON.stringify(response));

  let outcome: { duplicate: boolean; updated: number; passageCreated: boolean };
  try {
    const now = new Date();
    outcome = await prisma.$transaction(async (tx) => {
      const lesson = await tx.grammarLesson.findUnique({ where: { id: response.lessonId } });
      if (!lesson) throw new GrammarImportError('No lesson matches this lessonId. Generate a current lesson and use the JSON returned for that lesson.');

      const expectedIds = Array.isArray(lesson.grammarItemIds)
        ? lesson.grammarItemIds.filter((id): id is string => typeof id === 'string')
        : [];
      const scheduledProgress = await tx.grammarProgress.findMany({
        where: { learningItemId: { in: expectedIds } },
      });
      const progressByLearningItemId = new Map(scheduledProgress.map((item) => [item.learningItemId, item]));
      if (scheduledProgress.length !== expectedIds.length) {
        throw new GrammarImportError('One or more scheduled grammar items no longer exist. Refresh Grammar Coach to generate a current lesson.');
      }
      const scheduledItems = expectedIds.map((learningItemId) => ({
        learningItemId,
        scheduledType: progressByLearningItemId.get(learningItemId)?.status === 'NEW' ? 'NEW' as const : 'REVIEW' as const,
      }));
      const scheduleError = grammarResultScheduleError(response.grammarResults, scheduledItems);
      if (scheduleError) throw new GrammarImportError(scheduleError);

      if (lesson.status === 'COMPLETED') {
        if (classifyGrammarLessonImport(lesson.status, lesson.response, responseJson) === 'duplicate') {
          return { duplicate: true, updated: 0, passageCreated: false };
        }
        throw new GrammarImportError('This lessonId was already imported with different results. Generate a new lesson instead of replacing completed analytics.');
      }

      const claimed = await tx.grammarLesson.updateMany({
        where: { id: lesson.id, status: 'GENERATED' },
        data: { status: 'COMPLETED', response: responseJson, completedAt: now },
      });
      if (claimed.count !== 1) {
        const savedLesson = await tx.grammarLesson.findUnique({ where: { id: lesson.id } });
        if (savedLesson?.status === 'COMPLETED' && classifyGrammarLessonImport(savedLesson.status, savedLesson.response, responseJson) === 'duplicate') {
          return { duplicate: true, updated: 0, passageCreated: false };
        }
        throw new GrammarImportError('This lesson changed while it was being imported. Reload Grammar Coach and verify the current lesson before trying again.');
      }

      for (const result of response.grammarResults) {
        const current = progressByLearningItemId.get(result.learningItemId);
        if (!current) throw new GrammarImportError(`The scheduled grammar item ${result.learningItemId} no longer exists. Refresh Grammar Coach and try again.`);
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

      await tx.grammarLesson.updateMany({
        where: { status: 'GENERATED', id: { not: lesson.id } },
        data: { status: 'COMPLETED', completedAt: now },
      });
      return { duplicate: false, updated: response.grammarResults.length, passageCreated: Boolean(response.speedReadingPassage) };
    });
  } catch (error) {
    if (error instanceof GrammarImportError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: 'The lesson JSON was valid, but the database update failed. No grammar results were applied; please try again.' };
  }

  for (const path of GRAMMAR_IMPORT_REFRESH_PATHS) revalidatePath(path);
  return {
    ok: true as const,
    duplicate: outcome.duplicate,
    message: outcome.duplicate
      ? 'These lesson results were already imported. No duplicate analytics were added.'
      : 'Lesson results imported.',
  };
}

export async function submitGrammarLessonRatingsAction(input: unknown) {
  const validation = grammarRatingSubmissionSchema.safeParse(input);
  if (!validation.success) {
    return { ok: false as const, error: validation.error.issues[0]?.message ?? 'Choose one rating for every grammar point.' };
  }
  const submission = validation.data;
  const lesson = await prisma.grammarLesson.findUnique({ where: { id: submission.lessonId } });
  if (!lesson) return { ok: false as const, error: 'This lesson no longer exists. Refresh Grammar Coach and generate a current lesson.' };
  if (lesson.status === 'COMPLETED') {
    return { ok: true as const, duplicate: true, message: 'These lesson ratings were already saved.' };
  }

  const expectedIds = Array.isArray(lesson.grammarItemIds)
    ? lesson.grammarItemIds.filter((id): id is string => typeof id === 'string')
    : [];
  const submittedById = new Map(submission.ratings.map((rating) => [rating.learningItemId, rating.rating]));
  const unexpectedIds = submission.ratings.filter((rating) => !expectedIds.includes(rating.learningItemId));
  if (submittedById.size !== expectedIds.length || unexpectedIds.length) {
    return { ok: false as const, error: 'The ratings do not match the current lesson. Refresh Grammar Coach and rate every displayed point once.' };
  }

  const progress = await prisma.grammarProgress.findMany({ where: { learningItemId: { in: expectedIds } } });
  const progressById = new Map(progress.map((item) => [item.learningItemId, item]));
  if (progress.length !== expectedIds.length) {
    return { ok: false as const, error: 'One or more grammar points are missing. Refresh Grammar Coach before saving.' };
  }

  const grammarResults = expectedIds.map((learningItemId) => {
    const selectedRating = submittedById.get(learningItemId);
    const current = progressById.get(learningItemId);
    if (!selectedRating || !current) throw new Error(`Missing grammar rating for ${learningItemId}.`);
    const scheduledType = current.status === 'NEW' ? 'NEW' as const : 'REVIEW' as const;
    return {
      learningItemId,
      ...grammarResultFromAppRating(selectedRating, scheduledType),
    };
  });

  return importGrammarLessonResponseAction(JSON.stringify({
    lessonId: lesson.id,
    grammarResults,
  }));
}
