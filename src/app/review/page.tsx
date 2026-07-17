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
  // capped batch of new cards. Serves flashcards and practice items alike.
  const include = {
    flashcard: { include: { course: { select: { name: true, color: true } } } },
    practiceItem: { include: { course: { select: { name: true, color: true } } } },
  } as const;
  const dueRecords = await prisma.reviewRecord.findMany({
    where: { dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' } },
    include,
    orderBy: { dueAt: 'asc' },
    take: REVIEWS_PER_SESSION,
  });
  const newRecords = await prisma.reviewRecord.findMany({
    where: { maturity: 'NEW', isSuspended: false },
    include,
    orderBy: { dueAt: 'asc' },
    take: NEW_PER_SESSION,
  });

  const cards: SessionCard[] = [...dueRecords, ...newRecords]
    .filter((r) => r.flashcard || r.practiceItem)
    .map((r) => {
      const source = r.flashcard ?? r.practiceItem!;
      const isPractice = !r.flashcard;
      return {
        recordId: r.id,
        kind: isPractice ? ('practice' as const) : ('flashcard' as const),
        practiceType: r.practiceItem?.type ?? null,
        front: r.flashcard ? r.flashcard.front : r.practiceItem!.prompt,
        back: r.flashcard ? r.flashcard.back : r.practiceItem!.answer,
        metadata: (r.flashcard?.metadata ?? {}) as Record<string, unknown>,
        maturity: r.maturity,
        courseName: source.course.name,
        courseColor: source.course.color,
      };
    });

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
