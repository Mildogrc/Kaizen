'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { rate, type Rating } from '@/lib/srs';

export async function rateGrammarReviewAction(progressId: string, rating: Rating) {
  const current = await prisma.grammarProgress.findUniqueOrThrow({ where: { id: progressId } });
  const now = new Date();
  const next = rate({
    ease: current.ease,
    intervalDays: current.intervalDays,
    repetitions: current.repetitions,
    lapseCount: current.lapseCount,
    isLeech: current.isLeech,
  }, rating, now);
  const status = next.intervalDays >= 21 ? 'MASTERED' : next.intervalDays >= 1 ? 'REVIEW' : 'LEARNING';
  await prisma.grammarProgress.update({
    where: { id: progressId },
    data: {
      status,
      ease: next.ease,
      intervalDays: next.intervalDays,
      dueAt: next.dueAt,
      repetitions: next.repetitions,
      lapseCount: next.lapseCount,
      isLeech: next.isLeech,
      introducedAt: current.introducedAt ?? now,
      lastStudiedAt: now,
      lastRating: rating,
    },
  });
  revalidatePath('/review');
  revalidatePath('/japanese/grammar');
  revalidatePath('/daily');
}
