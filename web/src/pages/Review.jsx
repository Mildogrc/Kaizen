import { A, useSearchParams } from '@solidjs/router';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { api, invalidate, post, useApi } from '../lib/api';
import { toast } from '../lib/store';
import { AnkiSyncButton } from '../components/AnkiSync';
import { num, relative } from '../lib/format';
import { attempt } from '../lib/store';
import { Badge, Card, Empty, Load, Metric, MetricRow, Page, Pills, Section } from '../components/ui';

const RATINGS = [
  { value: 'AGAIN', label: 'Again', key: '1', tone: 'var(--bad)' },
  { value: 'HARD', label: 'Hard', key: '2', tone: 'var(--warn)' },
  { value: 'GOOD', label: 'Good', key: '3', tone: 'var(--info)' },
  { value: 'EASY', label: 'Easy', key: '4', tone: 'var(--good)' },
];

/** Generic flip-and-rate session over a list of cards. */
function Session(props) {
  const [index, setIndex] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);
  const [done, setDone] = createSignal(0);
  const [requeue, setRequeue] = createSignal([]);
  const queue = createMemo(() => [...props.cards, ...requeue()]);
  const card = () => queue()[index()];
  const rate = async (rating) => {
    const c = card();
    if (!c || !revealed()) return;
    try {
      await api(props.ratePath(c), { method: 'POST', body: { rating } });
    } catch (err) {
      toast(err.message, 'bad');
      return;
    }
    if (rating === 'AGAIN') setRequeue((r) => [...r, c]);
    setDone((n) => n + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
    if (index() >= queue().length) invalidate();
  };
  const onKey = (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRevealed(true); }
    const r = RATINGS.find((x) => x.key === e.key);
    if (r) rate(r.value);
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  return (
    <Show when={card()} fallback={
      <Card class="py-10 text-center">
        <div class="text-[15px] font-semibold">{done() ? 'Session complete ✓' : 'Nothing due right now'}</div>
        <p class="mt-1 text-[13px] text-muted">{done() ? `${done()} reviews done.` : 'New cards appear as you import content and generate cards.'}</p>
      </Card>
    }>
      <div class="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span class="tnum">{index() + 1} / {queue().length}</span>
        <span>Space to reveal · 1–4 to rate</span>
      </div>
      <Card class="min-h-[300px]">
        {props.render(card(), revealed())}
      </Card>
      <div class="mt-3 flex flex-wrap justify-center gap-2">
        <Show when={revealed()} fallback={<button class="btn btn-primary h-10 px-8" onClick={() => setRevealed(true)}>Show answer</button>}>
          <For each={props.ratings ?? RATINGS}>
            {(r) => (
              <button class="btn h-10 min-w-[88px] font-semibold" style={{ color: r.tone, 'border-color': `color-mix(in srgb, ${r.tone} 40%, transparent)` }} onClick={() => rate(r.value)}>
                {r.label}<span class="kbd ml-1">{r.key}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
}

function AnkiDecks(props) {
  const s = () => props.summary;
  return (
    <Section title="Your decks" actions={<AnkiSyncButton small />}>
      <Show when={s().decks.length} fallback={<Empty>No decks yet. <A class="text-accent-text underline" href="/settings/anki">Connect Anki</A> to review from here.</Empty>}>
        <Card pad={false}>
          <For each={s().decks}>
            {(x) => (
              <div class="kz-task">
                <span class="kz-task__title min-w-0 truncate" title={x.deck}>{x.deck}</span>
                <A href={`/tracks/${x.slug}`} class="kz-task__track hover:underline">{x.track}</A>
                <span class="kz-task__detail flex items-center gap-3">
                  <Show when={x.due} fallback={<span>✓ done</span>}>
                    <span class="tnum">{num(x.due)} cards · ~{x.time}</span>
                    <button class="btn btn-sm" onClick={() => attempt(() => post('/anki/open', { deck: x.deck }))}>Review in Anki</button>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </Card>
        <p class="mt-2 text-[12px] text-muted">Anki does the scheduling, so these cards open in Anki. Synced {relative(s().lastSyncedAt)}.</p>
      </Show>
    </Section>
  );
}

export default function Review() {
  const [params, setParams] = useSearchParams();
  const type = () => (params.type === 'grammar' ? 'grammar' : 'flashcards');
  const q = useApi(() => `/review${type() === 'grammar' ? '?type=grammar' : ''}`);
  const summary = useApi(() => '/review/summary');
  return (
    <Load q={q}>
      {(d) => {
        const own = () => d.stats.queued + d.stats.grammarDue;
        const total = () => (summary.data()?.ankiDue ?? 0) + d.stats.queued;
        return (
          <Page title="Review" subtitle="Every card due, across every deck">
            <MetricRow>
              <Metric noun="Cards due" value={total() ? num(total()) : 'None'} meaning={summary.data()?.ankiTime ? `about ${summary.data().ankiTime} in Anki` : 'Nothing due — add 10 new cards in Anki?'} />
              <Show when={d.stats.leeches}><Metric noun="Keep failing" value={num(d.stats.leeches)} meaning="cards to rewrite or look at again" /></Show>
            </MetricRow>
            <Show when={summary.data()}><AnkiDecks summary={summary.data()} /></Show>
            <Show when={own() || d.stats.total}>
              <Section title="Kaizen’s own cards">
                <Pills class="mb-5" value={type()} onChange={(t) => setParams({ type: t === 'grammar' ? 'grammar' : undefined })}
                  options={[{ value: 'flashcards', label: 'Cards', count: d.stats.queued }, { value: 'grammar', label: 'Japanese grammar', count: d.stats.grammarDue }]} />
                <div class="mx-auto max-w-2xl">
                  <Show when={d.type === 'grammar'} fallback={
                    <Session cards={d.cards} ratePath={(c) => `/review/${c.recordId}/rate`} render={(c, revealed) => (
                      <div class="flex min-h-[260px] flex-col">
                        <div class="mb-3 flex items-center gap-2">
                          <Badge>{c.courseName}</Badge>
                          <Show when={c.practiceType}><Badge tone="info">{c.practiceType.toLowerCase()}</Badge></Show>
                          <Badge tone={c.maturity === 'NEW' ? 'good' : 'neutral'}>{c.maturity.toLowerCase()}</Badge>
                        </div>
                        <div class="flex-1 whitespace-pre-wrap text-center text-[28px] font-medium leading-[36px]">{c.front}</div>
                        <Show when={revealed}><div class="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-center text-[15px] text-muted">{c.back}</div></Show>
                      </div>
                    )} />
                  }>
                    <Show when={d.grammarCards.length} fallback={<Empty>No grammar reviews due. New points arrive through the <A class="text-accent-text underline" href="/tracks/japanese/grammar">grammar coach</A>.</Empty>}>
                      <Session cards={d.grammarCards} ratePath={(c) => `/review/grammar/${c.progressId}/rate`} render={(c, revealed) => (
                        <div class="flex min-h-[260px] flex-col">
                          <div class="mb-3 flex items-center gap-2"><Badge tone="accent">{c.level}</Badge><Badge>{c.status.toLowerCase()}</Badge></div>
                          <div class="flex-1 text-center text-[28px] font-medium leading-[36px]" lang="ja">{c.pattern}</div>
                          <Show when={revealed}>
                            <div class="mt-4 border-t border-line pt-4 text-center">
                              <div class="text-[15px]">{c.meaning}</div>
                              <ul class="mt-2 space-y-1 text-[13px] text-muted" lang="ja"><For each={c.examples}>{(ex) => <li>{ex}</li>}</For></ul>
                            </div>
                          </Show>
                        </div>
                      )} />
                    </Show>
                  </Show>
                </div>
              </Section>
            </Show>
          </Page>
        );
      }}
    </Load>
  );
}
