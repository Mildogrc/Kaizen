import { prisma } from '@/lib/db';
import { ankiStatus } from '@/lib/anki-connect';
import { Badge, Card, PageHeader, Section, StatCard, fmtStatus, statusTone } from '@/components/ui';
import { AnkiConfig } from './config';

export const dynamic = 'force-dynamic';

export default async function AnkiPage() {
  const [status, mappings, courses, syncRuns, snapshotCount, reviewLogCount] = await Promise.all([
    ankiStatus(),
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
  ]);

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
          schemaId: m.schemaId,
          schemaName: m.contentSchema?.name ?? null,
          countsKnownWords: m.countsKnownWords,
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
