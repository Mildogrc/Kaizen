import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ankiRowsForMappings } from '@/lib/anki-data';
import { forecast, health, leeches, projections, retention, reviewsPerDay, streaks } from '@/lib/anki-analytics';
import { analyzeCodeforces } from '@/lib/codeforces';
import { bookReadingActivity } from '@/lib/book-analytics';
import { meditationConfiguration } from '@/lib/app-settings';
import { analyzeMeditation } from '@/lib/meditation';
import { readingStreak } from '@/lib/speed-reading';
import { analyzeNatoSessions, parseNatoSessionStats } from '@/lib/nato';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnCls, btnPrimaryCls } from '@/components/ui';
import { ActivityHeatmap, Bars, MetricLine, StateBar } from '@/components/anki-charts';
import { LeechPanel } from './leech-panel';

export const dynamic = 'force-dynamic';

type AnalyticsArea = 'japanese' | 'chinese' | 'codeforces' | 'nato' | 'reading' | 'books' | 'meditation';

const AREAS: { id: AnalyticsArea; label: string }[] = [
  { id: 'japanese', label: 'Japanese' },
  { id: 'chinese', label: 'Chinese' },
  { id: 'codeforces', label: 'Codeforces' },
  { id: 'nato', label: 'NATO' },
  { id: 'reading', label: 'Reading' },
  { id: 'books', label: 'Books' },
  { id: 'meditation', label: 'Meditation' },
];

const pct = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

function AnalyticsTabs({ area }: { area: AnalyticsArea }) {
  return <div className="mb-6 flex flex-wrap gap-2">{AREAS.map((item) => <Link key={item.id} href={`/analytics?area=${item.id}`} className={area === item.id ? btnPrimaryCls : btnCls}>{item.label}</Link>)}</div>;
}

function AnalyticsHeader({ area, actions }: { area: AnalyticsArea; actions?: React.ReactNode }) {
  return <><PageHeader title="Analytics" subtitle="Choose an area to inspect progress and trends" actions={actions} /><AnalyticsTabs area={area} /></>;
}

function tags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

