import { prisma } from '@/lib/db';
import { ankiStatus } from '@/lib/anki-connect';
import { Badge, Card, PageHeader, Section, StatCard, fmtStatus, statusTone } from '@/components/ui';
import { AnkiConfig } from './config';
import { adaptiveAnkiDashboard } from '@/lib/adaptive-anki-service';
import { maybeAutoSync } from '@/lib/anki-sync';

export const dynamic = 'force-dynamic';

export default async function AnkiPage() {
  const status = await ankiStatus();
  if (status.connected) await maybeAutoSync();
  const [mappings, courses, syncRuns, snapshotCount, reviewLogCount, adaptive] = await Promise.all([
    prisma.ankiDeckMapping.findMany({
      include: { course: true, contentSchema: true, _count: { select: { cards: true, reviewLogs: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.course.findMany({
      include: { schemas: { select: { id: true, name: true, slug: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.ankiSyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
    prisma.ankiCardSnapshot.count(),
    prisma.ankiReviewLog.count(),
    adaptiveAnkiDashboard(),
  ]);
  const adaptiveReasons = Array.isArray(adaptive?.latestDecision?.reasons)
    ? adaptive.latestDecision.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];

  return (
    <>
      <PageHeader
        title="Anki"
        subtitle="Anki is the review engine — this app pulls your decks and runs the analytics."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Connection"
          value={status.connected ? 'Connected' : 'Offline'}
          hint={status.connected ? `AnkiConnect v${status.version}` : 'start Anki to sync'}
          accent={status.connected ? '#4ade80' : '#f87171'}
        />
        <StatCard label="Mapped decks" value={mappings.length} />
        <StatCard label="Cards snapshotted" value={snapshotCount} />
        <StatCard label="Review history" value={reviewLogCount} hint="log entries" />
      </div>

      <Section title="Adaptive Japanese vocabulary">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted">Today&apos;s new-card budget</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {adaptive?.latestDecision?.finalBudget ?? adaptive?.settings.startingBudget ?? 10}
              </div>
              <p className="mt-1 text-[12px] text-muted">
                {adaptive?.settings.enabled
                  ? `${adaptive.state?.reliableDataDays ?? 0} reliable post-activation days · ${adaptive.mappings.filter((mapping) => mapping.adaptiveNewCards).length} participating deck(s)`
                  : 'Disabled in Japanese configurations.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <Badge tone={adaptive?.settings.enabled ? 'green' : 'neutral'}>{adaptive?.settings.enabled ? 'enabled' : 'disabled'}</Badge>
              {adaptive?.latestDecision && <Badge tone={adaptive.latestDecision.applyStatus === 'applied' ? 'green' : adaptive.latestDecision.applyStatus === 'failed' ? 'red' : 'amber'}>{adaptive.latestDecision.applyStatus}</Badge>}
            </div>
          </div>
          {adaptive?.latestDecision?.applyError && <p className="mt-3 rounded-md border border-red-900 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">{adaptive.latestDecision.applyError}</p>}
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-accent">Why this budget?</summary>
            <div className="mt-2 grid gap-2 text-[11px] text-muted sm:grid-cols-2 lg:grid-cols-4">
              <div>Previous: <span className="text-foreground">{adaptive?.latestDecision?.previousBudget ?? '—'}</span></div>
              <div>Performance target: <span className="text-foreground">{adaptive?.latestDecision?.performanceTarget ?? '—'}</span></div>
              <div>Confidence ceiling: <span className="text-foreground">{adaptive?.latestDecision?.confidenceCeiling ?? '—'}</span></div>
              <div>Overdue reviews: <span className="text-foreground">{adaptive?.latestDecision?.overdueCount ?? '—'}</span></div>
              <div>Retention: <span className="text-foreground">{adaptive?.latestDecision?.windowRetention == null ? '—' : `${(adaptive.latestDecision.windowRetention * 100).toFixed(1)}%`}</span></div>
              <div>Median review time: <span className="text-foreground">{adaptive?.latestDecision?.medianReviewMinutes == null ? '—' : `${adaptive.latestDecision.medianReviewMinutes.toFixed(1)} min`}</span></div>
              <div>Review completion: <span className="text-foreground">{adaptive?.latestDecision?.completionRate == null ? '—' : `${(adaptive.latestDecision.completionRate * 100).toFixed(1)}%`}</span></div>
              <div>Repeated lapsers: <span className="text-foreground">{adaptive?.latestDecision?.repeatLapseRate == null ? '—' : `${(adaptive.latestDecision.repeatLapseRate * 100).toFixed(1)}%`}</span></div>
            </div>
            {adaptiveReasons.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted">{adaptiveReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          </details>
          {adaptive && adaptive.history.length > 0 && <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-muted">Recent budget history</summary>
            <div className="mt-2 space-y-1">
              {adaptive.history.map((decision) => <div key={decision.id} className="flex items-center justify-between rounded border border-line px-2 py-1.5 text-[11px]"><span className="text-muted">{decision.ankiDay}</span><span className="tabular-nums">{decision.previousBudget} → {decision.finalBudget}</span></div>)}
            </div>
          </details>}
        </Card>
      </Section>

      {!status.connected && (
        <Section title="Setup">
          <Card className="text-[13px] leading-relaxed text-muted">
            <p>
              1. In Anki desktop: <span className="text-foreground">Tools → Add-ons → Get Add-ons</span> and install{' '}
              <span className="font-mono text-foreground">2055492159</span> (AnkiConnect), then restart Anki.
            </p>
            <p className="mt-1">
              2. Keep Anki running and reload this page — syncing and deck selection activate automatically.
            </p>
            <p className="mt-1">Already-synced analytics stay available while Anki is closed.</p>
          </Card>
        </Section>
      )}

      <AnkiConfig
        connected={status.connected}
        courses={courses.map((c) => ({
          id: c.id,
          name: c.name,
          schemas: c.schemas.map((s) => ({ id: s.id, name: s.name })),
        }))}
        mappings={mappings.map((m) => ({
          id: m.id,
          deckName: m.deckName,
          courseId: m.courseId,
          courseName: m.course.name,
          courseSlug: m.course.slug,
          schemaId: m.schemaId,
          schemaName: m.contentSchema?.name ?? null,
          countsKnownWords: m.countsKnownWords,
          adaptiveNewCards: m.adaptiveNewCards,
          cards: m._count.cards,
          reviews: m._count.reviewLogs,
          lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
        }))}
      />

      <Section title="Recent syncs">
        {syncRuns.length === 0 ? (
          <Card className="p-3 text-[12px] text-muted">No syncs yet.</Card>
        ) : (
          <div className="space-y-1.5">
            {syncRuns.map((run) => (
              <Card key={run.id} className="flex items-center justify-between p-2.5 text-[12px]">
                <span className="text-muted">{run.startedAt.toISOString().replace('T', ' ').slice(0, 16)}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  {run.status === 'ok' ? (
                    <>
                      <span>{run.decksSynced} decks · {run.cardsSynced} cards · {run.reviewsAdded} new reviews</span>
                      <Badge tone={statusTone('COMPLETED')}>ok</Badge>
                    </>
                  ) : run.status === 'error' ? (
                    <>
                      <span className="max-w-72 truncate text-red-300">{run.error}</span>
                      <Badge tone="red">error</Badge>
                    </>
                  ) : (
                    <Badge tone="amber">{fmtStatus(run.status)}</Badge>
                  )}
                </span>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
