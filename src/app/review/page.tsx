import Link from 'next/link';
import { prisma } from '@/lib/db';
import { PageHeader, StatCard, btnCls, btnPrimaryCls } from '@/components/ui';
import { ReviewSession, type SessionCard } from './session';
import { GrammarReviewSession, type GrammarReviewCard } from './grammar-session';

export const dynamic = 'force-dynamic';

const NEW_PER_SESSION = 20;
const REVIEWS_PER_SESSION = 200;

function grammarData(value: unknown) {
  const row = value as Record<string, unknown>;
  return {
    pattern: String(row.pattern ?? ''),
    meaning: String(row.meaning ?? ''),
    level: String(row.jlptLevel ?? ''),
    examples: Array.isArray(row.examples) ? row.examples.filter((example): example is string => typeof example === 'string') : [],
  };
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const query = await searchParams;
  const type = query.type === 'grammar' ? 'grammar' : 'flashcards';
  const now = new Date();
  const [due, total, suspended, leeches, newCount, grammarDue] = await Promise.all([
    prisma.reviewRecord.count({ where: { dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' } } }),
    prisma.reviewRecord.count(),
    prisma.reviewRecord.count({ where: { isSuspended: true } }),
    prisma.reviewRecord.count({ where: { isLeech: true } }),
    prisma.reviewRecord.count({ where: { maturity: 'NEW', isSuspended: false } }),
    prisma.grammarProgress.count({ where: { status: { not: 'NEW' }, dueAt: { lte: now } } }),
  ]);

  const include = {
    flashcard: { include: { course: { select: { name: true, color: true } } } },
    practiceItem: { include: { course: { select: { name: true, color: true } } } },
  } as const;
  const [dueRecords, newRecords, grammarRows] = await Promise.all([
    type === 'flashcards' ? prisma.reviewRecord.findMany({ where: { dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' } }, include, orderBy: { dueAt: 'asc' }, take: REVIEWS_PER_SESSION }) : [],
    type === 'flashcards' ? prisma.reviewRecord.findMany({ where: { maturity: 'NEW', isSuspended: false }, include, orderBy: { dueAt: 'asc' }, take: NEW_PER_SESSION }) : [],
    type === 'grammar' ? prisma.grammarProgress.findMany({ where: { status: { not: 'NEW' }, dueAt: { lte: now } }, include: { learningItem: true }, orderBy: [{ isLeech: 'desc' }, { dueAt: 'asc' }], take: 50 }) : [],
  ]);
  const cards: SessionCard[] = [...dueRecords, ...newRecords].filter((record) => record.flashcard || record.practiceItem).map((record) => {
    const source = record.flashcard ?? record.practiceItem!;
    return { recordId: record.id, kind: record.flashcard ? 'flashcard' as const : 'practice' as const, practiceType: record.practiceItem?.type ?? null, front: record.flashcard ? record.flashcard.front : record.practiceItem!.prompt, back: record.flashcard ? record.flashcard.back : record.practiceItem!.answer, metadata: (record.flashcard?.metadata ?? {}) as Record<string, unknown>, maturity: record.maturity, courseName: source.course.name, courseColor: source.course.color };
  });
  const grammarCards: GrammarReviewCard[] = grammarRows.map((progress) => ({ progressId: progress.id, status: progress.status, ...grammarData(progress.learningItem.data) }));

  return <>
    <PageHeader title="In-app Review" subtitle="Flashcards and Japanese grammar in one place" />
    <div className="mb-5 flex gap-2"><Link href="/review?type=flashcards" className={type === 'flashcards' ? btnPrimaryCls : btnCls}>Flashcards · {due + Math.min(NEW_PER_SESSION, newCount)}</Link><Link href="/review?type=grammar" className={type === 'grammar' ? btnPrimaryCls : btnCls}>Japanese grammar · {grammarDue}</Link></div>
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Flashcards queued" value={due + Math.min(NEW_PER_SESSION, newCount)} />
      <StatCard label="Grammar due" value={grammarDue} />
      <StatCard label="Total flashcards" value={total} />
      <StatCard label="Leeches / suspended" value={`${leeches} / ${suspended}`} />
    </div>
    {type === 'grammar' ? <GrammarReviewSession cards={grammarCards} /> : <ReviewSession cards={cards} />}
  </>;
}
