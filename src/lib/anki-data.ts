// Prisma → analytics-row adapters shared by the analytics page, course tab
// strips, and dashboard. Keeps BigInt ids out of client components.

import { prisma } from './db';
import type { LogRow, SnapshotRow } from './anki-analytics';

export async function ankiRowsForMappings(mappingIds: string[]): Promise<{ snapshots: SnapshotRow[]; logs: LogRow[] }> {
  if (mappingIds.length === 0) return { snapshots: [], logs: [] };
  const [snapshots, logs] = await Promise.all([
    prisma.ankiCardSnapshot.findMany({ where: { mappingId: { in: mappingIds } } }),
    prisma.ankiReviewLog.findMany({ where: { mappingId: { in: mappingIds } }, orderBy: { reviewedAt: 'asc' } }),
  ]);
  return {
    snapshots: snapshots.map((s) => ({
      ankiCardId: s.ankiCardId.toString(),
      mappingId: s.mappingId,
      front: s.front,
      back: s.back,
      state: s.state,
      intervalDays: s.intervalDays,
      ease: s.ease,
      dueAt: s.dueAt,
      reps: s.reps,
      lapses: s.lapses,
      isLeech: s.isLeech,
    })),
    logs: logs.map((l) => ({
      ankiCardId: l.ankiCardId.toString(),
      reviewedAt: l.reviewedAt,
      rating: l.rating,
      intervalBeforeDays: l.intervalBeforeDays,
      intervalAfterDays: l.intervalAfterDays,
      timeMs: l.timeMs,
    })),
  };
}

/** Anki cards due today or overdue (scheduled states only), per course or all. */
export async function ankiDueTodayCount(courseId?: string): Promise<number> {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return prisma.ankiCardSnapshot.count({
    where: {
      dueAt: { lte: endOfToday },
      state: { in: ['LEARNING', 'YOUNG', 'MATURE'] },
      ...(courseId ? { mapping: { courseId } } : {}),
    },
  });
}
