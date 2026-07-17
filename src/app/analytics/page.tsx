import Link from 'next/link';
import { prisma } from '@/lib/db';
import { maybeAutoSync } from '@/lib/anki-sync';
import { ankiRowsForMappings } from '@/lib/anki-data';
import {
  forecast,
  health,
  leeches,
  projections,
  retention,
  reviewsPerDay,
  streaks,
} from '@/lib/anki-analytics';
import { Badge, Card, EmptyState, PageHeader, Section, StatCard, btnCls } from '@/components/ui';
import { ActivityHeatmap, Bars, StateBar } from '@/components/anki-charts';
import { LeechPanel } from './leech-panel';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default async function AnalyticsPage() {
  // Opportunistic refresh: cheap no-op when Anki is closed or synced recently.
  await maybeAutoSync().catch(() => {});

  const courses = await prisma.course.findMany({
    where: { ankiMappings: { some: {} } },
    include: {
      ankiMappings: { include: { contentSchema: true } },
      goals: { where: { status: 'ACTIVE', targetValue: { not: null } }, take: 1 },
    },
    orderBy: { name: 'asc' },
  });

  if (courses.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Anki-powered study analytics" />
        <EmptyState>
          No Anki decks mapped yet. Set up the connection and attach decks in the{' '}
          <Link href="/anki" className="text-accent underline">Anki tab</Link> — analytics appear after the first sync.
        </EmptyState>
      </>
    );
  }

  const sections = await Promise.all(
    courses.map(async (course) => {
      const { snapshots, logs } = await ankiRowsForMappings(course.ankiMappings.map((m) => m.id));
      const goal = course.goals[0];
      return {
        course,
        snapshots,
        logs,
        activity365: reviewsPerDay(logs, 365),
        activity30: reviewsPerDay(logs, 30),
        streak: streaks(logs),
        retention: retention(logs),
        forecast: forecast(snapshots, 30),
        health: health(snapshots),
        projections: projections(
          snapshots,
          logs,
          goal?.targetValue ? { title: goal.title, targetValue: goal.targetValue } : null,
        ),
        leechList: leeches(snapshots),
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Pulled from Anki — activity, retention, workload, health, and projections"
        actions={<Link href="/anki" className={btnCls}>⟳ Sync & mapping</Link>}
      />

      {sections.map((s) => {
        const totalReviews = s.logs.length;
        const minutes30 = s.activity30.reduce((sum, d) => sum + d.minutes, 0);
        return (
          <section key={s.course.id} className="mb-10">
            <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
              <h2 className="text-lg font-semibold" style={{ color: s.course.color ?? undefined }}>
                {s.course.name}
              </h2>
              <span className="text-[12px] text-muted">
                {s.course.ankiMappings.map((m) => m.deckName).join(' · ')} — {s.snapshots.length} cards, {totalReviews.toLocaleString()} reviews on record
              </span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatCard label="Due today" value={s.forecast.days[0]?.due ?? 0} hint={`${s.forecast.overdue} overdue`} />
              <StatCard label="Streak" value={`${s.streak.current}d`} hint={`best ${s.streak.best}d`} />
              <StatCard label="Retention (mature)" value={pct(s.retention.mature)} hint={`young ${pct(s.retention.young)}`} />
              <StatCard label="Mature cards" value={s.health.states.MATURE} hint={`of ${s.snapshots.length}`} />
              <StatCard label="Last 30 days" value={s.activity30.reduce((sum, d) => sum + d.reviews, 0)} hint={`reviews · ${minutes30} min`} />
            </div>

            <Section title="Activity — last 12 months">
              <Card>
                <ActivityHeatmap days={s.activity365.map((d) => ({ date: d.date, reviews: d.reviews }))} />
              </Card>
            </Section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Reviews per day — last 30" className="mb-0">
                <Card>
                  <Bars
                    color="#3987e5"
                    data={s.activity30.map((d) => ({
                      label: d.date.slice(5),
                      tooltip: `${d.date}: ${d.reviews} reviews${d.minutes ? ` · ${d.minutes} min` : ''}`,
                      value: d.reviews,
                    }))}
                  />
                </Card>
              </Section>
              <Section title="Workload forecast — next 30 days" className="mb-0">
                <Card>
                  <Bars
                    color="#199e70"
                    data={s.forecast.days.map((d, i) => ({
                      label: d.date.slice(5),
                      tooltip: `${d.date}: ${d.due} due${i === 0 && s.forecast.overdue ? ` (incl. ${s.forecast.overdue} overdue)` : ''}`,
                      value: d.due,
                    }))}
                  />
                </Card>
              </Section>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Section title="Collection health" className="mb-0">
                <Card className="space-y-3">
                  <StateBar
                    segments={[
                      { label: 'new', count: s.health.states.NEW },
                      { label: 'learning', count: s.health.states.LEARNING },
                      { label: 'young', count: s.health.states.YOUNG },
                      { label: 'mature', count: s.health.states.MATURE },
                      { label: 'suspended', count: s.health.states.SUSPENDED + s.health.states.BURIED },
                    ]}
                  />
                </Card>
              </Section>
              <Section title="Ease distribution" className="mb-0">
                <Card>
                  <Bars
                    height={90}
                    data={s.health.easeHistogram.map((b) => ({ label: b.label, tooltip: `ease ${b.label}: ${b.count} cards`, value: b.count }))}
                  />
                </Card>
              </Section>
              <Section title="Interval distribution" className="mb-0">
                <Card>
                  <Bars
                    height={90}
                    data={s.health.intervalBuckets.map((b) => ({ label: b.label, tooltip: `${b.label}: ${b.count} cards`, value: b.count }))}
                  />
                </Card>
              </Section>
            </div>

            <Section title="Projections" className="mt-4">
              <div className="grid gap-2 md:grid-cols-3">
                {s.projections.map((p) => (
                  <Card key={p.label} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium">{p.label}</span>
                      {p.confidence === 'low' && <Badge tone="amber">low data</Badge>}
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums">
                      {p.date ?? '—'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">{p.detail}</div>
                  </Card>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                Estimates from your last-30-day pace; they firm up as review history accumulates.
              </p>
            </Section>

            <Section title={`Leeches (${s.leechList.length})`}>
              <LeechPanel
                decks={s.course.ankiMappings.map((m) => ({
                  mappingId: m.id,
                  deckName: m.deckName,
                  leeches: s.leechList
                    .filter((c) => c.mappingId === m.id)
                    .map((c) => ({
                      ankiCardId: c.ankiCardId,
                      front: c.front,
                      back: c.back,
                      lapses: c.lapses,
                      intervalDays: c.intervalDays,
                      ease: c.ease,
                    })),
                }))}
              />
            </Section>
          </section>
        );
      })}
    </>
  );
}
