import { A, useNavigate, useParams } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { ai } from '../lib/ai';
import { api, del, patch, post, useApi } from '../lib/api';
import { num, relative } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { AnkiSyncButton } from '../components/AnkiSync';
import { Coverage, LessonRow, LevelLadder } from '../components/tracks';
import { Badge, Card, Disclosure, Empty, Field, Load, Metric, MetricRow, Modal, Page, Pills, Progress, Section } from '../components/ui';

const reviewDeck = (deck) => attempt(() => post('/anki/open', { deck }));

function AddDeck(props) {
  const decks = useApi(() => '/anki/decks');
  const add = (deckName) => attempt(() => post(`/tracks/${props.slug}/decks`, { deckName }), 'Deck added. Sync to bring its cards in.');
  return (
    <Show when={decks.data()?.connected !== false} fallback={<p class="text-[13px] text-warn">Anki isn’t open, so your decks can’t be listed.</p>}>
      <div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        <For each={(decks.data()?.decks ?? []).filter((d) => !props.mapped.includes(d))} fallback={<span class="text-[12px] text-muted">{decks.data() ? 'Every deck is already on this track.' : 'Looking for your decks…'}</span>}>
          {(d) => <button class="pill" onClick={() => add(d)}>{d}</button>}
        </For>
      </div>
    </Show>
  );
}

function Decks(props) {
  const d = () => props.d;
  return (
    <Disclosure title={<>Decks <span class="text-muted">({d().decks.length})</span></>}>
      <div class="space-y-3">
        <For each={d().decks}>
          {(x) => <div class="flex items-center justify-between gap-2 text-[13px]"><span class="min-w-0 truncate">{x.name}</span><span class="shrink-0 text-[12px] text-muted">synced {relative(x.lastSyncedAt)}</span></div>}
        </For>
        <AddDeck slug={d().track.slug} mapped={d().decks.map((x) => x.name)} />
        <AnkiSyncButton small />
      </div>
    </Disclosure>
  );
}

function ReviewButton(props) {
  const d = () => props.d;
  return (
    <Show when={d().due > 0 && d().decks.length}>
      <Show when={d().decks.length === 1} fallback={<A href="/review" class="btn btn-primary">Review {num(d().due)} cards</A>}>
        <button class="btn btn-primary" onClick={() => reviewDeck(d().decks[0].name)}>Review {num(d().due)} cards</button>
      </Show>
    </Show>
  );
}

function Tool(props) {
  const t = () => props.tool;
  const body = () => (
    <>
      <span class="kz-glyph" lang={props.lang}>{t().glyph}</span>
      <div class="min-w-0 flex-1">
        <div class="text-[14px] font-semibold">{t().label}</div>
        <div class="truncate text-[12px] text-muted">{t().detail}</div>
      </div>
    </>
  );
  return (
    <Show when={t().href} fallback={
      <button class="card flex items-center gap-3 p-4 text-left transition-colors hover:border-line-strong"
        onClick={() => ai.ask({ kind: 'general', title: t().label, prompt: t().prompt })}>{body()}</button>
    }>
      <A href={t().href} class="card flex items-center gap-3 p-4 transition-colors hover:border-line-strong">{body()}</A>
    </Show>
  );
}

