import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { ankiDueTodayCount } from '@/lib/anki-data';
import { prisma } from '@/lib/db';
import { buildDailyQueue } from '@/lib/daily';
import { newGrammarDueToday } from '@/lib/grammar-coach';
import { meditationConfiguration } from '@/lib/app-settings';
import { parseNatoSessionStats, weekendSkills } from '@/lib/nato';
import { MeditationCheck } from './meditation-check';

export const dynamic = 'force-dynamic';

export default async function DailyPage() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [ankiDue, grammarProgress, readingBook, meditation, readToday, lastNatoSession, user] = await Promise.all([
    ankiDueTodayCount(),
    prisma.grammarProgress.findMany({ select: { learningItemId: true, status: true, curriculumOrder: true, dueAt: true, introducedAt: true, isLeech: true } }),
    prisma.book.findFirst({ where: { status: 'READING' }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true } }),
    prisma.studySession.findFirst({ where: { mode: 'meditation', date: { gte: start, lt: end } }, select: { id: true } }),
    prisma.bookReadingSession.findFirst({ where: { readAt: { gte: start, lt: end } }, select: { id: true } }),
    prisma.studySession.findFirst({ where: { mode: 'nato' }, orderBy: { date: 'desc' }, select: { date: true, stats: true } }),
    prisma.user.findFirst({ select: { settings: true } }),
  ]);
  const meditationDefaults = meditationConfiguration(user?.settings);
  const grammarReviews = grammarProgress.filter((item) => item.status !== 'NEW' && item.dueAt <= now).length;
  const grammarNew = newGrammarDueToday(grammarProgress, now);
  const lastNatoStats = lastNatoSession ? parseNatoSessionStats(lastNatoSession.stats) : null;
  const nextNatoDueAt = lastNatoSession && lastNatoStats
    ? new Date(lastNatoSession.date.getTime() + lastNatoStats.nextIntervalDays * 86_400_000)
    : null;
  const queue = buildDailyQueue({
    ankiDue,
    grammarReviews,
    grammarNew,
    readingBook,
    readToday: Boolean(readToday),
    weekendSkills: weekendSkills(now, nextNatoDueAt),
  });

  return <>
    <PageHeader title="Daily" subtitle="Meditate, review, and read" />
    <div className="space-y-2">
      <MeditationCheck initialComplete={Boolean(meditation)} targetMinutes={meditationDefaults.sessionMinutes} />
      {queue.map((block, index) => <Link key={block.key} href={block.href} className="block"><Card className={`flex items-center gap-4 p-3 transition-colors hover:border-accent/50 ${block.complete ? 'border-green-800/50' : ''}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${block.complete ? 'bg-green-950 text-green-300' : 'bg-surface-2 text-muted'}`}>{index + 2}</span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{block.title}</span><span className="block truncate text-[11px] text-muted">{block.detail}</span></span>
        <span className={`shrink-0 text-lg font-semibold tabular-nums ${block.complete ? 'text-green-300' : ''}`}>{block.complete ? '✓' : block.count}</span>
      </Card></Link>)}
    </div>
  </>;
}
