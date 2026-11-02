import { A, useNavigate } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { post, useApi } from '../lib/api';
import { date, num } from '../lib/format';
import { attempt } from '../lib/store';
import { TrackCard } from '../components/tracks';
import { Empty, Load, Metric, Page, Section } from '../components/ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

function Task(props) {
  const t = () => props.task;
  const meditate = () => attempt(() => post('/daily/meditation', { complete: !t().complete }));
  const body = () => (
    <>
      <Show when={t().key === 'meditate'} fallback={<span class="kz-tick">{t().complete ? '✓' : ''}</span>}>
        <button class="kz-tick" onClick={meditate} aria-label={t().complete ? 'Mark meditation not done' : 'Mark meditation done'}>{t().complete ? '✓' : ''}</button>
      </Show>
      <span class="kz-task__title">{t().title}</span>
      <Show when={t().track}><span class="kz-task__track">{t().track}</span></Show>
      <Show when={t().detail}><span class="kz-task__detail">{t().detail}</span></Show>
    </>
  );
  return (
    <Show when={t().href} fallback={<div class="kz-task" data-done={t().complete || undefined}>{body()}</div>}>
      <A href={t().href} class="kz-task" data-done={t().complete || undefined}>{body()}</A>
    </Show>
  );
}

const planTitle = (plan) => {
  if (!plan.remaining) return 'All done for today ✓';
  const things = plan.remaining === 1 ? '1 thing left' : `${plan.remaining} things left`;
  return plan.time ? `${things} · about ${plan.time}` : things;
};

export default function Today() {
  const navigate = useNavigate();
  const q = useApi(() => '/today');
  return (
    <Load q={q}>
      {(d) => (
        <Page title={`${greeting()}, ${d.greetingName}`}
          subtitle={[date(d.date, { weekday: 'long', day: 'numeric', month: 'long' }), d.streak ? `${d.streak}-day streak` : null].filter(Boolean).join(' · ')}>
          <div class="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div>
              <div class="card mb-3 overflow-hidden">
                <div class="kz-today__head">
                  <div>
                    <div class="kz-today__eyebrow">Today’s plan</div>
                    <div class="kz-today__title">{planTitle(d.plan)}</div>
                  </div>
                  <Show when={d.plan.start}><button class="btn btn-primary btn-sm" onClick={() => navigate(d.plan.start)}>Start</button></Show>
                </div>
                <For each={d.plan.tasks}>{(t) => <Task task={t} />}</For>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <Metric noun="Cards due" href="/review" value={d.cardsDue ? num(d.cardsDue) : 'None'} meaning={d.cardsTime ? `about ${d.cardsTime}` : 'Nothing due right now'} />
                <Metric noun="Remembering" href="/insights" value={d.remembering != null ? `${d.remembering}%` : '—'} meaning={d.remembering != null ? 'of older cards' : 'Review older cards to see this'} />
                <Metric noun="This week" href="/insights" value={d.week.minutes ? d.week.label : 'Nothing yet'}
                  meaning={d.week.minutes ? (d.week.delta === 0 ? 'same as last week' : `studied, ${d.week.delta > 0 ? 'up' : 'down'} ${d.week.deltaLabel}`) : 'Your first session starts the count'} />
              </div>
            </div>
            <Section title="Your tracks" actions={<A href="/tracks" class="text-[12px] text-accent-text hover:underline">All tracks →</A>}>
              <Show when={d.tracks.length} fallback={<Empty>You have no tracks yet. <A class="text-accent-text underline" href="/tracks">Add your first one</A>.</Empty>}>
                <div class="space-y-3"><For each={d.tracks.filter((t) => t.kind !== 'practice').slice(0, 5)}>{(t) => <TrackCard track={t} />}</For></div>
              </Show>
            </Section>
          </div>
        </Page>
      )}
    </Load>
  );
}
