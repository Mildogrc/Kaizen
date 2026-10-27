import { A, useSearchParams } from '@solidjs/router';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { api, invalidate, useApi } from '../lib/api';
import { toast } from '../lib/store';
import { Badge, Card, Empty, Load, Page, Pills, Stat, StatGrid } from '../components/ui';

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
        <div class="text-[18px] font-semibold">{done() ? 'Session complete ✓' : 'Nothing due right now'}</div>
        <p class="mt-1 text-[12.5px] text-muted">{done() ? `${done()} reviews done.` : 'New cards appear as you import content and generate cards.'}</p>
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

export default function Review() {
  const [params, setParams] = useSearchParams();
  const type = () => (params.type === 'grammar' ? 'grammar' : 'flashcards');
  const q = useApi(() => `/review${type() === 'grammar' ? '?type=grammar' : ''}`);
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Review" glyph="↻" subtitle="In-app flashcards, practice items, and Japanese grammar. Anki decks are reviewed in Anki."
          actions={<A href="/anki" class="btn">Anki</A>}>
          <StatGrid>
            <Stat label="Flashcards queued" value={d.stats.queued} />
            <Stat label="Grammar due" value={d.stats.grammarDue} />
            <Stat label="Total cards" value={d.stats.total} />
            <Stat label="Leeches / suspended" value={`${d.stats.leeches} / ${d.stats.suspended}`} />
          </StatGrid>
          <Pills class="mb-5" value={type()} onChange={(t) => setParams({ type: t === 'grammar' ? 'grammar' : undefined })}
            options={[{ value: 'flashcards', label: 'Flashcards', count: d.stats.queued }, { value: 'grammar', label: 'Japanese grammar', count: d.stats.grammarDue }]} />
          <div class="mx-auto max-w-2xl">
            <Show when={d.type === 'grammar'} fallback={
              <Session cards={d.cards} ratePath={(c) => `/review/${c.recordId}/rate`} render={(c, revealed) => (
                <div class="flex min-h-[260px] flex-col">
                  <div class="mb-3 flex items-center gap-2">
                    <Badge><span style={{ color: c.courseColor ?? undefined }}>{c.courseName}</span></Badge>
                    <Show when={c.practiceType}><Badge tone="info">{c.practiceType.toLowerCase()}</Badge></Show>
                    <Badge tone={c.maturity === 'NEW' ? 'good' : 'neutral'}>{c.maturity.toLowerCase()}</Badge>
                  </div>
                  <div class="flex-1 whitespace-pre-wrap text-center text-[22px] font-medium leading-relaxed">{c.front}</div>
                  <Show when={revealed}><div class="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-center text-[16px] text-muted">{c.back}</div></Show>
                </div>
              )} />
            }>
              <Show when={d.grammarCards.length} fallback={<Empty>No grammar reviews due. New points arrive through the <A class="text-accent-text underline" href="/japanese/grammar">grammar coach</A>.</Empty>}>
                <Session cards={d.grammarCards} ratePath={(c) => `/review/grammar/${c.progressId}/rate`} render={(c, revealed) => (
                  <div class="flex min-h-[260px] flex-col">
                    <div class="mb-3 flex items-center gap-2"><Badge tone="accent">{c.level}</Badge><Badge>{c.status.toLowerCase()}</Badge></div>
                    <div class="flex-1 text-center text-[26px] font-semibold">{c.pattern}</div>
                    <Show when={revealed}>
                      <div class="mt-4 border-t border-line pt-4 text-center">
                        <div class="text-[15px]">{c.meaning}</div>
                        <ul class="mt-2 space-y-1 text-[13.5px] text-muted"><For each={c.examples}>{(ex) => <li>{ex}</li>}</For></ul>
                      </div>
                    </Show>
                  </div>
                )} />
              </Show>
            </Show>
          </div>
        </Page>
      )}
    </Load>
  );
}
