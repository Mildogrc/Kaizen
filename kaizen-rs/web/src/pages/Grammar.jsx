import { A } from '@solidjs/router';
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ai } from '../lib/ai';
import { post, put, useApi } from '../lib/api';
import { date, num, pct } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { Bars } from '../components/charts';
import { Icon } from '../components/icons';
import { Badge, Card, CopyButton, Disclosure, Empty, Field, Load, Page, Progress, Section, Stat, StatGrid } from '../components/ui';

const LEVEL_COLORS = { N5: '#4ade80', N4: '#38bdf8', N3: '#818cf8', N2: '#c084fc', N1: '#fb7185' };
const RATINGS = [
  { value: 'AGAIN', label: 'Again', tone: 'var(--bad)' },
  { value: 'GOOD', label: 'Good', tone: 'var(--info)' },
  { value: 'PERFECT', label: 'Perfect', tone: 'var(--good)' },
];

// Ratings in progress are kept per lesson, so closing the panel, leaving the
// page, or reloading never loses them (cleared once saved to the SRS).
const ratingsKey = (lessonId) => `kaizen.grammar-ratings.${lessonId}`;
const readSaved = (lessonId) => { try { return JSON.parse(localStorage.getItem(ratingsKey(lessonId)) ?? 'null'); } catch { return null; } };

