import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { useApi } from '../lib/api';
import { num } from '../lib/format';
import { Badge, Card, Empty, Load, Page, Progress, Section, Stat, StatGrid } from '../components/ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function TodayCard() {
  const daily = useApi(() => '/daily');
  const remaining = () => (daily.data()?.queue ?? []).filter((q) => !q.complete).length + (daily.data()?.meditation?.complete ? 0 : 1);
  return (
    <A href="/daily" class="card group block overflow-hidden p-0 transition-colors hover:border-accent/50">
      <div class="flex items-center justify-between gap-3 border-b border-line bg-accent-soft/60 px-4 py-3">
        <div>
          <div class="text-[11px] font-semibold uppercase tracking-wider text-accent-text">Today’s plan</div>
          <div class="text-[15px] font-semibold">
            <Show when={daily.data()} fallback="Loading…">{remaining() ? `${remaining()} things left today` : 'All done for today ✓'}</Show>
          </div>
        </div>
        <span class="text-[13px] font-medium text-accent-text transition-transform group-hover:translate-x-0.5">Open Daily →</span>
      </div>
      <div class="divide-y divide-line">
        <Show when={daily.data()}>
          <Row done={daily.data().meditation.complete} title="Meditate" detail={`${daily.data().meditation.minutes} minutes`} />
          <For each={daily.data().queue}>{(q) => <Row done={q.complete} title={q.title} detail={q.detail} />}</For>
        </Show>
      </div>
    </A>
  );
}

function Row(props) {
  return (
    <div class="flex items-center gap-3 px-4 py-2.5 text-[13px]">
      <span class={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] ${props.done ? 'border-good bg-good text-white' : 'border-line-strong'}`}>{props.done ? '✓' : ''}</span>
      <span class={`whitespace-nowrap ${props.done ? 'text-muted line-through' : 'font-medium'}`}>{props.title}</span>
      <span class="ml-auto truncate text-[12px] text-faint">{props.detail}</span>
    </div>
  );
}

export default function Dashboard() {
  const q = useApi(() => '/dashboard');
  return (
    <Load q={q}>
      {(d) => (
        <Page title={`${greeting()}, ${d.greetingName}`} subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
          <StatGrid cols="md:grid-cols-5">
            <Stat label="Due reviews" value={num(d.stats.dueReviews)} hint={`${num(d.stats.ankiDue)} Anki · ${num(d.stats.inAppDue)} in-app`} href="/review" />
            <Stat label="Streak" value={`${d.stats.streak}d`} hint="days in a row" />
            <Stat label="Active goals" value={d.stats.activeGoals} href="/japanese" />
            <Stat label="Open mistakes" value={d.stats.openMistakes} href="/mistakes" />
            <Stat label="Reading" value={d.stats.reading} hint={`${d.stats.finished} finished`} href="/books" />
          </StatGrid>

          <div class="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div class="space-y-5">
              <TodayCard />
              <Section title="Active goals">
                <div class="grid gap-3 md:grid-cols-2">
                  <Show when={d.japaneseGoal}>
                    {(g) => (
                      <Card>
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-[13px] font-semibold">Prepare for JLPT {g().name}</span>
                          <Badge tone="accent">Japanese</Badge>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-4 text-[11px] text-muted">
                          <div><div class="mb-1 flex justify-between"><span>Words</span><span class="tnum">{Math.round(g().wordProgress)}%</span></div><Progress value={g().wordProgress} color="var(--info)" /></div>
                          <div><div class="mb-1 flex justify-between"><span>Grammar</span><span class="tnum">{Math.round(g().grammarProgress)}%</span></div><Progress value={g().grammarProgress} color="#f472b6" /></div>
                        </div>
                        <p class="tnum mt-2 text-[12px] text-muted">{num(g().wordsRemaining)} words · {num(g().grammarRemaining)} grammar points to go</p>
                      </Card>
                    )}
                  </Show>
                  <Show when={d.mathGoal}>
                    {(g) => (
                      <A href="/math" class="card block p-4 hover:border-line-strong">
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-[13px] font-semibold">Path to {g().title}</span>
                          <Badge tone="info">Math</Badge>
                        </div>
                        <Progress class="mt-3" value={g().pct} color="var(--accent)" />
                        <p class="tnum mt-2 text-[12px] text-muted">{g().done} of {g().total} courses complete · {g().pct}%</p>
                      </A>
                    )}
                  </Show>
                  <For each={d.goals}>
                    {(g) => (
                      <Card>
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-[13px] font-semibold">{g.title}</span>
                          <Badge tone="neutral">{g.course.name}</Badge>
                        </div>
                        <Show when={g.targetValue}>
                          <Progress class="mt-3" value={(g.currentValue / g.targetValue) * 100} color={g.course.color ?? undefined} />
                          <p class="tnum mt-2 text-[12px] text-muted">{num(g.currentValue)} / {num(g.targetValue)} {g.unit}</p>
                        </Show>
                        <Show when={g.description && !g.targetValue}><p class="mt-1.5 text-[12px] text-muted">{g.description}</p></Show>
                      </Card>
                    )}
                  </For>
                </div>
                <Show when={!d.japaneseGoal && !d.mathGoal && !d.goals.length}><Empty>No active goals yet.</Empty></Show>
              </Section>
            </div>
            <div class="space-y-5">
              <Section title="Areas">
                <div class="grid grid-cols-2 gap-3">
                  <For each={d.areas}>
                    {(a) => (
                      <A href={a.href} class="card block p-3.5 transition-colors hover:border-line-strong">
                        <div class="text-[13px] font-medium">{a.label}</div>
                        <div class="tnum mt-1 text-[20px] font-semibold">{num(a.value)}</div>
                        <div class="text-[11px] text-faint">{a.hint}</div>
                      </A>
                    )}
                  </For>
                </div>
              </Section>
              <Section title="Currently reading" actions={<A href="/books" class="text-[12px] text-accent-text hover:underline">All books →</A>}>
                <Show when={d.reading.length} fallback={<Empty>Nothing in progress. Pick a book to start.</Empty>}>
                  <div class="space-y-2">
                    <For each={d.reading}>
                      {(b) => (
                        <A href={`/books/${b.id}`} class="card flex items-center gap-3 p-3 hover:border-line-strong">
                          <span class="flex h-10 w-8 shrink-0 items-center justify-center rounded bg-surface-3 text-[14px]">❦</span>
                          <div class="min-w-0">
                            <div class="truncate text-[13px] font-medium">{b.title}</div>
                            <div class="truncate text-[12px] text-muted">{b.author ?? 'Unknown author'}</div>
                          </div>
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </Section>
            </div>
          </div>
        </Page>
      )}
    </Load>
  );
}