async function CodeforcesAnalytics() {
  const profile = await prisma.codeforcesProfile.findFirst({
    orderBy: { updatedAt: 'desc' },
    include: { submissions: true, ratingChanges: { orderBy: { updatedAt: 'asc' } } },
  });
  if (!profile) return <><AnalyticsHeader area="codeforces" /><EmptyState>Connect a Codeforces profile from Random Skills to populate analytics.</EmptyState></>;
  const analytics = analyzeCodeforces(profile.submissions.map((submission) => ({
    codeforcesId: submission.codeforcesId,
    submittedAt: submission.submittedAt,
    verdict: submission.verdict,
    problem: { contestId: submission.contestId ?? undefined, index: submission.problemIndex, name: submission.problemName, rating: submission.problemRating ?? undefined, tags: tags(submission.problemTags) },
  })), profile.ratingChanges.map((change) => ({ contestId: change.contestId, contestName: change.contestName, contestRank: change.contestRank, oldRating: change.oldRating, newRating: change.newRating, updatedAt: change.updatedAt })));
  return <>
    <AnalyticsHeader area="codeforces" actions={<Link href="/codeforces" className={btnCls}>Open Codeforces skill →</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Current rating" value={profile.rating ?? '—'} /><StatCard label="Maximum rating" value={profile.maxRating ?? '—'} /><StatCard label="Solved" value={analytics.solved} /><StatCard label="Solve rate" value={`${Math.round(analytics.solveRate * 100)}%`} /><StatCard label="Average solved" value={analytics.averageSolvedRating ?? '—'} /><StatCard label="Rated contests" value={analytics.contests} />
    </div>
    <Section title="Accepted activity"><Card><ActivityHeatmap days={analytics.heatmap} unit="accepted problems" thresholds={[1, 2, 4]} /></Card></Section>
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Solved by rating"><Card><Bars data={analytics.ratingBuckets.map((bucket) => ({ label: bucket.rating, value: bucket.solved, tooltip: `${bucket.rating}: ${bucket.solved} solved / ${bucket.attempted} attempted` }))} color="#eab308" /></Card></Section>
      <Section title="Contest rating"><Card><MetricLine data={analytics.ratingTrend} color="#a78bfa" /></Card></Section>
    </div>
  </>;
}

async function ReadingAnalytics() {
  const sessions = await prisma.speedReadingSession.findMany({ include: { passage: true }, orderBy: { completedAt: 'asc' } });
  const averageAccuracy = sessions.length ? sessions.reduce((sum, session) => sum + session.accuracy, 0) / sessions.length : null;
  const averageRetention = sessions.length ? sessions.reduce((sum, session) => sum + (session.retentionAccuracy ?? session.estimatedRetention), 0) / sessions.length : null;
  const maxWpm = sessions.length ? Math.max(...sessions.map((session) => session.wpm)) : null;
  const streak = readingStreak(sessions.map((session) => session.completedAt));
  const groups = new Map<string, { category: string; difficulty: string; count: number; wpm: number; accuracy: number }>();
  for (const session of sessions) {
    const key = `${session.passage.category}\u0000${session.passage.difficulty}`;
    const group = groups.get(key) ?? { category: session.passage.category, difficulty: session.passage.difficulty, count: 0, wpm: 0, accuracy: 0 };
    group.count++;
    group.wpm += session.wpm;
    group.accuracy += session.accuracy;
    groups.set(key, group);
  }
  return <>
    <AnalyticsHeader area="reading" actions={<Link href="/speed-reading" className={btnCls}>Open Reading skill →</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><StatCard label="Sessions" value={sessions.length} /><StatCard label="Maximum WPM" value={maxWpm ?? '—'} /><StatCard label="Comprehension" value={averageAccuracy == null ? '—' : `${Math.round(averageAccuracy * 100)}%`} /><StatCard label="Retention / streak" value={averageRetention == null ? '—' : `${Math.round(averageRetention * 100)}%`} hint={`${streak.current}d streak`} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><Section title="Reading speed"><Card><MetricLine data={sessions.map((session) => ({ label: session.completedAt.toISOString().slice(5, 10), value: session.wpm, tooltip: `${session.wpm} WPM · ${Math.round(session.accuracy * 100)}%` }))} color="#38bdf8" /></Card></Section><Section title="Comprehension"><Card><MetricLine data={sessions.map((session) => ({ label: session.completedAt.toISOString().slice(5, 10), value: Math.round(session.accuracy * 100), tooltip: `${Math.round(session.accuracy * 100)}% at ${session.wpm} WPM` }))} color="#4ade80" /></Card></Section></div>
    <Section title="By topic and difficulty">{groups.size === 0 ? <EmptyState>No completed reading sessions yet.</EmptyState> : <Card className="p-0"><div className="divide-y divide-line">{[...groups.values()].map((group) => <div key={`${group.category}-${group.difficulty}`} className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-4 py-2 text-[12px]"><span>{group.category}</span><span className="text-muted">{group.difficulty}</span><span>{Math.round(group.wpm / group.count)} WPM</span><span>{Math.round((group.accuracy / group.count) * 100)}%</span></div>)}</div></Card>}</Section>
  </>;
}

async function NatoAnalytics() {
  const sessions = await prisma.studySession.findMany({ where: { mode: 'nato' }, orderBy: { date: 'asc' } });
  const analytics = analyzeNatoSessions(sessions.map((session) => ({ date: session.date, stats: session.stats })));
  const trend = sessions.flatMap((session) => {
    const stats = parseNatoSessionStats(session.stats);
    return stats ? [{ label: session.date.toISOString().slice(5, 10), value: Math.round(stats.averageRecallMs), tooltip: `${(stats.averageRecallMs / 1_000).toFixed(1)}s · ${Math.round(stats.accuracy * 100)}% · ${stats.word}` }] : [];
  });
  const practiced = analytics.metrics.filter((metric) => metric.attempts > 0).sort((left, right) => right.averageMs - left.averageMs);
  return <>
    <AnalyticsHeader area="nato" actions={<Link href="/nato" className={btnCls}>Open NATO recall →</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><StatCard label="Sessions" value={analytics.sessions} /><StatCard label="Letters recalled" value={analytics.totalAttempts} /><StatCard label="Accuracy" value={analytics.accuracy == null ? '—' : `${Math.round(analytics.accuracy * 100)}%`} /><StatCard label="Average recall" value={analytics.averageRecallMs == null ? '—' : `${(analytics.averageRecallMs / 1_000).toFixed(1)}s`} hint={analytics.nextDueAt ? `next due ${analytics.nextDueAt.toLocaleDateString()}` : 'due now'} /></div>
    <div className="grid gap-5 xl:grid-cols-2"><Section title="Recall-time trend"><Card><MetricLine data={trend} color="#22d3ee" /></Card></Section><Section title="Slowest letters"><Card><Bars data={practiced.slice(0, 12).map((metric) => ({ label: metric.letter, value: Math.round(metric.averageMs), tooltip: `${metric.letter}: ${(metric.averageMs / 1_000).toFixed(1)}s · ${Math.round(metric.accuracy * 100)}% correct` }))} color="#f59e0b" /></Card></Section></div>
  </>;
}

async function BookAnalytics() {
  const [books, sessions] = await Promise.all([
    prisma.book.findMany({ orderBy: { updatedAt: 'desc' } }),
    prisma.bookReadingSession.findMany({ include: { book: true }, orderBy: { readAt: 'asc' } }),
  ]);
  const totalPages = sessions.reduce((sum, session) => sum + session.pagesRead, 0);
  const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMin, 0);
  const reading = books.filter((book) => book.status === 'READING');
  const finished = books.filter((book) => book.status === 'FINISHED');
  const activity365 = bookReadingActivity(sessions);
  return <>
    <AnalyticsHeader area="books" actions={<Link href="/books" className={btnCls}>Open Books →</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><StatCard label="Currently reading" value={reading.length} /><StatCard label="Finished" value={finished.length} /><StatCard label="Pages logged" value={totalPages.toLocaleString()} /><StatCard label="Time logged" value={totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`} /></div>
    <Section title="Book activity — last 12 months"><Card><ActivityHeatmap days={activity365} unit="pages read" thresholds={[5, 15, 30]} /></Card></Section>
    <div className="grid gap-5 xl:grid-cols-2"><Section title="Pages per session"><Card><MetricLine data={sessions.map((session) => ({ label: session.readAt.toISOString().slice(5, 10), value: session.pagesRead, tooltip: `${session.book.title}: ${session.pagesRead} pages` }))} color="#c084fc" /></Card></Section><Section title="Minutes per session"><Card><MetricLine data={sessions.map((session) => ({ label: session.readAt.toISOString().slice(5, 10), value: session.durationMin, tooltip: `${session.book.title}: ${session.durationMin} minutes` }))} color="#f59e0b" /></Card></Section></div>
    <Section title="Current books">{reading.length === 0 ? <EmptyState>No book is currently marked reading.</EmptyState> : <div className="grid gap-3 md:grid-cols-2">{reading.map((book) => <Link key={book.id} href={`/books/${book.id}`}><Card className="hover:border-accent/50"><div className="font-medium">{book.title}</div><div className="mt-1 text-[11px] text-muted">{book.author ?? 'Unknown author'}</div></Card></Link>)}</div>}</Section>
  </>;
}

async function MeditationAnalytics() {
  const [sessions, user] = await Promise.all([
    prisma.studySession.findMany({ where: { mode: 'meditation' }, orderBy: { date: 'asc' }, select: { date: true, durationMin: true } }),
    prisma.user.findFirst({ select: { settings: true } }),
  ]);
  const configuration = meditationConfiguration(user?.settings);
  const analytics = analyzeMeditation(sessions, configuration.sessionMinutes);
  const totalTime = analytics.totalMinutes < 60
    ? `${analytics.totalMinutes}m`
    : `${Math.floor(analytics.totalMinutes / 60)}h ${analytics.totalMinutes % 60}m`;
  return <>
    <AnalyticsHeader area="meditation" actions={<Link href="/configurations?section=meditation" className={btnCls}>Meditation settings →</Link>} />
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Days practiced" value={analytics.totalDays} />
      <StatCard label="Current streak" value={`${analytics.currentStreak}d`} />
      <StatCard label="Best streak" value={`${analytics.bestStreak}d`} />
      <StatCard label="This week" value={`${analytics.daysThisWeek}/${configuration.targetDaysPerWeek}`} hint="target days" />
      <StatCard label="Last 30 days" value={`${Math.round(analytics.consistencyLast30 * 100)}%`} hint={`${analytics.daysLast30} practice days`} />
      <StatCard label="Time practiced" value={totalTime} hint={analytics.averageMinutes == null ? undefined : `${Math.round(analytics.averageMinutes)}m average`} />
    </div>
    <Section title="Meditation activity — last 12 months"><Card><ActivityHeatmap days={analytics.activity365} unit="practice day" thresholds={[0, 0, 0]} /></Card></Section>
    <div className="grid gap-5 xl:grid-cols-2">
      <Section title="Days per month"><Card><Bars data={analytics.monthlyDays} color="#a78bfa" /></Card></Section>
      <Section title="Minutes per session"><Card><MetricLine data={analytics.minutesTrend} color="#38bdf8" /></Card></Section>
    </div>
  </>;
}

async function LanguageAnalytics({ area }: { area: 'japanese' | 'chinese' }) {
  const tab = area === 'japanese' ? 'JAPANESE' : 'CHINESE';
  const language = area === 'japanese' ? 'ja' : 'zh';
  const [courses, wordStat] = await Promise.all([
    prisma.course.findMany({ where: { tab, ankiMappings: { some: {} } }, include: { ankiMappings: { include: { contentSchema: true } }, goals: { where: { status: 'ACTIVE', targetValue: { not: null } }, take: 1 } }, orderBy: { name: 'asc' } }),
    prisma.knownWordStat.findFirst({ where: { language }, orderBy: { date: 'desc' } }),
  ]);
  const sections = await Promise.all(courses.map(async (course) => {
    const { snapshots, logs } = await ankiRowsForMappings(course.ankiMappings.map((mapping) => mapping.id));
    const goal = course.goals[0];
    return { course, snapshots, logs, activity365: reviewsPerDay(logs, 365), activity30: reviewsPerDay(logs, 30), streak: streaks(logs), retention: retention(logs), forecast: forecast(snapshots, 30), health: health(snapshots), projections: projections(snapshots, logs, goal?.targetValue ? { title: goal.title, targetValue: goal.targetValue } : null), leechList: leeches(snapshots) };
  }));

  return <>
    <AnalyticsHeader area={area} actions={<Link href="/anki" className={btnCls}>⟳ Sync & mapping</Link>} />
    <Section title="Known words"><div className="grid grid-cols-2 gap-3 md:grid-cols-5"><StatCard label="Conservative count" value={wordStat?.lower.toLocaleString() ?? '—'} hint={wordStat ? `upper bound ${wordStat.upper.toLocaleString()}` : undefined} /><StatCard label="Migaku" value={wordStat?.migakuCount.toLocaleString() ?? 0} /><StatCard label="Anki" value={wordStat?.ankiCount.toLocaleString() ?? 0} /><StatCard label="Manual" value={wordStat?.manualCount.toLocaleString() ?? 0} /><Link href={`/words?lang=${language}`}><StatCard label="Words" value="Manage →" hint="imports and source list" /></Link></div></Section>
    {sections.length === 0 && <EmptyState>No {area} Anki deck is mapped yet. Known-word analytics remain available above.</EmptyState>}
    {sections.map((section) => {
      const minutes30 = section.activity30.reduce((sum, day) => sum + day.minutes, 0);
      return <section key={section.course.id} className="mb-10">
        <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2"><h2 className="text-lg font-semibold" style={{ color: section.course.color ?? undefined }}>{section.course.name}</h2><span className="text-[12px] text-muted">{section.course.ankiMappings.map((mapping) => mapping.deckName).join(' · ')} — {section.snapshots.length} cards</span></div>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5"><StatCard label="Due today" value={section.forecast.days[0]?.due ?? 0} hint={`${section.forecast.overdue} overdue`} /><StatCard label="Streak" value={`${section.streak.current}d`} hint={`best ${section.streak.best}d`} /><StatCard label="Mature retention" value={pct(section.retention.mature)} hint={`young ${pct(section.retention.young)}`} /><StatCard label="Mature cards" value={section.health.states.MATURE} hint={`of ${section.snapshots.length}`} /><StatCard label="Last 30 days" value={section.activity30.reduce((sum, day) => sum + day.reviews, 0)} hint={`${minutes30} min`} /></div>
        <Section title="Activity — last 12 months"><Card><ActivityHeatmap days={section.activity365.map((day) => ({ date: day.date, reviews: day.reviews }))} /></Card></Section>
        <div className="grid gap-4 lg:grid-cols-2"><Section title="Reviews per day — last 30"><Card><Bars color="#3987e5" data={section.activity30.map((day) => ({ label: day.date.slice(5), tooltip: `${day.date}: ${day.reviews} reviews`, value: day.reviews }))} /></Card></Section><Section title="Workload forecast"><Card><Bars color="#199e70" data={section.forecast.days.map((day) => ({ label: day.date.slice(5), tooltip: `${day.date}: ${day.due} due`, value: day.due }))} /></Card></Section></div>
        <div className="grid gap-4 lg:grid-cols-3"><Section title="Collection health"><Card><StateBar segments={[{ label: 'new', count: section.health.states.NEW }, { label: 'learning', count: section.health.states.LEARNING }, { label: 'young', count: section.health.states.YOUNG }, { label: 'mature', count: section.health.states.MATURE }, { label: 'suspended', count: section.health.states.SUSPENDED + section.health.states.BURIED }]} /></Card></Section><Section title="Ease distribution"><Card><Bars height={90} data={section.health.easeHistogram.map((bucket) => ({ label: bucket.label, tooltip: `${bucket.label}: ${bucket.count}`, value: bucket.count }))} /></Card></Section><Section title="Intervals"><Card><Bars height={90} data={section.health.intervalBuckets.map((bucket) => ({ label: bucket.label, tooltip: `${bucket.label}: ${bucket.count}`, value: bucket.count }))} /></Card></Section></div>
        <Section title="Projections"><div className="grid gap-2 md:grid-cols-3">{section.projections.map((projection) => <Card key={projection.label} className="p-3"><div className="flex justify-between gap-2"><span className="text-[12px] font-medium">{projection.label}</span>{projection.confidence === 'low' && <Badge tone="amber">low data</Badge>}</div><div className="mt-1 text-xl font-semibold">{projection.date ?? '—'}</div><div className="text-[11px] text-muted">{projection.detail}</div></Card>)}</div></Section>
        <Section title={`Leeches (${section.leechList.length})`}><LeechPanel decks={section.course.ankiMappings.map((mapping) => ({ mappingId: mapping.id, deckName: mapping.deckName, leeches: section.leechList.filter((card) => card.mappingId === mapping.id).map((card) => ({ ankiCardId: card.ankiCardId, front: card.front, back: card.back, lapses: card.lapses, intervalDays: card.intervalDays, ease: card.ease })) }))} /></Section>
      </section>;
    })}
  </>;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const query = await searchParams;
  const area: AnalyticsArea = AREAS.some((item) => item.id === query.area) ? query.area as AnalyticsArea : 'japanese';
  if (area === 'codeforces') return <CodeforcesAnalytics />;
  if (area === 'nato') return <NatoAnalytics />;
  if (area === 'reading') return <ReadingAnalytics />;
  if (area === 'books') return <BookAnalytics />;
  if (area === 'meditation') return <MeditationAnalytics />;
  return <LanguageAnalytics area={area} />;
}