function RatingForm(props) {
  const [saving, setSaving] = createSignal(false);
  onMount(() => {
    const saved = readSaved(props.lesson.id);
    if (saved) Object.entries(saved).forEach(([id, rating]) => props.setRating(id, rating));
  });
  createEffect(on(() => props.lesson.items.map((i) => props.ratings[i.learningItemId]), (values) => {
    const picked = Object.fromEntries(props.lesson.items.map((i, n) => [i.learningItemId, values[n]]).filter(([, v]) => v));
    try {
      if (Object.keys(picked).length) localStorage.setItem(ratingsKey(props.lesson.id), JSON.stringify(picked));
    } catch { /* storage unavailable */ }
  }));
  const complete = () => props.lesson.items.every((item) => props.ratings[item.learningItemId]);
  const save = async () => {
    setSaving(true);
    const body = { lessonId: props.lesson.id, ratings: props.lesson.items.map((i) => ({ learningItemId: i.learningItemId, rating: props.ratings[i.learningItemId] })) };
    const r = await attempt(() => post('/japanese/grammar/ratings', body));
    setSaving(false);
    if (r) {
      try { localStorage.removeItem(ratingsKey(props.lesson.id)); } catch { /* storage unavailable */ }
      toast(r.message, 'good');
    }
  };
  return (
    <div>
      <div class="divide-y divide-line">
        <For each={props.lesson.items}>
          {(item, i) => (
            <div class="flex flex-wrap items-center gap-3 py-2.5">
              <span class="tnum w-5 text-[12px] text-faint">{i() + 1}.</span>
              <div class="min-w-[180px] flex-1">
                <div class="text-[14px] font-medium">{item.pattern}</div>
                <div class="text-[12px] text-muted">{item.meaning}</div>
              </div>
              <Badge tone={item.kind === 'new' ? 'good' : item.isLeech ? 'bad' : 'info'}>{item.kind}</Badge>
              <div class="flex gap-1.5">
                <For each={RATINGS}>
                  {(r) => (
                    <button class="pill" aria-pressed={props.ratings[item.learningItemId] === r.value}
                      style={props.ratings[item.learningItemId] === r.value ? { 'border-color': r.tone, color: r.tone, background: `color-mix(in srgb, ${r.tone} 12%, transparent)` } : undefined}
                      onClick={() => props.setRating(item.learningItemId, r.value)}>{r.label}</button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button class="btn btn-primary" disabled={!complete() || saving()} onClick={save}>{saving() ? 'Saving…' : 'Save ratings to SRS'}</button>
        <span class="text-[12px] text-muted">Perfect on a new point marks it mastered on placement.</span>
      </div>
    </div>
  );
}

function TutorSettings(props) {
  const [planSize, setPlanSize] = createSignal(props.tutor.config.planSize);
  const [items, setItems] = createStore(props.tutor.configurable.map((i) => ({
    learningItemId: i.learningItemId, missRatePercent: i.override?.missRatePercent ?? '', excluded: i.override?.excluded === true,
  })));
  const save = () => attempt(() => put('/japanese/grammar/tutor', { planSize: Number(planSize()), items: items.map((i) => ({ ...i, missRatePercent: i.missRatePercent === '' ? null : Number(i.missRatePercent) })) }), 'Tutor-plan settings saved');
  return (
    <div class="space-y-3">
      <p class="text-[12px] text-muted">Override a point’s miss rate for tutor plans (blank = recorded history) or remove it. This never changes SRS scheduling.</p>
      <Field label="Points per tutor plan" class="max-w-[200px]">
        <input class="input" type="number" min="1" max="10" value={planSize()} onInput={(e) => setPlanSize(e.currentTarget.value)} />
      </Field>
      <Show when={props.tutor.configurable.length} fallback={<p class="text-[12.5px] text-muted">No attempted grammar points yet.</p>}>
        <div class="divide-y divide-line rounded-lg border border-line">
          <For each={props.tutor.configurable}>
            {(item, i) => (
              <div class="grid items-center gap-3 p-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
                <div>
                  <div class="text-[13px] font-medium">{item.pattern}</div>
                  <div class="tnum text-[11.5px] text-muted">Recorded: {item.recordedMissRate}% missed · {item.misses}/{item.totalQuestions}</div>
                </div>
                <input class="input" type="number" min="0" max="100" placeholder={String(item.recordedMissRate)} value={items[i()].missRatePercent}
                  onInput={(e) => setItems(i(), 'missRatePercent', e.currentTarget.value)} aria-label="Tutor miss rate %" />
                <label class="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={items[i()].excluded} onChange={(e) => setItems(i(), 'excluded', e.currentTarget.checked)} /> Remove</label>
              </div>
            )}
          </For>
        </div>
      </Show>
      <button class="btn btn-primary" onClick={save}>Save tutor settings</button>
    </div>
  );
}

/** The "run it with your AI" card: start, continue, or restart the lesson chat. */
function LessonAi(props) {
  const conv = useApi(() => `/ai/conversation?contextKind=grammar-lesson&contextRef=${props.lesson.id}`);
  const live = () => ai.state.context.kind === 'grammar-lesson' && ai.state.context.ref === props.lesson.id;
  const answering = () => (live() ? !!ai.state.pending : !!conv.data()?.conversation?.running);
  const messages = () => (live() ? ai.state.messages.length : conv.data()?.conversation?.messages.length ?? 0);
  // Not watching it here (panel on another chat): check back until it's done.
  createEffect(() => {
    if (!answering() || live()) return;
    const timer = setInterval(() => conv.refetch(), 3000);
    onCleanup(() => clearInterval(timer));
  });
  // Ratings the AI produced while this page was closed.
  createEffect(on(() => conv.data()?.conversation?.extras?.ratings, (list) => {
    if (list && !props.lesson.items.some((i) => props.ratings[i.learningItemId])) props.applyRatings(list, false);
  }));
  return (
    <Card class="flex flex-col gap-3 bg-accent-soft/40">
      <div class="flex items-center gap-2 text-[13px] font-semibold"><Icon name="sparkle" /> Run it with your AI</div>
      <Show when={messages()} fallback={
        <p class="text-[12.5px] text-muted">Opens an interactive lesson in the AI panel using your subscription. It ends with a numbered Again/Good/Perfect list that fills the form automatically.</p>
      }>
        <p class="flex items-center gap-2 text-[12.5px] text-muted">
          <Show when={answering()} fallback={<>Lesson in progress · {messages()} messages saved. Close the panel any time — it picks up where you left off.</>}>
            <span class="ai-orb !h-3.5 !w-3.5" /> The AI is still answering — it keeps going even if you close the panel.
          </Show>
        </p>
      </Show>
      <button class="btn btn-primary" onClick={() => props.start(false)}><Icon name="play" size={14} /> {messages() ? 'Continue lesson' : 'Start lesson with AI'}</button>
      <Show when={messages() && !answering()}>
        <button class="btn btn-sm self-start" onClick={() => confirm('Start a new conversation for this lesson? The current one stays in AI history.') && props.start(true)}>Start over</button>
      </Show>
      <CopyButton text={() => props.lesson.prompt} label="Copy prompt instead" />
      <Disclosure title="Preview prompt"><pre class="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-muted">{props.lesson.prompt}</pre></Disclosure>
    </Card>
  );
}

export default function Grammar() {
  const q = useApi(() => '/japanese/grammar');
  const [ratings, setRatings] = createStore({});
  const [generating, setGenerating] = createSignal(false);

  const generate = async () => {
    setGenerating(true);
    const r = await attempt(() => post('/japanese/grammar/lesson'));
    setGenerating(false);
    if (r && !r.lessonId) toast('Nothing is due today.', 'info');
  };

  const applyRatings = (lesson, list, announce = true) => {
    lesson.items.forEach((item, i) => list[i] && setRatings(item.learningItemId, list[i]));
    if (announce) toast('The AI’s ratings are filled in below — review and save.', 'good');
  };
  const startLesson = (lesson, fresh = false) => {
    ai.ask({
      kind: 'grammar-lesson',
      ref: lesson.id,
      title: `Grammar lesson · ${date(lesson.scheduledFor)}`,
      prompt: lesson.prompt,
      resume: !fresh,
      extras: (extras) => extras.ratings && applyRatings(lesson, extras.ratings),
      actions: (extras) => (extras.ratings ? [{ label: 'Ratings applied to the lesson form ✓', run: () => ai.close() }] : []),
    });
  };

  return (
    <Load q={q}>
      {(d) => (
        <Page title="Grammar coach" glyph="文" back={{ href: '/japanese', label: 'Japanese' }}
          subtitle={`${d.config.newPointsPerBatch} new points every ${d.config.newBatchIntervalDays} day${d.config.newBatchIntervalDays === 1 ? '' : 's'}, SRS reviews, and an interactive AI lesson`}
          actions={<A href="/configurations?section=japanese" class="btn">Schedule settings</A>}>
          <StatGrid cols="md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Unseen" value={num(d.counts.NEW)} />
            <Stat label="Learning" value={num(d.counts.LEARNING)} />
            <Stat label="Review" value={num(d.counts.REVIEW)} />
            <Stat label="Mastered" value={num(d.counts.MASTERED)} color="var(--good)" />
            <Stat label="Due now" value={num(d.analytics.due)} href="/review?type=grammar" />
            <Stat label="Accuracy" value={pct(d.analytics.accuracy)} hint={`${d.analytics.totalCorrect}/${d.analytics.totalQuestions} answers`} />
          </StatGrid>

          <Section title="Today’s lesson">
            <Show when={d.lessonState === 'ready' && d.lesson} fallback={
              <Show when={d.lessonState !== 'empty'} fallback={<Empty>Nothing is due today. The next batch and future reviews appear automatically.</Empty>}>
                <Card class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-[13px] text-muted">
                    {d.lessonState === 'upgrade' ? 'Update the saved lesson to the current Again / Good / Perfect format.'
                      : d.lessonState === 'refresh' ? 'The saved lesson is from an older queue. Refresh it to include everything due today.'
                      : `Build a lesson from ${d.scheduledWork} due review${d.scheduledWork === 1 ? '' : 's'} and new points.`}
                  </p>
                  <button class="btn btn-primary" disabled={generating()} onClick={generate}>{generating() ? 'Building…' : d.lessonState === 'generate' ? 'Generate today’s lesson' : 'Refresh today’s lesson'}</button>
                </Card>
              </Show>
            }>
                  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <Card>
                      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div class="text-[14px] font-semibold">{d.lesson.items.length} grammar points · {date(d.lesson.scheduledFor)}</div>
                          <div class="text-[12px] text-muted">Rate each point after the lesson — or let the AI tutor rate them for you.</div>
                        </div>
                      </div>
                      <RatingForm lesson={d.lesson} ratings={ratings} setRating={(id, v) => setRatings(id, v)} />
                    </Card>
                    <LessonAi lesson={d.lesson} ratings={ratings} start={(fresh) => startLesson(d.lesson, fresh)} applyRatings={(list, announce) => applyRatings(d.lesson, list, announce)} />
                  </div>
            </Show>
          </Section>

          <Section title="Tutor plan">
            <Card>
              <Show when={d.tutor.plan} fallback={<Empty class="mb-3">No grammar points currently need extra tutor practice.</Empty>}>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="text-[13px] font-semibold">Weakest recurring points</div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <For each={d.tutor.weakest}>{(w) => <Badge tone={w.isLeech ? 'bad' : 'warn'}>{w.pattern} · {w.missRate}% missed</Badge>}</For>
                    </div>
                  </div>
                  <div class="flex gap-2">
                    <button class="btn btn-primary" onClick={() => ai.ask({ kind: 'grammar-tutor', ref: null, title: 'Grammar tutor session', prompt: d.tutor.plan })}><Icon name="sparkle" size={14} /> Practice with AI</button>
                    <CopyButton text={() => d.tutor.plan} label="Copy plan" />
                  </div>
                </div>
              </Show>
              <div class="mt-4"><Disclosure title="Customize tutor plans"><TutorSettings tutor={d.tutor} /></Disclosure></div>
            </Card>
          </Section>

          <div class="grid gap-5 lg:grid-cols-2">
            <Section title="Lesson analytics">
              <StatGrid cols="grid-cols-2" class="!mb-3">
                <Stat label="Lessons" value={d.analytics.completedLessons} hint={`${d.analytics.lessonsToday} today`} />
                <Stat label="Lesson streak" value={`${d.analytics.currentStreak}d`} />
              </StatGrid>
              <Card class="mb-3"><div class="mb-1 text-[12px] font-medium text-muted">Ratings</div><Bars data={d.analytics.ratingDistribution} color="var(--info)" height={110} /></Card>
              <Card><div class="mb-1 text-[12px] font-medium text-muted">Results by week</div><Bars data={d.analytics.weeklyProgress} color="var(--good)" height={110} /></Card>
            </Section>
            <Section title="Curriculum">
              <Card>
                <p class="mb-3 text-[12.5px] text-muted">Level estimate: <b class="text-text">{d.levelLabel}</b> from {num(d.knownWords)} known words.</p>
                <div class="space-y-3">
                  <For each={d.levels}>
                    {(l) => (
                      <div>
                        <div class="mb-1 flex justify-between text-[12px]">
                          <span class="font-semibold">{l.level}</span>
                          <span class="tnum text-muted">{l.total ? Math.round((l.studied / l.total) * 100) : 0}% · {l.studied}/{l.total} introduced · {l.mastered} mastered</span>
                        </div>
                        <Progress value={l.total ? (l.studied / l.total) * 100 : 0} color={LEVEL_COLORS[l.level]} />
                      </div>
                    )}
                  </For>
                </div>
              </Card>
              <Show when={d.recent.length}>
                <Card pad={false} class="mt-3">
                  <div class="border-b border-line px-4 py-2 text-[12px] font-medium text-muted">Recently studied</div>
                  <div class="divide-y divide-line">
                    <For each={d.recent}>
                      {(r) => (
                        <div class="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                          <span class="min-w-28 font-medium">{r.pattern}</span>
                          <span class="min-w-0 flex-1 truncate text-muted">{r.meaning}</span>
                          <Badge tone={r.isLeech ? 'bad' : r.status === 'MASTERED' ? 'good' : 'info'}>{r.status.toLowerCase()}</Badge>
                          <span class="tnum w-10 text-right text-faint">{r.intervalDays}d</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Card>
              </Show>
            </Section>
          </div>
        </Page>
      )}
    </Load>
  );
}
