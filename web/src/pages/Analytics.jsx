import { A, useSearchParams } from '@solidjs/router';
import { For, Match, Show, Switch } from 'solid-js';
import { ai } from '../lib/ai';
import { api, useApi } from '../lib/api';
import { date, num, pct } from '../lib/format';
import { attempt } from '../lib/store';
import { Bars, Heatmap, HBars, LineChart } from '../components/charts';
import { Icon } from '../components/icons';
import { Badge, Card, Empty, Load, Page, Pills, Section, Stat, StatGrid } from '../components/ui';

const AREAS = [
  { value: 'japanese', label: '日 Japanese' },
  { value: 'chinese', label: '中 Chinese' },
  { value: 'codeforces', label: 'Codeforces' },
  { value: 'nato', label: 'NATO' },
  { value: 'reading', label: 'Speed reading' },
  { value: 'books', label: 'Books' },
  { value: 'meditation', label: 'Meditation' },
];
const STATE_COLORS = { NEW: 'var(--faint)', LEARNING: 'var(--warn)', YOUNG: 'var(--info)', MATURE: 'var(--good)', SUSPENDED: 'var(--bad)', BURIED: 'var(--muted)' };

async function leechPlan(mappingId, deckName) {
  const res = await attempt(() => api(`/anki/leech-plan/${mappingId}`, { raw: true }));
  if (!res) return;
  ai.ask({ kind: 'leech-plan', ref: mappingId, title: `Leech plan · ${deckName}`, prompt: await res.text() });
}

