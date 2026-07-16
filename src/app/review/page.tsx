import { prisma } from '@/lib/db';
import { PageHeader, StatCard } from '@/components/ui';
import { ReviewSession, type SessionCard } from './session';

export const dynamic = 'force-dynamic';

const NEW_PER_SESSION = 20;
const REVIEWS_PER_SESSION = 200;

export default async function ReviewPage() {
  const now = new Date();
  const [due, total, suspended, leeches, newCount] = await Promise.all([
    prisma.reviewRecord.count({ where: { dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' } } }),
    prisma.reviewRecord.count(),
    prisma.reviewRecord.count({ where: { isSuspended: true } }),
    prisma.reviewRecord.count({ where: { isLeech: true } }),
    prisma.reviewRecord.count({ where: { maturity: 'NEW', isSuspended: false } }),
  ]);

  // Overdue reviews and learning cards first (oldest due first), then a
  // capped batch of new cards.
  const dueRecords = await prisma.reviewRecord.findMany({
    where: { dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' }, flashcardId: { not: null } },
    include: { flashcard: { include: { course: { select: { name: true, color: true } } } } },
    orderBy: { dueAt: 'asc' },
    take: REVIEWS_PER_SESSION,
  });
  const newRecords = await prisma.reviewRecord.findMany({
    where: { maturity: 'NEW', isSuspended: false, flashcardId: { not: null } },
    include: { flashcard: { include: { course: { select: { name: true, color: true } } } } },
    orderBy: { dueAt: 'asc' },
    take: NEW_PER_SESSION,
  });

  const cards: SessionCard[] = [...dueRecords, ...newRecords]
    .filter((r) => r.flashcard)
    .map((r) => ({
      recordId: r.id,
      front: r.flashcard!.front,
      back: r.flashcard!.back,
      metadata: r.flashcard!.metadata as Record<string, unknown>,
      maturity: r.maturity,
      courseName: r.flashcard!.course.name,
      courseColor: r.flashcard!.course.color,
    }));

  return (
    <>
      <PageHeader title="Review" subtitle="Unified spaced-repetition queue across all courses" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Due now" value={due} accent="#6ea8fe" />
        <StatCard label="New available" value={newCount} hint={`${NEW_PER_SESSION} per session`} />
        <StatCard label="Total cards" value={total} />
        <StatCard label="Suspended" value={suspended} />
        <StatCard label="Leeches" value={leeches} />
      </div>

      <ReviewSession cards={cards} />
    </>
  );
}
