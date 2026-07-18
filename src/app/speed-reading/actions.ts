'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { parseJsonText } from '@/lib/grammar-coach';
import {
  adaptiveWpm,
  readingPassageSchema,
  readingSessionInputSchema,
  tokenizePassage,
} from '@/lib/speed-reading';

interface ReadingQuestion {
  id: string;
  prompt: string;
  choices: string[];
}

interface ReadingAnswer {
  questionId: string;
  correctIndex: number;
  explanation: string;
}

function passageQuestions(value: unknown): ReadingQuestion[] {
  return Array.isArray(value) ? value as ReadingQuestion[] : [];
}

function passageAnswers(value: unknown): ReadingAnswer[] {
  return Array.isArray(value) ? value as ReadingAnswer[] : [];
}

export async function importSpeedReadingPassageAction(input: string) {
  try {
    const passage = readingPassageSchema.parse(parseJsonText(input));
    const created = await prisma.speedReadingPassage.create({
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
        source: 'llm',
      },
    });
    revalidatePath('/speed-reading');
    return { ok: true as const, passageId: created.id, title: created.title };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not import the passage.' };
  }
}

export async function completeSpeedReadingSessionAction(rawInput: unknown) {
  try {
    const input = readingSessionInputSchema.parse(rawInput);
    const passage = await prisma.speedReadingPassage.findUniqueOrThrow({ where: { id: input.passageId } });
    const questions = passageQuestions(passage.questions);
    const answerKey = passageAnswers(passage.answerKey);
    if (!questions.length || questions.length !== answerKey.length) throw new Error('This passage has an invalid question set.');

    let correct = 0;
    const explanations = questions.map((question) => {
      const key = answerKey.find((answer) => answer.questionId === question.id);
      if (!key) throw new Error(`Missing answer for ${question.id}.`);
      const selected = input.answers[question.id];
      const isCorrect = selected === key.correctIndex;
      if (isCorrect) correct++;
      return { questionId: question.id, selected, correctIndex: key.correctIndex, isCorrect, explanation: key.explanation };
    });
    const accuracy = correct / questions.length;
    const priorWithRetention = await prisma.speedReadingSession.findFirst({
      where: { retentionAccuracy: { not: null } },
      orderBy: { retentionCompletedAt: 'desc' },
      select: { retentionAccuracy: true },
    });
    const recommendedNextWpm = adaptiveWpm({
      currentWpm: input.wpm,
      accuracy,
      threshold: input.comprehensionThreshold,
      latestRetention: priorWithRetention?.retentionAccuracy,
    });
    const retentionDueAt = new Date();
    retentionDueAt.setDate(retentionDueAt.getDate() + 1);
    await prisma.speedReadingSession.create({
      data: {
        passageId: input.passageId,
        mode: input.mode,
        wpm: input.wpm,
        chunkSize: input.chunkSize,
        fontSize: input.fontSize,
        punctuationPause: input.punctuationPause,
        startedAt: new Date(input.startedAt),
        durationSec: input.durationSec,
        correctAnswers: correct,
        totalQuestions: questions.length,
        accuracy,
        responseTimeMs: input.responseTimeMs,
        estimatedRetention: accuracy * 0.9,
        recommendedNextWpm,
        answers: input.answers,
        retentionDueAt,
      },
    });
    revalidatePath('/speed-reading');
    return { ok: true as const, correct, total: questions.length, accuracy, recommendedNextWpm, explanations };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not save the reading session.' };
  }
}

export async function completeRetentionCheckAction(sessionId: string, answers: Record<string, number>) {
  try {
    const session = await prisma.speedReadingSession.findUnique({ where: { id: sessionId }, include: { passage: true } });
    if (!session) return { ok: false as const, error: 'Reading session not found.' };
    if (session.retentionCompletedAt) return { ok: false as const, error: 'This retention check is already complete.' };
    if (!session.retentionDueAt || session.retentionDueAt > new Date()) return { ok: false as const, error: 'This retention check is not due yet.' };
    const questions = passageQuestions(session.passage.questions);
    const answerKey = passageAnswers(session.passage.answerKey);
    let correct = 0;
    for (const question of questions) {
      const key = answerKey.find((answer) => answer.questionId === question.id);
      if (key && answers[question.id] === key.correctIndex) correct++;
    }
    const accuracy = questions.length ? correct / questions.length : 0;
    await prisma.speedReadingSession.update({
      where: { id: session.id },
      data: { retentionCompletedAt: new Date(), retentionAccuracy: accuracy, retentionAnswers: answers },
    });
    revalidatePath('/speed-reading');
    return { ok: true as const, correct, total: questions.length, accuracy };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Could not save the retention check.' };
  }
}
