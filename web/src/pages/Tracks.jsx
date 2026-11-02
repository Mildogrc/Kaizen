import { A, useNavigate } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { attempt } from '../lib/store';
import { TrackCard } from '../components/tracks';
import { Card, Empty, Field, Load, Modal, Page, Pills, Section, focusOnMount } from '../components/ui';

function DeckPicker(props) {
  const decks = useApi(() => '/anki/decks');
  return (
    <Field label="Anki deck (you can add more later)">
      <Show when={decks.data()?.connected !== false} fallback={<p class="text-[12px] text-warn">Anki isn’t open, so you can add the deck later from the track page.</p>}>
        <div class="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          <For each={decks.data()?.decks ?? []} fallback={<span class="text-[12px] text-muted">Looking for your decks…</span>}>
            {(d) => <button type="button" class="pill" aria-pressed={props.value === d} onClick={() => props.onChange(props.value === d ? '' : d)}>{d}</button>}
          </For>
        </div>
      </Show>
    </Field>
  );
}

function NewTrack(props) {
  const navigate = useNavigate();
  const [kind, setKind] = createSignal('language');
  const [language, setLanguage] = createSignal('');
  const [name, setName] = createSignal('');
  const [goal, setGoal] = createSignal('');
  const [examDate, setExamDate] = createSignal('');
  const [deck, setDeck] = createSignal('');
  const open = () => props.languages.filter((l) => !props.taken.includes(l.code));
  const ready = () => (kind() === 'language' ? !!language() : !!name().trim());
  const create = async (e) => {
    e.preventDefault();
    const r = await attempt(() => post('/tracks', { kind: kind(), language: language() || null, name: name() || null, goal: goal() || null, examDate: examDate() || null, deck: deck() || null }));
    if (r?.slug) navigate(`/tracks/${r.slug}`);
  };
  return (
    <Modal title="Add a track" onClose={props.onClose}>
      <form onSubmit={create} class="space-y-4">
        <Field label="What are you working toward?">
          <Pills value={kind()} onChange={setKind} options={[{ value: 'language', label: 'A language' }, { value: 'exam', label: 'An exam' }]} />
        </Field>
        <Show when={kind() === 'language'} fallback={
          <>
            <Field label="Exam"><input ref={focusOnMount} class="input" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="USMLE Step 1" /></Field>
            <Field label="Exam date"><input class="input" type="date" value={examDate()} onInput={(e) => setExamDate(e.currentTarget.value)} /></Field>
          </>
        }>
          <Field label="Language">
            <Show when={open().length} fallback={<p class="text-[13px] text-muted">You already have a track for every language Kaizen knows.</p>}>
              <Pills value={language()} onChange={setLanguage} options={open().map((l) => ({ value: l.code, label: `${l.glyph} ${l.name}` }))} />
            </Show>
          </Field>
          <Show when={language()}>
            <Field label="Goal (optional)">
              <Pills value={goal()} onChange={setGoal} options={props.languages.find((l) => l.code === language()).levels.map(([level]) => ({ value: level, label: level }))} />
            </Field>
          </Show>
        </Show>
        <DeckPicker value={deck()} onChange={setDeck} />
        <button class="btn btn-primary" disabled={!ready()}>Add track</button>
      </form>
    </Modal>
  );
}

const GROUPS = [
  { kind: 'exam', title: 'Exams' },
  { kind: 'language', title: 'Languages' },
  { kind: 'course', title: 'Courses' },
  { kind: 'reading', title: 'Reading' },
  { kind: 'practice', title: 'Practice' },
];

export default function Tracks() {
  const q = useApi(() => '/tracks');
  const [adding, setAdding] = createSignal(false);
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Tracks" subtitle="Everything you’re working toward. Each one opens its own page."
          actions={<>
            <A href="/concepts" class="btn">Concept maps</A>
            <button class="btn btn-primary" onClick={() => setAdding(true)}>Add a track</button>
          </>}>
          <Show when={d.tracks.length} fallback={<Empty>You have no tracks yet. Add a language or an exam to begin.</Empty>}>
            <For each={GROUPS}>
              {(g) => (
                <Show when={d.tracks.some((t) => t.kind === g.kind)}>
                  <Section title={g.title}>
                    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <For each={d.tracks.filter((t) => t.kind === g.kind)}>{(t) => <TrackCard track={t} />}</For>
                    </div>
                  </Section>
                </Show>
              )}
            </For>
          </Show>
          <Section title="Practised elsewhere">
            <Card pad={false}>
              <For each={d.external}>
                {(x) => <a href={x.href} target="_blank" rel="noreferrer" class="kz-task"><span class="kz-task__title">{x.label}</span><span class="kz-task__detail">{x.detail} →</span></a>}
              </For>
            </Card>
          </Section>
          <Show when={adding()}><NewTrack languages={d.languages} taken={d.taken} onClose={() => setAdding(false)} /></Show>
        </Page>
      )}
    </Load>
  );
}