function LanguageTrack(props) {
  const d = () => props.d;
  const p = () => d().profile;
  const course = useApi(() => (d().track.builtIn ? `/courses/${d().track.slug}` : null));
  const exams = () => course.data()?.exams?.filter((e) => e.levels.some((l) => l.primary > 0)) ?? [];
  const goals = () => (d().track.slug === 'japanese' ? [] : course.data()?.goals?.filter((g) => g.status !== 'COMPLETED') ?? []);
  return (
    <div dir="ltr">
      <MetricRow>
        <For each={d().metrics}>{(m, i) => <Metric noun={m.noun} value={m.value} meaning={m.meaning} title={i() === 0 ? d().headlineTooltip : undefined} />}</For>
      </MetricRow>
      <Show when={d().tools.length}>
        <Section title="Tools">
          <div class="grid gap-3 sm:grid-cols-2"><For each={d().tools}>{(t) => <Tool tool={t} lang={p().lang} />}</For></div>
        </Section>
      </Show>
      <Show when={d().track.builtIn} fallback={<Section title={`${p().framework} levels`}><LevelLadder levels={d().ladder} /></Section>}>
        <For each={exams()}>{(exam) => <Section title={exam.name}><LevelLadder levels={exam.levels} /></Section>}</For>
      </Show>
      <Show when={goals().length}>
        <Section title="Goals">
          <div class="grid gap-3 md:grid-cols-2">
            <For each={goals()}>
              {(g) => (
                <Card>
                  <div class="text-[13px] font-semibold">{g.title}</div>
                  <Show when={g.targetValue}>
                    <Progress class="mt-2" value={(g.currentValue / g.targetValue) * 100} />
                    <div class="tnum mt-1.5 text-[12px] text-muted">{num(g.currentValue)} of {num(g.targetValue)} {g.unit}</div>
                  </Show>
                  <Show when={g.description}><p class="mt-1 text-[12px] text-muted">{g.description}</p></Show>
                  <Show when={g.status === 'ACTIVE' && !g.targetValue}><button class="btn btn-sm mt-2" onClick={() => attempt(() => post(`/goals/${g.id}/complete`), 'Goal completed')}>Mark complete</button></Show>
                </Card>
              )}
            </For>
          </div>
        </Section>
      </Show>
      <Show when={course.data()?.milestones?.length && d().track.slug !== 'japanese'}>
        <Section title="Lessons">
          <Card pad={false} class="overflow-hidden">
            <For each={course.data().milestones}>
              {(m) => <LessonRow number={m.order} title={m.title} done={!!m.completedAt} meta={m.targetValue != null ? `${num(m.targetValue)} ${m.metric}` : undefined} />}
            </For>
          </Card>
        </Section>
      </Show>
      <Section title="Known words">
        <Card class="flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <span>
            <Show when={d().knownWords.fromCards} fallback={<>You know about <b class="tnum">{num(d().knownWords.lower)}</b> words in {p().name}.</>}>
              <b class="tnum">{num(d().knownWords.lower)}</b> mature cards stand in for known words until {p().name} has its own word counter.
            </Show>
          </span>
          <Show when={!d().knownWords.fromCards}><A href={`/insights/words?lang=${p().code}`} class="btn btn-sm">See words</A></Show>
        </Card>
      </Section>
      <Decks d={d()} />
    </div>
  );
}

function Unsuspend(props) {
  const [query, setQuery] = createSignal('');
  const [matches, setMatches] = createSignal(null);
  const find = async (e) => {
    e.preventDefault();
    const r = await attempt(() => api(`/tracks/${props.slug}/tags?q=${encodeURIComponent(query())}`));
    if (r) setMatches(r.matches);
  };
  return (
    <>
      <form onSubmit={find} class="flex flex-wrap gap-2">
        <input class="input min-w-[220px] flex-1" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="What did you just study? e.g. glomerulonephritis" />
        <button class="btn" disabled={!query().trim()}>Find cards</button>
      </form>
      <Show when={matches()}><div class="mt-3"><TagMatches slug={props.slug} matches={matches()} onDone={() => setMatches(null)} /></div></Show>
    </>
  );
}

