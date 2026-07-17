'use client';

// Deck mapping configuration: pick a course, optionally a subsection (content
// type), then attach one of your Anki decks. Deck lists come live from
// AnkiConnect; mappings persist and drive sync + analytics.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAnkiDecks, removeDeckMapping, runAnkiSync, saveDeckMapping, toggleMappingWordCount } from '@/lib/actions';
import { Badge, Card, Section, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';

interface CourseOpt {
  id: string;
  name: string;
  schemas: { id: string; name: string }[];
}

interface MappingRow {
  id: string;
  deckName: string;
  courseId: string;
  courseName: string;
  schemaId: string | null;
  schemaName: string | null;
  countsKnownWords: boolean;
  cards: number;
  reviews: number;
  lastSyncedAt: string | null;
}

export function AnkiConfig({ connected, courses, mappings }: { connected: boolean; courses: CourseOpt[]; mappings: MappingRow[] }) {
  const router = useRouter();
  const [decks, setDecks] = useState<string[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [schemaId, setSchemaId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckFilter, setDeckFilter] = useState('');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();

  useEffect(() => {
    if (!connected) return;
    fetchAnkiDecks().then((r) => setDecks(r.decks)).catch(() => setDecks([]));
  }, [connected]);

  const course = courses.find((c) => c.id === courseId) ?? null;
  const mappedDecks = new Set(mappings.map((m) => m.deckName));
  const availableDecks = (decks ?? []).filter(
    (d) => !mappedDecks.has(d) && d.toLowerCase().includes(deckFilter.toLowerCase()),
  );

  const save = () => {
    if (!deckName || !courseId) return;
    startTransition(async () => {
      await saveDeckMapping({ deckName, courseId, schemaId });
      setDeckName('');
      setSchemaId(null);
      router.refresh();
    });
  };

  const sync = () => {
    setSyncMessage(null);
    startSync(async () => {
      const result = await runAnkiSync();
      setSyncMessage(
        result.ok
          ? `✓ Synced ${result.decksSynced} decks — ${result.cardsSynced} cards, ${result.reviewsAdded} new review entries.`
          : `✗ ${result.error}`,
      );
      router.refresh();
    });
  };

  const pill = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
      active
        ? 'border-accent bg-accent/15 text-accent'
        : 'border-line bg-surface-2 text-muted hover:border-accent/40 hover:text-foreground'
    }`;

  return (
    <>
      <Section
        title="Mapped decks"
        actions={
          <button onClick={sync} disabled={syncing || mappings.length === 0} className={`${btnPrimaryCls} disabled:opacity-40`}>
            {syncing ? 'Syncing…' : '⟳ Sync now'}
          </button>
        }
      >
        {syncMessage && (
          <div className={`mb-2 rounded-md border px-3 py-2 text-[12px] ${syncMessage.startsWith('✓') ? 'border-green-900 bg-green-950/40 text-green-300' : 'border-red-900 bg-red-950/40 text-red-300'}`}>
            {syncMessage}
          </div>
        )}
        {mappings.length === 0 ? (
          <Card className="p-3 text-[12px] text-muted">
            No decks mapped yet — attach your first deck below. Analytics appear after the first sync.
          </Card>
        ) : (
          <div className="space-y-1.5">
            {mappings.map((m) => (
              <Card key={m.id} className="flex items-center justify-between gap-3 p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{m.deckName}</div>
                  <div className="text-[11px] text-muted">
                    → {m.courseName}
                    {m.schemaName ? ` / ${m.schemaName}` : ' (course-level)'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted tabular-nums">
                  <button
                    onClick={() => startTransition(async () => { await toggleMappingWordCount(m.id); router.refresh(); })}
                    className={`rounded border px-1.5 py-0.5 text-[10px] cursor-pointer transition-colors ${
                      m.countsKnownWords
                        ? 'border-cyan-700 bg-cyan-950/40 text-cyan-300'
                        : 'border-line text-muted hover:text-foreground'
                    }`}
                    title="Mature cards from this deck feed the known-word count"
                  >
                    {m.countsKnownWords ? '✓ counts words' : 'counts words: off'}
                  </button>
                  <span>{m.cards} cards · {m.reviews} reviews</span>
                  <Badge tone={m.lastSyncedAt ? 'green' : 'neutral'}>
                    {m.lastSyncedAt ? `synced ${m.lastSyncedAt.slice(0, 10)}` : 'never synced'}
                  </Badge>
                  <button
                    onClick={() => startTransition(async () => { await removeDeckMapping(m.id); router.refresh(); })}
                    className="text-muted hover:text-red-400 cursor-pointer"
                    title="Remove mapping (snapshots and history for this deck are deleted)"
                  >
                    ✕
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Attach a deck">
        <Card className="space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">1 · Section</div>
            <div className="flex flex-wrap gap-1.5">
              {courses.map((c) => (
                <button key={c.id} onClick={() => { setCourseId(c.id); setSchemaId(null); }} className={pill(courseId === c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {course && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">2 · Subsection (optional)</div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setSchemaId(null)} className={pill(schemaId === null)}>
                  Whole course
                </button>
                {course.schemas.map((s) => (
                  <button key={s.id} onClick={() => setSchemaId(s.id)} className={pill(schemaId === s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {course && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-muted">3 · Anki deck</div>
              {!connected ? (
                <p className="text-[12px] text-muted">Start Anki (with AnkiConnect) to list your decks.</p>
              ) : decks === null ? (
                <p className="text-[12px] text-muted">Loading decks…</p>
              ) : (
                <>
                  {decks.length > 12 && (
                    <input
                      value={deckFilter}
                      onChange={(e) => setDeckFilter(e.target.value)}
                      placeholder="Filter decks…"
                      className={`${inputCls} mb-2 max-w-xs`}
                    />
                  )}
                  <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                    {availableDecks.length === 0 ? (
                      <p className="text-[12px] text-muted">No unmapped decks{deckFilter ? ' match the filter' : ' found'}.</p>
                    ) : (
                      availableDecks.map((d) => (
                        <button key={d} onClick={() => setDeckName(d)} className={pill(deckName === d)}>
                          {d}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {deckName && course && (
            <button onClick={save} disabled={pending} className={`${btnPrimaryCls} disabled:opacity-50`}>
              {pending ? 'Saving…' : `Attach "${deckName}" → ${course.name}${schemaId ? ` / ${course.schemas.find((s) => s.id === schemaId)?.name}` : ''}`}
            </button>
          )}
        </Card>
      </Section>
    </>
  );
}
