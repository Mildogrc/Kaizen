'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { NATO_CODE_WORDS, natoIntervalDays } from '@/lib/nato';

interface SubmittedAttempt {
  letter?: unknown;
  typed?: unknown;
  timeMs?: unknown;
}

export async function saveNatoSessionAction(payload: string) {
  const submitted = JSON.parse(payload) as { word?: unknown; attempts?: unknown };
  const word = String(submitted.word ?? '').toUpperCase();
  if (!/^[A-Z]{3,12}$/.test(word) || !Array.isArray(submitted.attempts) || submitted.attempts.length !== word.length) {
    throw new Error('Invalid NATO session.');
  }
  const attempts = (submitted.attempts as SubmittedAttempt[]).map((attempt, index) => {
    const letter = word[index];
    const expected = NATO_CODE_WORDS[letter];
    const typed = String(attempt.typed ?? '').trim();
    const timeMs = Math.min(120_000, Math.max(50, Math.round(Number(attempt.timeMs) || 0)));
    return { letter, expected, typed, correct: typed.toLowerCase() === expected.toLowerCase(), timeMs };
  });
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const totalTimeMs = attempts.reduce((sum, attempt) => sum + attempt.timeMs, 0);
  const accuracy = correct / attempts.length;
  const averageRecallMs = totalTimeMs / attempts.length;
  const nextIntervalDays = natoIntervalDays({ accuracy, averageRecallMs });
  await prisma.studySession.create({
    data: {
      mode: 'nato',
      durationMin: Math.max(1, Math.round(totalTimeMs / 60_000)),
      stats: JSON.parse(JSON.stringify({ word, attempts, accuracy, averageRecallMs, totalTimeMs, nextIntervalDays })),
    },
  });
  revalidatePath('/nato');
  revalidatePath('/daily');
  revalidatePath('/analytics');
  return { ok: true };
}