function TagMatches(props) {
  const wake = async (m) => {
    const r = await attempt(() => post('/anki/unsuspend', { tag: m.tag, slug: props.slug }));
    if (r) { toast(`Unsuspended ${num(r.unsuspended)} cards for ${m.label}`, 'good'); props.onDone?.(); }
  };
  return (
    <Show when={props.matches.length} fallback={<p class="text-[13px] text-muted">No tags in this deck match that.</p>}>
      <div class="divide-y divide-line">
        <For each={props.matches}>
          {(m) => (
            <div class="flex items-center gap-3 py-2 text-[13px]">
              <span class="min-w-0 flex-1 truncate" title={m.tag}>{m.label}</span>
              <Show when={m.waiting} fallback={<span class="text-[12px] text-muted">✓ all {num(m.total)} unlocked</span>}>
                <button class="btn btn-sm shrink-0" onClick={() => wake(m)}>Unsuspend {num(m.waiting)} cards</button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function LogMiss(props) {
  const [topic, setTopic] = createSignal('');
  const [matches, setMatches] = createSignal(null);
  const log = async (e) => {
    e.preventDefault();
    const r = await attempt(() => post(`/tracks/${props.slug}/misses`, { topic: topic() }));
    if (r) setMatches(r.matches);
  };
  return (
    <Modal title="Log a QBank miss" onClose={props.onClose}>
      <form onSubmit={log} class="flex flex-wrap gap-2">
        <input class="input min-w-[220px] flex-1" value={topic()} onInput={(e) => setTopic(e.currentTarget.value)} placeholder="The topic you missed, e.g. nephritic syndrome" />
        <button class="btn btn-primary" disabled={!topic().trim()}>Log and find cards</button>
      </form>
      <Show when={matches()}><div class="mt-3"><TagMatches slug={props.slug} matches={matches()} /></div></Show>
    </Modal>
  );
}

function EditExam(props) {
  const t = () => props.track;
  const [name, setName] = createSignal(t().name);
  const [examDate, setExamDate] = createSignal(t().examDate ?? '');
  const navigate = useNavigate();
  const save = async (e) => {
    e.preventDefault();
    if (await attempt(() => patch(`/tracks/${t().slug}`, { name: name(), examDate: examDate() }), 'Saved')) props.onClose();
  };
  const remove = async () => {
    if (!confirm(`Remove “${t().name}”? Your Anki decks and cards are not touched.`)) return;
    if (await attempt(() => del(`/tracks/${t().slug}`))) navigate('/tracks');
  };
  return (
    <Modal title="Edit this track" onClose={props.onClose}>
      <form onSubmit={save} class="space-y-3">
        <Field label="Name"><input class="input" value={name()} onInput={(e) => setName(e.currentTarget.value)} /></Field>
        <Field label="Exam date"><input class="input" type="date" value={examDate()} onInput={(e) => setExamDate(e.currentTarget.value)} /></Field>
        <div class="flex justify-between gap-2"><button class="btn btn-primary">Save</button><button type="button" class="btn btn-danger" onClick={remove}>Remove track</button></div>
      </form>
    </Modal>
  );
}

function ExamTrack(props) {
  const d = () => props.d;
  const slug = () => d().track.slug;
  const setRoot = (tagRoot) => attempt(() => patch(`/tracks/${slug()}`, { tagRoot }));
  const linked = () => d().track.playlistIds ?? [];
  const toggleCourse = (id) => attempt(() => patch(`/tracks/${slug()}`, { playlistIds: linked().includes(id) ? linked().filter((x) => x !== id) : [...linked(), id] }));
  return (
    <>
      <MetricRow><For each={d().metrics}>{(m) => <Metric noun={m.noun} value={m.value} meaning={m.meaning} />}</For></MetricRow>
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title="Coverage">
          <Card>
            <Show when={d().coverage.length} fallback={
              <p class="text-[13px] text-muted">{d().cards ? 'These cards have no tags to group by. ' : 'Add a deck and sync to see coverage. '}Coverage comes from your deck’s tag tree.</p>
            }>
              <Coverage rows={d().coverage} />
              <Show when={d().tagRoots.length > 1}>
                <div class="mt-3 border-t border-line pt-3">
                  <div class="mb-1.5 text-[12px] text-muted">Group by</div>
                  <Pills value={d().tagRoot} onChange={setRoot} options={d().tagRoots} />
                </div>
              </Show>
            </Show>
          </Card>
        </Section>
        <Section title="Unsuspend what you studied">
          <Card>
            <Unsuspend slug={slug()} />
            <p class="mt-2 text-[12px] text-muted">{d().waiting ? `${num(d().waiting)} cards are still suspended. ` : ''}Kaizen finds the matching tags; Anki keeps the cards.</p>
          </Card>
        </Section>
      </div>
      <Section title="Weak tags this week">
        <Show when={d().weak.length} fallback={<Empty>Nothing stands out as weak this week.</Empty>}>
          <Card pad={false}>
            <For each={d().weak}>
              {(w) => (
                <div class="kz-task">
                  <Badge tone="warn">{w.rememberingPct}%</Badge>
                  <span class="kz-task__title min-w-0 truncate" title={w.tag}>{w.label}</span>
                  <span class="kz-task__detail"><button class="btn btn-sm" onClick={() => attempt(() => post('/anki/open', { tag: w.tag }))}>Open {num(w.cards)} in Anki</button></span>
                </div>
              )}
            </For>
          </Card>
        </Show>
      </Section>
      <Show when={d().misses.length}>
        <Section title="QBank misses">
          <Card pad={false}>
            <For each={d().misses}>
              {(m) => <div class="kz-task"><span class="kz-task__title min-w-0 truncate">{m.description}</span><Show when={m.count > 1}><span class="kz-task__detail">missed {m.count} times</span></Show></div>}
            </For>
          </Card>
        </Section>
      </Show>
      <Show when={d().lessons.linked.length}>
        <For each={d().lessons.linked}>
          {(course) => (
            <Section title={course.title} actions={<A href={`/library/courses/${course.id}`} class="text-[12px] text-accent-text hover:underline">Open course →</A>}>
              <Card pad={false} class="overflow-hidden">
                <For each={course.items}>
                  {(i) => <LessonRow number={i.position + 1} title={i.title} done={i.completed} current={i.position === course.position}
                    meta={i.seconds ? `${Math.round(i.seconds / 60)} min${i.position === course.position ? ' · up next' : ''}` : undefined} />}
                </For>
              </Card>
            </Section>
          )}
        </For>
      </Show>
      <div class="grid gap-3 md:grid-cols-2">
        <Decks d={d()} />
        <Disclosure title="Courses on this track">
          <Show when={d().lessons.available.length} fallback={<p class="text-[13px] text-muted">Add a lecture series in the <A class="text-accent-text underline" href="/library">Library</A>, then connect it here.</p>}>
            <div class="flex flex-wrap gap-1.5">
              <For each={d().lessons.available}>{(c) => <button class="pill" aria-pressed={linked().includes(c.id)} onClick={() => toggleCourse(c.id)}>{c.title}</button>}</For>
            </div>
          </Show>
        </Disclosure>
      </div>
    </>
  );
}

export default function Track() {
  const params = useParams();
  const q = useApi(() => `/tracks/${params.slug}`);
  const [editing, setEditing] = createSignal(false);
  const [logging, setLogging] = createSignal(false);
  return (
    <Load q={q}>
      {(d) => (
        <Page title={d.track.name} glyph={d.profile?.glyph ?? d.track.glyph ?? '◆'} back={{ href: '/tracks', label: 'Tracks' }}
          subtitle={[d.goalLine, d.decks.map((x) => x.name).join(', ')].filter(Boolean).join(' · ')}
          actions={<>
            <Show when={d.track.kind === 'exam'}>
              <button class="btn" onClick={() => setLogging(true)}>Log QBank miss</button>
              <button class="btn" onClick={() => setEditing(true)}>Edit</button>
            </Show>
            <ReviewButton d={d} />
          </>}>
          <Show when={d.track.kind === 'exam'} fallback={<LanguageTrack d={d} />}><ExamTrack d={d} /></Show>
          <Show when={editing()}><EditExam track={d.track} onClose={() => setEditing(false)} /></Show>
          <Show when={logging()}><LogMiss slug={d.track.slug} onClose={() => setLogging(false)} /></Show>
        </Page>
      )}
    </Load>
  );
}
