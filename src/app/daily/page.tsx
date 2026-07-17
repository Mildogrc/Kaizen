import Link from 'next/link';
import { prisma } from '@/lib/db';
import { buildDailyQueue, newCardCap, STUDY_MODES, type CourseCount, type StudyMode } from '@/lib/daily';
import { Card, EmptyState, PageHeader, Section, StatCard } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function courseCounts(): Promise<{
  inAppDue: CourseCount[];
  inAppNew: CourseCount[];
  ankiDue: CourseCount[];
  openMistakes: CourseCount[];
  rememberNotes: number;
}> {
  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const courses = await prisma.course.findMany({ select: { id: true, name: true, tab: true } });

  const per = async (fn: (courseId: string) => Promise<number>): Promise<CourseCount[]> =>
    (await Promise.all(courses.map(async (c) => ({ courseName: c.name, tab: c.tab, count: await fn(c.id) })))).filter(
      (x) => x.count > 0,
    );

  const [inAppDue, inAppNew, ankiDue, openMistakes, rememberNotes] = await Promise.all([
    per((id) =>
      prisma.reviewRecord.count({
        where: {
          dueAt: { lte: now }, isSuspended: false, maturity: { not: 'NEW' },
          OR: [{ flashcard: { courseId: id } }, { practiceItem: { courseId: id } }],
        },
      }),
    ),
    per((id) =>
      prisma.reviewRecord.count({
        where: {
          maturity: 'NEW', isSuspended: false,
          OR: [{ flashcard: { courseId: id } }, { practiceItem: { courseId: id } }],
        },
      }),
    ),
    per((id) =>
      prisma.ankiCardSnapshot.count({
        where: { dueAt: { lte: endOfToday }, state: { in: ['LEARNING', 'YOUNG', 'MATURE'] }, mapping: { courseId: id } },
      }),
    ),
    per((id) => prisma.mistake.count({ where: { courseId: id, resolved: false } })),
    prisma.bookNote.count({ where: { remember: true, flashcards: { none: {} } } }),
  ]);

  return { inAppDue, inAppNew, ankiDue, openMistakes, rememberNotes };
}

export default async function DailyPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: rawMode } = await searchParams;
  const mode: StudyMode = (STUDY_MODES as readonly string[]).includes(rawMode ?? '')
    ? (rawMode as StudyMode)
    : 'balanced';

  const counts = await courseCounts();
  const queue = buildDailyQueue(counts, mode);
  const totalWork = queue.reduce((s, b) => s + b.count, 0);

  return (
    <>
      <PageHeader title="Daily Study" subtitle="One queue combining Anki, in-app reviews, new cards, mistakes, and books" />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today's total" value={totalWork} hint="items across all blocks" accent="#6ea8fe" />
        <StatCard label="Anki due" value={counts.ankiDue.reduce((s, x) => s + x.count, 0)} />
        <StatCard label="In-app due" value={counts.inAppDue.reduce((s, x) => s + x.count, 0)} />
        <StatCard label="New card cap" value={newCardCap(mode)} hint={`mode: ${mode}`} />
      </div>

      <Section title="Study mode">
        <div className="flex flex-wrap gap-1.5">
          {STUDY_MODES.map((m) => (
            <Link
              key={m}
              href={m === 'balanced' ? '/daily' : `/daily?mode=${m}`}
              className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                m === mode
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-2 text-muted hover:border-accent/40 hover:text-foreground'
              }`}
            >
              {m.replace(/-/g, ' ')}
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Today's queue">
        {queue.length === 0 ? (
          <EmptyState>
            Nothing queued — no due reviews, mistakes, or pending notes. Import content or generate cards to
            build a study load.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {queue.map((b, i) => (
              <Link key={b.key} href={b.href} className="block">
                <Card
                  className={`flex items-center gap-4 p-3 transition-colors hover:border-accent/50 ${
                    b.emphasis ? 'border-accent/30' : ''
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${b.emphasis ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-muted'}`}>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{b.title}</span>
                    <span className="block truncate text-[11px] text-muted">{b.detail}</span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums" style={b.emphasis ? { color: 'var(--accent)' } : undefined}>
                    {b.count}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