function AnkiSection(props) {
  const s = props.section;
  return (
    <div class="mb-10">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-[16px] font-semibold" style={{ color: s.course.color ?? undefined }}>{s.course.name}</h2>
        <span class="text-[11.5px] text-muted">{s.decks.map((dk) => dk.deckName).join(' · ')}</span>
      </div>
      <StatGrid cols="md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Cards" value={num(s.cards)} />
        <Stat label="Reviews (30d)" value={num(s.reviews30)} hint={`${num(s.minutes30)} minutes`} />
        <Stat label="Streak" value={`${s.streak.current}d`} hint={`best ${s.streak.best}d`} />
        <Stat label="Retention" value={pct(s.retention.overall)} hint={`${num(s.retention.reviewCount)} reviews`} />
        <Stat label="Mature retention" value={pct(s.retention.mature)} hint={`young ${pct(s.retention.young)}`} />
        <Stat label="Overdue" value={num(s.forecast.overdue)} color={s.forecast.overdue ? 'var(--warn)' : undefined} />
      </StatGrid>
      <Section title="Reviews · last year"><Card><Heatmap days={s.activity365} thresholds={[1, 20, 60, 120]} /></Card></Section>
      <div class="grid gap-5 xl:grid-cols-2">
        <Section title="Last 30 days">
          <Card><Bars data={s.activity30.map((x) => ({ label: x.date.slice(5), value: x.reviews, tooltip: `${x.date}: ${x.reviews} reviews · ${x.minutes} min` }))} height={150} /></Card>
        </Section>
        <Section title="Due · next 30 days">
          <Card><Bars data={s.forecast.days.map((x) => ({ label: x.date.slice(5), value: x.due, tooltip: `${x.date}: ${x.due} due` }))} color="var(--warn)" height={150} /></Card>
        </Section>
      </div>
      <div class="grid gap-5 xl:grid-cols-3">
        <Section title="Card states">
          <Card><HBars data={Object.entries(s.health.states).map(([k, v]) => ({ label: k.toLowerCase(), value: v, color: STATE_COLORS[k] }))} /></Card>
        </Section>
        <Section title="Ease">
          <Card><HBars data={s.health.easeHistogram.map((b) => ({ label: b.label, value: b.count }))} color="var(--info)" /></Card>
        </Section>
        <Section title="Intervals">
          <Card><HBars data={s.health.intervalBuckets.map((b) => ({ label: b.label, value: b.count }))} color="var(--good)" /></Card>
        </Section>
      </div>
      <Show when={s.projections.length}>
        <Section title="Projections">
          <div class="grid gap-3 md:grid-cols-2">
            <For each={s.projections}>
              {(p) => (
                <Card>
                  <div class="flex items-center justify-between gap-2"><span class="text-[13px] font-semibold">{p.label}</span><Badge tone={p.confidence === 'high' ? 'good' : p.confidence === 'medium' ? 'info' : 'neutral'}>{p.confidence} confidence</Badge></div>
                  <div class="mt-1 text-[18px] font-semibold">{p.date ? date(p.date) : '—'}</div>
                  <p class="mt-0.5 text-[12px] text-muted">{p.detail}</p>
                </Card>
              )}
            </For>
          </div>
        </Section>
      </Show>
      <Section title="Leeches">
        <div class="grid gap-3 md:grid-cols-2">
          <For each={s.leeches}>
            {(l) => (
              <Card>
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-[13px] font-semibold">{l.deckName}</span>
                  <Show when={l.cards.length}>
                    <span class="flex gap-1.5">
                      <button class="btn btn-sm btn-primary" onClick={() => leechPlan(l.mappingId, l.deckName)}><Icon name="sparkle" size={13} /> AI study plan</button>
                      <a class="btn btn-sm" rel="external" href={`/api/anki/leech-plan/${l.mappingId}?download=true`}><Icon name="download" size={13} /></a>
                    </span>
                  </Show>
                </div>
                <Show when={l.cards.length} fallback={<p class="text-[12.5px] text-muted">No leeches. 🎉</p>}>
                  <div class="max-h-64 divide-y divide-line overflow-y-auto">
                    <For each={l.cards}>
                      {(c) => (
                        <div class="flex items-center gap-3 py-1.5 text-[12.5px]">
                          <span class="min-w-0 flex-1 truncate">{c.front}</span>
                          <span class="min-w-0 flex-1 truncate text-muted">{c.back}</span>
                          <Badge tone="bad">{c.lapses} lapses</Badge>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>
            )}
          </For>
        </div>
      </Section>
    </div>
  );
}

function LanguageArea(props) {
  const kw = () => props.data.knownWords;
  return (
    <>
      <Show when={kw()}>
        <Card class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2">
          <div><div class="text-[11px] uppercase tracking-wider text-muted">Known words</div><div class="tnum text-[24px] font-semibold text-info">{kw().lowerBound === kw().upperBound ? num(kw().lowerBound) : `${num(kw().lowerBound)}–${num(kw().upperBound)}`}</div></div>
          <div class="tnum text-[12.5px] text-muted">Migaku {num(kw().migakuCount)} · Anki {num(kw().ankiCount)} · manual {num(kw().manualCount)}</div>
          <A href="/words" class="ml-auto text-[12.5px] text-accent-text hover:underline">Known words →</A>
        </Card>
      </Show>
      <Show when={props.data.sections.length} fallback={<Empty>Map an Anki deck to this course and sync to see analytics. <A href="/anki" class="text-accent-text underline">Set up Anki</A></Empty>}>
        <For each={props.data.sections}>{(s) => <AnkiSection section={s} />}</For>
      </Show>
    </>
  );
}

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const area = () => params.area ?? 'japanese';
  const q = useApi(() => `/analytics?area=${area()}`);
  return (
    <Page title="Analytics" glyph="∿" subtitle="Progress, retention, and consistency across everything you track">
      <Pills class="mb-6" value={area()} onChange={(a) => setParams({ area: a })} options={AREAS} />
      <Load q={q}>
        {(d) => (
          <Switch>
            <Match when={d.area === 'japanese' || d.area === 'chinese'}><LanguageArea data={d.data} /></Match>
            <Match when={d.area === 'codeforces'}>
              <Show when={d.data} fallback={<Empty>Connect a profile on the <A class="text-accent-text underline" href="/codeforces">Codeforces page</A>.</Empty>}>
                <StatGrid>
                  <Stat label="Rating" value={d.data.rating ?? '—'} hint={`max ${d.data.maxRating ?? '—'}`} />
                  <Stat label="Solved" value={num(d.data.analytics.solved)} />
                  <Stat label="Solve rate" value={pct(d.data.analytics.solveRate)} />
                  <Stat label="Contests" value={d.data.analytics.contests} />
                </StatGrid>
                <Section title="Accepted problems"><Card><Heatmap days={d.data.analytics.heatmap} unit="accepted" thresholds={[1, 2, 4]} /></Card></Section>
                <Section title="Rating trend"><Card><LineChart data={d.data.analytics.ratingTrend} color="#a78bfa" zero={false} /></Card></Section>
              </Show>
            </Match>
            <Match when={d.area === 'nato'}>
              <StatGrid>
                <Stat label="Sessions" value={d.data.analytics.sessions} />
                <Stat label="Accuracy" value={pct(d.data.analytics.accuracy)} />
                <Stat label="Avg recall" value={d.data.analytics.averageRecallMs == null ? '—' : `${(d.data.analytics.averageRecallMs / 1000).toFixed(1)}s`} />
                <Stat label="Attempts" value={num(d.data.analytics.totalAttempts)} />
              </StatGrid>
              <div class="grid gap-5 xl:grid-cols-2">
                <Section title="Average recall per session (ms)"><Card><LineChart data={d.data.trend} color="var(--info)" /></Card></Section>
                <Section title="Slowest letters (ms)"><Card><Bars data={d.data.slowest} color="var(--warn)" /></Card></Section>
              </div>
            </Match>
            <Match when={d.area === 'reading'}>
              <StatGrid cols="md:grid-cols-5">
                <Stat label="Sessions" value={d.data.stats.sessions} />
                <Stat label="Top speed" value={d.data.stats.maxWpm ? `${d.data.stats.maxWpm} WPM` : '—'} />
                <Stat label="Comprehension" value={pct(d.data.stats.accuracy)} />
                <Stat label="Retention" value={pct(d.data.stats.retention)} />
                <Stat label="Streak" value={`${d.data.stats.streak}d`} />
              </StatGrid>
              <div class="grid gap-5 xl:grid-cols-2">
                <Section title="Speed (WPM)"><Card><LineChart data={d.data.speed} color="var(--accent)" /></Card></Section>
                <Section title="Comprehension (%)"><Card><LineChart data={d.data.comprehension} color="var(--good)" /></Card></Section>
              </div>
              <Show when={d.data.groups.length}>
                <Section title="By topic and difficulty">
                  <Card pad={false}><div class="divide-y divide-line"><For each={d.data.groups}>{(g) => <div class="flex items-center gap-3 px-4 py-2 text-[12.5px]"><span class="flex-1">{g.category} · {g.difficulty}</span><span class="tnum">{g.wpm} WPM</span><span class="tnum w-14 text-right text-muted">{g.accuracy}%</span></div>}</For></div></Card>
                </Section>
              </Show>
            </Match>
            <Match when={d.area === 'books'}>
              <StatGrid>
                <Stat label="Reading" value={d.data.stats.reading} />
                <Stat label="Finished" value={d.data.stats.finished} />
                <Stat label="Pages logged" value={num(d.data.stats.pages)} />
                <Stat label="Time" value={d.data.stats.time} />
              </StatGrid>
              <Section title="Pages read · last year"><Card><Heatmap days={d.data.activity365} unit="pages" thresholds={[1, 10, 30, 60]} color="var(--warn)" /></Card></Section>
              <div class="grid gap-5 xl:grid-cols-2">
                <Section title="Pages per session"><Card><Bars data={d.data.pagesPerSession} color="var(--warn)" /></Card></Section>
                <Section title="Minutes per session"><Card><Bars data={d.data.minutesPerSession} color="var(--info)" /></Card></Section>
              </div>
            </Match>
            <Match when={d.area === 'meditation'}>
              <StatGrid cols="md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Days meditated" value={num(d.data.analytics.totalDays)} />
                <Stat label="Total time" value={d.data.totalTime} />
                <Stat label="Streak" value={`${d.data.analytics.currentStreak}d`} hint={`best ${d.data.analytics.bestStreak}d`} />
                <Stat label="Last 30 days" value={d.data.analytics.daysLast30} hint={`${Math.round(d.data.analytics.consistencyLast30 * 100)}% consistency`} />
                <Stat label="This week" value={`${d.data.analytics.daysThisWeek}/${d.data.targetDaysPerWeek}`} />
                <Stat label="Average" value={d.data.analytics.averageMinutes == null ? '—' : `${Math.round(d.data.analytics.averageMinutes)} min`} />
              </StatGrid>
              <Section title="Sessions · last year"><Card><Heatmap days={d.data.analytics.activity365} unit="minutes" thresholds={[1, 10, 20, 40]} color="var(--accent)" /></Card></Section>
              <div class="grid gap-5 xl:grid-cols-2">
                <Section title="Minutes"><Card><LineChart data={d.data.analytics.minutesTrend} color="var(--accent)" /></Card></Section>
                <Section title="Days per month"><Card><Bars data={d.data.analytics.monthlyDays} color="var(--good)" /></Card></Section>
              </div>
            </Match>
          </Switch>
        )}
      </Load>
    </Page>
  );
}
