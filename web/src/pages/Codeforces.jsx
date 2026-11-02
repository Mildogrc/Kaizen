import { A, useSearchParams } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { dateTime, num, pct } from '../lib/format';
import { toast } from '../lib/store';
import { Bars, Heatmap, LineChart } from '../components/charts';
import { Badge, Card, Empty, Load, Metric, MetricRow, Page, Section, Table } from '../components/ui';

function Connect(props) {
  const [value, setValue] = createSignal(props.initial ?? '');
  const [busy, setBusy] = createSignal(false);
  const sync = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/codeforces/sync', { input: value() });
      toast(`Synced ${r.summary.handle}: ${num(r.summary.submissions)} submissions, ${r.summary.ratingChanges} contests`, 'good');
      props.onSynced?.(r.summary.profileId);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={sync} class="flex flex-wrap gap-2">
      <input class="input max-w-md flex-1" value={value()} onInput={(e) => setValue(e.currentTarget.value)} placeholder="https://codeforces.com/profile/tourist or a handle" required />
      <button class="btn btn-primary" disabled={busy()}>{busy() ? 'Syncing (takes a few seconds)…' : 'Sync profile'}</button>
    </form>
  );
}

export default function Codeforces() {
  const [params, setParams] = useSearchParams();
  const q = useApi(() => `/codeforces${params.profile ? `?profile=${params.profile}` : ''}`);
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Codeforces" glyph="</>" back={{ href: '/tracks', label: 'Tracks' }} subtitle="Problem-rating analytics, contest performance, and consistency from a public profile">
          <Card class="mb-5">
            <Connect initial={d.selected?.profileUrl} onSynced={(id) => setParams({ profile: id })} />
            <p class="mt-2 text-[12px] text-muted">Public data only: the profile, up to 10,000 submissions, and rated contests.</p>
          </Card>
          <Show when={d.profiles.length > 1}>
            <div class="mb-4 flex flex-wrap gap-1.5">
              <For each={d.profiles}>{(p) => <button class="pill" aria-pressed={d.selected?.id === p.id} onClick={() => setParams({ profile: p.id })}>{p.handle}</button>}</For>
            </div>
          </Show>
          <Show when={d.selected && d.analytics} fallback={<Empty>Paste a Codeforces profile above to build the dashboard.</Empty>}>
            <div class="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <a href={d.selected.profileUrl} target="_blank" rel="noreferrer" class="font-medium text-accent-text hover:underline">{d.selected.displayName ? `${d.selected.displayName} · ` : ''}{d.selected.handle} ↗</a>
              <Show when={d.selected.rank}><Badge tone="info">{d.selected.rank}</Badge></Show>
              <Show when={d.selected.lastSyncedAt}><span>synced {dateTime(d.selected.lastSyncedAt)}</span></Show>
              <Show when={d.selected.syncError}><span class="text-bad">last sync failed: {d.selected.syncError}</span></Show>
            </div>
            <MetricRow>
              <Metric noun="Rating" value={d.selected.rating ?? 'Unrated'} meaning={d.selected.maxRating ? `best ${d.selected.maxRating}` : undefined} />
              <Metric noun="Solved" value={`${num(d.analytics.solved)} problems`} meaning={`${pct(d.analytics.solveRate)} of ${num(d.analytics.attempted)} attempted`} />
              <Metric noun="Hardest solved" value={d.analytics.maxSolvedRating ?? '—'} meaning={d.analytics.averageSolvedRating ? `average ${d.analytics.averageSolvedRating}` : undefined} />
            </MetricRow>
            <Section title="Accepted problems"><Card><Heatmap days={d.analytics.heatmap} unit="accepted" thresholds={[1, 2, 4]} /></Card></Section>
            <div class="grid gap-5 xl:grid-cols-2">
              <Section title="Solved by rating">
                <Card><Bars data={d.analytics.ratingBuckets.map((b) => ({ label: b.rating, value: b.solved, tooltip: `${b.rating}: ${b.solved}/${b.attempted} solved (${b.successPct}%)` }))} color="var(--warn)" height={160} /></Card>
              </Section>
              <Section title="Contest rating">
                <Card>
                  <LineChart data={d.analytics.ratingTrend} color="#a78bfa" zero={false} />
                  <div class="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
                    <span><b class="text-text">{d.analytics.contests}</b> rated contests</span>
                    <span>best rank <b class="text-text">{d.analytics.bestContestRank ?? '—'}</b></span>
                    <span>average rank <b class="text-text">{d.analytics.averageContestRank ?? '—'}</b></span>
                  </div>
                </Card>
              </Section>
            </div>
            <div class="grid gap-5 xl:grid-cols-2">
              <Section title="Strongest tags">
                <Card pad={false}>
                  <div class="divide-y divide-line">
                    <For each={d.analytics.tagStats} fallback={<p class="p-4 text-[13px] text-muted">No tagged solves yet.</p>}>
                      {(t, i) => <div class="flex items-center gap-3 px-4 py-2 text-[13px]"><span class="w-5 text-muted">{i() + 1}</span><span class="flex-1">{t.tag}</span><span class="tnum text-muted">{t.solved} solved</span></div>}
                    </For>
                  </div>
                </Card>
              </Section>
              <Section title="Recent accepted">
                <Card pad={false}>
                  <div class="divide-y divide-line">
                    <For each={d.analytics.recentSolved} fallback={<p class="p-4 text-[13px] text-muted">No accepted submissions yet.</p>}>
                      {(p) => <div class="flex items-center gap-3 px-4 py-2 text-[13px]"><span class="w-8 font-semibold text-accent-text">{p.index}</span><span class="min-w-0 flex-1 truncate">{p.name}</span><span class="tnum text-muted">{p.rating ?? 'unrated'}</span><span class="hidden text-muted sm:inline">{p.date}</span></div>}
                    </For>
                  </div>
                </Card>
              </Section>
            </div>
            <Show when={d.contests.length}>
              <Section title="Recent contests">
                <Table rows={d.contests} columns={[
                  { label: 'Contest', key: 'contestName' },
                  { label: 'Rank', key: 'rank', align: 'right' },
                  { label: 'Rating', key: 'rating', align: 'right' },
                  { label: 'Δ', align: 'right', render: (c) => <span class={c.delta >= 0 ? 'text-good' : 'text-bad'}>{c.delta >= 0 ? '+' : ''}{c.delta}</span> },
                  { label: 'Date', key: 'date', align: 'right' },
                ]} />
              </Section>
            </Show>
          </Show>
          <p class="text-[12px] text-muted">More history lives under <A href="/insights?area=codeforces" class="text-accent-text hover:underline">Analytics</A>.</p>
        </Page>
      )}
    </Load>
  );
}
