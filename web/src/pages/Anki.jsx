import { A } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { del, post, useApi } from '../lib/api';
import { dateTime, num, relative } from '../lib/format';
import { ankiRelay } from '../lib/anki-relay';
import { attempt } from '../lib/store';
import { AnkiSyncButton } from '../components/AnkiSync';
import { Icon } from '../components/icons';
import { Badge, Card, Disclosure, Empty, Field, Load, Page, Pills, Section, Stat, StatGrid, Toggle } from '../components/ui';

function AddMapping(props) {
  const decks = useApi(() => '/anki/decks');
  const [deck, setDeck] = createSignal('');
  const [courseId, setCourseId] = createSignal(props.courses[0]?.id);
  const [schemaId, setSchemaId] = createSignal('');
  const course = () => props.courses.find((c) => c.id === courseId());
  const unmapped = () => (decks.data()?.decks ?? []).filter((d) => !props.mapped.includes(d));
  const save = async () => {
    if (await attempt(() => post('/anki/mappings', { deckName: deck(), courseId: courseId(), schemaId: schemaId() || null }), 'Deck mapped — syncing picks it up next.')) setDeck('');
  };
  return (
    <div class="space-y-3">
      <Show when={decks.data()?.connected !== false} fallback={<p class="text-[12.5px] text-warn">Anki isn’t reachable, so the deck list is unavailable.</p>}>
        <Field label="Deck">
          <div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            <For each={unmapped()} fallback={<span class="text-[12px] text-muted">{decks.data() ? 'Every deck is mapped.' : 'Loading decks…'}</span>}>
              {(d) => <button class="pill" aria-pressed={deck() === d} onClick={() => setDeck(d)}>{d}</button>}
            </For>
          </div>
        </Field>
      </Show>
      <Field label="Course"><Pills value={courseId()} onChange={(v) => { setCourseId(v); setSchemaId(''); }} options={props.courses.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <Show when={course()?.schemas.length}>
        <Field label="Content type (optional)">
          <Pills value={schemaId()} onChange={setSchemaId} options={[{ value: '', label: 'Whole course' }, ...course().schemas.map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
      </Show>
      <button class="btn btn-primary" disabled={!deck() || !courseId()} onClick={save}>Map deck</button>
    </div>
  );
}

export default function Anki() {
  const q = useApi(() => '/anki');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Anki" glyph="★" subtitle="Anki is the review engine for mapped decks; Kaizen snapshots cards and reviews for analytics" actions={<AnkiSyncButton />}>
          <Card class={`mb-6 flex flex-wrap items-center gap-3 ${d.connection.connected ? '' : 'border-warn/40 bg-warn-soft'}`}>
            <span class={`h-2.5 w-2.5 rounded-full ${d.connection.connected ? 'bg-good' : 'bg-warn'}`} />
            <div class="flex-1 text-[13px]">
              <Show when={d.connection.connected} fallback={<>
                <b>Anki isn’t reachable.</b> Start Anki with the AnkiConnect add-on (2055492159).
                <Show when={d.connection.transport !== 'direct'}> In the cloud, keep a Kaizen tab open on the computer running Anki and allow this site in AnkiConnect’s <code class="font-mono">webCorsOriginList</code>.</Show>
              </>}>
                Connected to AnkiConnect v{d.connection.version} <span class="text-muted">· via {d.connection.transport === 'relay' ? 'this browser (relay)' : 'the server (direct)'}</span>
              </Show>
            </div>
            <Show when={ankiRelay.status() !== 'off'}><Badge tone={ankiRelay.status() === 'ready' ? 'good' : 'warn'}>relay {ankiRelay.status()}</Badge></Show>
          </Card>

          <StatGrid cols="md:grid-cols-3">
            <Stat label="Mapped decks" value={d.totals.mappings} />
            <Stat label="Cards snapshotted" value={num(d.totals.cards)} />
            <Stat label="Reviews logged" value={num(d.totals.reviews)} />
          </StatGrid>

          <Section title="Deck mappings">
            <Show when={d.mappings.length} fallback={<Empty class="mb-3">No decks mapped yet.</Empty>}>
              <div class="space-y-2">
                <For each={d.mappings}>
                  {(m) => (
                    <Card class="flex flex-wrap items-center gap-x-5 gap-y-2 p-3.5">
                      <div class="min-w-[200px] flex-1">
                        <div class="text-[13.5px] font-semibold">{m.deckName}</div>
                        <div class="text-[12px] text-muted">{m.courseName}{m.schemaName ? ` · ${m.schemaName}` : ''} · <span class="tnum">{num(m.cards)} cards · {num(m.reviews)} reviews</span> · synced {relative(m.lastSyncedAt)}</div>
                      </div>
                      <Toggle checked={m.countsKnownWords} onChange={() => attempt(() => post(`/anki/mappings/${m.id}/words`))} label="Known words" />
                      <Show when={m.courseSlug === 'japanese'}>
                        <Toggle checked={m.adaptiveNewCards} onChange={() => attempt(() => post(`/anki/mappings/${m.id}/adaptive`))} label="Adaptive new cards" />
                      </Show>
                      <button class="btn btn-ghost btn-sm text-faint" title="Unmap" onClick={() => confirm(`Unmap ${m.deckName}? Its snapshots and logs are removed from Kaizen (Anki is untouched).`) && attempt(() => del(`/anki/mappings/${m.id}`))}><Icon name="trash" size={14} /></button>
                    </Card>
                  )}
                </For>
              </div>
            </Show>
            <div class="mt-3"><Disclosure title="Map a deck"><AddMapping courses={d.courses} mapped={d.mappings.map((m) => m.deckName)} /></Disclosure></div>
          </Section>

          <Section title="Adaptive new cards" actions={<A href="/configurations?section=japanese" class="text-[12px] text-accent-text hover:underline">Settings →</A>}>
            <Show when={d.adaptive.settings.enabled} fallback={<Empty>Adaptive new-card budgets are off. Turn them on under Configurations → Japanese.</Empty>}>
              <Card>
                <div class="flex flex-wrap items-center gap-x-8 gap-y-2">
                  <div><div class="text-[11px] uppercase tracking-wider text-muted">Today’s budget</div><div class="tnum text-[26px] font-semibold">{d.adaptive.latest?.finalBudget ?? d.adaptive.currentBudget ?? '—'}<span class="text-[13px] font-normal text-muted"> new cards</span></div></div>
                  <div class="text-[12.5px] text-muted">
                    <div>{d.adaptive.participating} participating deck{d.adaptive.participating === 1 ? '' : 's'} · {d.adaptive.reliableDays} reliable data days</div>
                    <Show when={d.adaptive.latest}><div>Calculated {dateTime(d.adaptive.latest.calculatedAt)} · apply <Badge tone={d.adaptive.latest.applyStatus === 'applied' ? 'good' : d.adaptive.latest.applyStatus === 'failed' ? 'bad' : 'neutral'}>{d.adaptive.latest.applyStatus}</Badge></div></Show>
                  </div>
                </div>
                <Show when={d.adaptive.latest?.reasons?.length}>
                  <ul class="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-muted"><For each={d.adaptive.latest.reasons}>{(r) => <li>{r}</li>}</For></ul>
                </Show>
                <Show when={d.adaptive.history.length > 1}>
                  <div class="mt-4 flex flex-wrap gap-1.5">
                    <For each={d.adaptive.history}>{(h) => <span class="tnum rounded-md bg-surface-2 px-2 py-1 text-[11.5px]" title={h.reasons?.join('\n')}>{h.ankiDay.slice(5)} · {h.finalBudget}</span>}</For>
                  </div>
                </Show>
              </Card>
            </Show>
          </Section>

          <Section title="Recent syncs">
            <Card pad={false}>
              <div class="divide-y divide-line">
                <For each={d.runs} fallback={<p class="p-4 text-[12.5px] text-muted">No syncs yet.</p>}>
                  {(r) => (
                    <div class="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                      <Badge tone={r.status === 'ok' ? 'good' : r.status === 'error' ? 'bad' : 'neutral'}>{r.status}</Badge>
                      <span class="text-muted">{dateTime(r.startedAt)}</span>
                      <span class="tnum flex-1 text-right">{r.decksSynced} decks · {num(r.cardsSynced)} cards · +{num(r.reviewsAdded)} reviews</span>
                      <Show when={r.error}><span class="text-bad">{r.error}</span></Show>
                    </div>
                  )}
                </For>
              </div>
            </Card>
          </Section>
        </Page>
      )}
    </Load>
  );
}
