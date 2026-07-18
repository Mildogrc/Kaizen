import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ankiDueTodayCount } from '@/lib/anki-data';
import { currentJlptProgress } from '@/lib/jlpt-progress';
import { configuredMathTargetSlug } from '@/lib/math-goals';
import { pathProgress } from '@/lib/roadmap';
import { Badge, Card, PageHeader, ProgressBar, Section, StatCard, statusTone, fmtStatus } from '@/components/ui';

export const dynamic = 'force-dynamic';

// A study day = any in-app rating, any Anki review, or a logged session.
async function getStreak() {
  const cutoff = new Date(Date.now() - 400 * 86_400_000);
  const [sessions, attempts, ankiReviews] = await Promise.all([
    prisma.studySession.findMany({ where: { date: { gte: cutoff } }, select: { date: true } }),
    prisma.attempt.findMany({ where: { createdAt: { gte: cutoff } }, select: { createdAt: true } }),
    prisma.ankiReviewLog.findMany({ where: { reviewedAt: { gte: cutoff } }, select: { reviewedAt: true } }),
  ]);
  const dayKey = (d: Date) => {
    const local = new Date(d);
    local.setHours(0, 0, 0, 0);
    return local.toISOString().slice(0, 10);
  };
  const days = new Set([
    ...sessions.map((s) => dayKey(s.date)),
    ...attempts.map((a) => dayKey(a.createdAt)),
    ...ankiReviews.map((r) => dayKey(r.reviewedAt)),
  ]);
  let streak = 0;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Today counts if studied; otherwise start from yesterday.
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export default async function Dashboard() {
  const [goals, dueReviews, ankiDue, courses, books, mistakes, streak, roadmap, japaneseWordStat, grammarProgress] = await Promise.all([
    prisma.courseGoal.findMany({ where: { status: 'ACTIVE' }, include: { course: true }, orderBy: { createdAt: 'asc' } }),
    prisma.reviewRecord.count({ where: { dueAt: { lte: new Date() }, isSuspended: false } }),
    ankiDueTodayCount(),
    prisma.course.findMany({ include: { _count: { select: { learningItems: true, flashcards: true } }, exams: { include: { levels: { orderBy: { rank: 'asc' } } } } } }),
    prisma.book.findMany({ orderBy: { updatedAt: 'desc' } }),
    prisma.mistake.count({ where: { resolved: false } }),
    getStreak(),
    prisma.roadmap.findUnique({ where: { slug: 'math-roadmap' }, include: { nodes: true, edges: true } }),
    prisma.knownWordStat.findFirst({ where: { language: 'ja' }, orderBy: { date: 'desc' } }),
    prisma.grammarProgress.findMany({ include: { learningItem: { select: { data: true } } } }),
  ]);

  const byTab = (tab: string) => courses.filter((c) => c.tab === tab);
  const itemCount = (tab: string) => byTab(tab).reduce((sum, c) => sum + c._count.learningItems, 0);

  const reading = books.filter((b) => b.status === 'READING');
  const finished = books.filter((b) => b.status === 'FINISHED');

  const grammarByLevel = new Map<string, { total: number; mastered: number }>();
  for (const progress of grammarProgress) {
    const data = progress.learningItem.data as Record<string, unknown>;
    const level = String(data.jlptLevel ?? '');
    const counts = grammarByLevel.get(level) ?? { total: 0, mastered: 0 };
    counts.total++;
    if (progress.status === 'MASTERED') counts.mastered++;
    grammarByLevel.set(level, counts);
  }
  const japaneseCourse = courses.find((course) => course.slug === 'japanese');
  const jlptExam = japaneseCourse?.exams.find((exam) => exam.slug === 'jlpt');
  const japaneseGoal = jlptExam ? currentJlptProgress(jlptExam.levels.map((level) => {
    const targets = level.targets as Record<string, number>;
    const grammar = grammarByLevel.get(level.name) ?? { total: targets.targetGrammar ?? 0, mastered: 0 };
    return { name: level.name, rank: level.rank, targetVocab: targets.targetVocab ?? 0, grammarTotal: grammar.total, grammarMastered: grammar.mastered };
  }), japaneseWordStat?.lower ?? 0) : null;
  const mathCourse = courses.find((course) => course.slug === 'math');
  const roadmapTargets = roadmap?.nodes.filter((node) => node.isTarget) ?? [];
  const mathGoalRecord = goals.find((goal) => goal.course.slug === 'math');
  const currentMathTargetSlug = configuredMathTargetSlug(mathCourse?.metadata, roadmapTargets, mathGoalRecord?.title);
  const currentMathTarget = roadmapTargets.find((node) => node.slug === currentMathTargetSlug) ?? null;
  const currentMathProgress = currentMathTarget && roadmap ? pathProgress(currentMathTarget.id, roadmap.nodes, roadmap.edges) : null;
  const otherGoals = goals.filter((goal) => goal.course.slug !== 'japanese' && goal.course.slug !== 'math');
  const activeGoalCount = otherGoals.length + (japaneseGoal ? 1 : 0) + (currentMathTarget ? 1 : 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Where everything stands right now" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Due reviews" value={dueReviews + ankiDue} hint={`${ankiDue} in Anki · ${dueReviews} in-app`} />
        <StatCard label="Streak" value={`${streak}d`} hint="consecutive study days" />
        <StatCard label="Active goals" value={activeGoalCount} />
        <StatCard label="Open mistakes" value={mistakes} hint="unresolved" />
        <StatCard label="Books reading" value={reading.length} hint={`${finished.length} finished`} />
      </div>

      <Section title="Next recommended action">
        <Link href="/daily">
          <Card className="flex items-center justify-between border-accent/30 hover:border-accent/60 transition-colors">
            <span className="text-[14px] font-medium">Do Daily</span>
            <span className="text-accent">→</span>
          </Card>
        </Link>
      </Section>

      <Section title="Active goals">
        <div className="grid gap-2 md:grid-cols-2">
          {japaneseGoal && japaneseCourse && (
            <Card className="p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">Prepare for JLPT {japaneseGoal.name}</span><Badge tone="blue">Japanese</Badge></div>
              <div className="mt-2"><ProgressBar pct={japaneseGoal.overallProgress} color={japaneseCourse.color ?? undefined} /></div>
              <p className="mt-1.5 text-[12px] text-muted tabular-nums">{japaneseGoal.wordsRemaining.toLocaleString()} words left · {japaneseGoal.grammarRemaining.toLocaleString()} grammar points left</p>
            </Card>
          )}
          {otherGoals.map((g) => (
            <Card key={g.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{g.title}</span>
                <Badge tone="blue">{g.course.name}</Badge>
              </div>
              {g.targetValue != null && (
                <div className="mt-2">
                  <ProgressBar pct={(g.currentValue / g.targetValue) * 100} color={g.course.color ?? undefined} />
                  <div className="mt-1 text-[11px] text-muted tabular-nums">
                    {g.currentValue} / {g.targetValue} {g.unit}
                  </div>
                </div>
              )}
              {g.description && <p className="mt-1.5 text-[12px] text-muted">{g.description}</p>}
            </Card>
          ))}
        </div>
      </Section>

      {currentMathTarget && currentMathProgress && <Section title="Current math path">
        <Link href={`/math?target=${currentMathTarget.slug}`}>
          <Card className="p-3 hover:border-accent/40 transition-colors">
            <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{currentMathTarget.title}</span><span className="text-[11px] text-muted tabular-nums">{currentMathProgress.done}/{currentMathProgress.total} courses</span></div>
            <div className="mt-2"><ProgressBar pct={currentMathProgress.pct} color="#2563eb" /></div>
          </Card>
        </Link>
      </Section>}

      <Section title="Content by area">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Japanese', '/japanese', 'JAPANESE'],
            ['Chinese', '/chinese', 'CHINESE'],
            ['Math', '/math', 'MATH'],
            ['Skills', '/skills', 'SKILLS'],
            ['Books', '/books', 'BOOKS'],
          ].map(([label, href, tab]) => (
            <Link key={tab} href={href}>
              <StatCard label={label} value={tab === 'BOOKS' ? books.length : itemCount(tab)} hint={tab === 'BOOKS' ? 'books tracked' : 'learning items'} />
            </Link>
          ))}
        </div>
      </Section>

      {reading.length > 0 && (
        <Section title="Currently reading">
          <div className="grid gap-2 md:grid-cols-2">
            {reading.map((b) => (
              <Link key={b.id} href={`/books/${b.id}`}>
                <Card className="flex items-center justify-between p-3 hover:border-accent/40 transition-colors">
                  <div>
                    <div className="text-[13px] font-medium">{b.title}</div>
                    <div className="text-[11px] text-muted">{b.author}</div>
                  </div>
                  <Badge tone={statusTone(b.status)}>{fmtStatus(b.status)}</Badge>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
