import { useSearchParams } from '@solidjs/router';
import { For, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { post, put, useApi } from '../lib/api';
import { attempt } from '../lib/store';
import { Badge, Card, Field, Load, Page, Pills, Section, Toggle } from '../components/ui';

const SECTIONS = [
  { value: 'japanese', label: '日 Japanese' },
  { value: 'chinese', label: '中 Chinese' },
  { value: 'math', label: '∑ Math' },
  { value: 'skills', label: '⌨ Practice' },
  { value: 'meditation', label: '☀ Meditation' },
];

const numberInput = (store, set, key, attrs = {}) => (
  <input class="input" type="number" value={store[key]} onInput={(e) => set(key, e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))} {...attrs} />
);

function SaveBar(props) {
  return <div class="mt-4 flex items-center gap-2"><button class="btn btn-primary" onClick={props.onSave}>Save</button>{props.children}</div>;
}

function Japanese(props) {
  const [grammar, setGrammar] = createStore({ ...props.d.japaneseGrammar });
  const [kanji, setKanji] = createStore({ ...props.d.kanjiRepair });
  const [adaptive, setAdaptive] = createStore({ ...props.d.adaptive.settings, adaptiveMappingIds: props.d.adaptive.mappings.filter((m) => m.checked).map((m) => m.id) });
  const toggleDeck = (id) => setAdaptive('adaptiveMappingIds', (ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <>
      <Section title="Grammar coach schedule">
        <Card>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="New points per batch"><Pills value={grammar.newPointsPerBatch} onChange={(v) => setGrammar('newPointsPerBatch', v)} options={[1, 2, 3, 5, 8, 10].map((n) => ({ value: n, label: String(n) }))} /></Field>
            <Field label="Days between batches"><Pills value={grammar.newBatchIntervalDays} onChange={(v) => setGrammar('newBatchIntervalDays', v)} options={[1, 2, 3, 5, 7, 14].map((n) => ({ value: n, label: `${n}d` }))} /></Field>
          </div>
          <SaveBar onSave={() => attempt(() => put('/settings/japanese-grammar', { ...grammar }), 'Grammar schedule saved')} />
        </Card>
      </Section>
      <Section title="Character repair">
        <Card>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="Cooldown after a repair"><Pills value={kanji.cooldownDays} onChange={(v) => setKanji('cooldownDays', v)} options={[7, 14, 21, 30, 60].map((n) => ({ value: n, label: `${n} days` }))} /></Field>
            <Field label="Evidence"><Toggle checked={kanji.useVocabularyPerformance} onChange={(v) => setKanji('useVocabularyPerformance', v)} label="Also use vocabulary-card performance" /></Field>
          </div>
          <SaveBar onSave={() => attempt(() => put('/settings/kanji-repair', { ...kanji }), 'Character repair saved')} />
        </Card>
      </Section>
      <Section title="New cards a day">
        <Card>
          <p class="mb-3 text-[13px] text-muted">Each Anki day, Kaizen sets the new-card limit on the chosen vocabulary decks from your retention, review time, lapses, and backlog. Your other deck options are untouched.</p>
          <Toggle checked={adaptive.enabled} onChange={(v) => setAdaptive('enabled', v)} label="Manage new cards per day" />
          <Show when={adaptive.enabled}>
            <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Starting budget">{numberInput(adaptive, setAdaptive, 'startingBudget', { min: 0, max: 100 })}</Field>
              <Field label="Maximum budget">{numberInput(adaptive, setAdaptive, 'maximumBudget', { min: 1, max: 200 })}</Field>
              <Field label="Target review minutes / day">{numberInput(adaptive, setAdaptive, 'targetReviewMinutes', { min: 5, max: 300 })}</Field>
              <Field label="Anki day starts at (hour)">{numberInput(adaptive, setAdaptive, 'ankiDayStartHour', { min: 0, max: 23 })}</Field>
            </div>
            <div class="mt-3"><Toggle checked={adaptive.coldStartProtection} onChange={(v) => setAdaptive('coldStartProtection', v)} label="Cold-start protection (hold the budget until data is reliable)" /></div>
            <Field label="Decks that receive the budget" class="mt-4">
              <div class="flex flex-wrap gap-1.5">
                <For each={props.d.adaptive.mappings}>{(m) => <button class="pill" aria-pressed={adaptive.adaptiveMappingIds.includes(m.id)} onClick={() => toggleDeck(m.id)}>{m.deckName}{m.kanjiDeck ? ' (kanji)' : ''}</button>}</For>
              </div>
            </Field>
            <div class="mt-3 text-[12px] text-muted">Current budget <b class="text-text">{props.d.adaptive.currentBudget ?? '—'}</b> · {props.d.adaptive.reliableDays} reliable days</div>
          </Show>
          <SaveBar onSave={() => attempt(() => put('/settings/adaptive-anki', { ...adaptive, adaptiveMappingIds: [...adaptive.adaptiveMappingIds] }), 'Adaptive settings saved')}>
            <Show when={props.d.adaptive.settings.enabled}>
              <button class="btn" onClick={() => confirm('Restart adaptive learning from the starting budget?') && attempt(() => post('/settings/adaptive-anki/reset'), 'Adaptive state reset')}>Reset learning</button>
            </Show>
          </SaveBar>
        </Card>
      </Section>
    </>
  );
}

function Chinese(props) {
  const [m, setM] = createStore({ ...props.d.mandarin.settings });
  const deckField = (key, label) => (
    <Field label={label}>
      <input class="input mb-2" value={m[key]} onInput={(e) => setM(key, e.currentTarget.value)} />
      <div class="flex flex-wrap gap-1"><For each={props.d.mandarin.deckOptions}>{(deck) => <button class="pill !h-6 !text-[11px]" aria-pressed={m[key] === deck} onClick={() => setM(key, deck)}>{deck}</button>}</For></div>
    </Field>
  );
  return (
    <Section title="Mandarin Blueprint decks">
      <Card class="space-y-4">
        <p class="text-[13px] text-muted">Completed levels push notes into these Anki decks (created if missing).</p>
        {deckField('characterDeckName', 'Characters')}
        {deckField('reversedCharacterDeckName', 'Characters (reversed)')}
        {deckField('wordDeckName', 'Words')}
        <SaveBar onSave={() => attempt(() => put('/settings/mandarin-blueprint', { ...m }), 'Deck names saved')} />
      </Card>
    </Section>
  );
}

function MathGoals(props) {
  const math = () => props.d.math;
  return (
    <Show when={math()} fallback={<Card>The math course isn’t set up.</Card>}>
      <Section title="Long-term goals">
        <Card>
          <p class="mb-3 text-[13px] text-muted">Long-term goals become target views on the roadmap. Pick one as the current goal.</p>
          <div class="space-y-2">
            <For each={math().longTerm}>
              {(t) => (
                <div class="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span class="flex-1 text-[13px] font-medium">{t.title}</span>
                  <Show when={math().current === t.slug} fallback={<button class="btn btn-sm" onClick={() => attempt(() => put('/math/goal', { targetSlug: t.slug }), 'Current goal updated')}>Make current</button>}>
                    <Badge tone="accent">current</Badge>
                  </Show>
                  <button class="btn btn-ghost btn-sm text-muted" disabled={math().longTerm.length <= 1} onClick={() => attempt(() => post('/math/long-term-goals', { targetSlug: t.slug, intent: 'remove' }))}>Remove</button>
                </div>
              )}
            </For>
          </div>
          <Field label="Add a long-term goal" class="mt-4">
            <div class="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              <For each={math().available}>{(t) => <button class="pill" onClick={() => attempt(() => post('/math/long-term-goals', { targetSlug: t.slug, intent: 'add' }), `${t.title} added`)}>+ {t.title}</button>}</For>
            </div>
          </Field>
        </Card>
      </Section>
    </Show>
  );
}

function Skills(props) {
  const [r, setR] = createStore({ ...props.d.reading });
  return (
    <Section title="Speed reading">
      <Card class="space-y-4">
        <Field label="Default mode"><Pills value={r.mode} onChange={(v) => setR('mode', v)} options={['RSVP', 'CHUNKING', 'PACED', 'BENCHMARK'].map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))} /></Field>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Starting WPM">{numberInput(r, setR, 'wpm', { min: 50, max: 2000, step: 10 })}</Field>
          <Field label="Font size (px)">{numberInput(r, setR, 'fontSize', { min: 16, max: 96 })}</Field>
          <Field label="Session minutes">{numberInput(r, setR, 'sessionMinutes', { min: 1, max: 120 })}</Field>
          <Field label="Comprehension target (%)">{numberInput(r, setR, 'comprehensionThreshold', { min: 50, max: 100 })}</Field>
        </div>
        <Field label="Words at once"><Pills value={r.chunkSize} onChange={(v) => setR('chunkSize', v)} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} /></Field>
        <Toggle checked={r.punctuationPause} onChange={(v) => setR('punctuationPause', v)} label="Pause briefly at sentence punctuation" />
        <div class="grid gap-3 sm:grid-cols-2">
          <Field label="Generation category"><input class="input" value={r.category} onInput={(e) => setR('category', e.currentTarget.value)} /></Field>
          <Field label="Generation difficulty"><Pills value={r.difficulty} onChange={(v) => setR('difficulty', v)} options={['all', 'beginner', 'intermediate', 'advanced']} /></Field>
        </div>
        <SaveBar onSave={() => attempt(() => put('/settings/speed-reading', { ...r }), 'Speed-reading settings saved')} />
      </Card>
    </Section>
  );
}

function Meditation(props) {
  const [m, setM] = createStore({ ...props.d.meditation });
  return (
    <Section title="Meditation">
      <Card class="space-y-4">
        <Field label="Session length"><Pills value={m.sessionMinutes} onChange={(v) => setM('sessionMinutes', v)} options={[5, 10, 15, 20, 30, 45, 60].map((n) => ({ value: n, label: `${n} min` }))} /></Field>
        <Field label="Target days per week"><Pills value={m.targetDaysPerWeek} onChange={(v) => setM('targetDaysPerWeek', v)} options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))} /></Field>
        <SaveBar onSave={() => attempt(() => put('/settings/meditation', { ...m }), 'Meditation settings saved')} />
      </Card>
    </Section>
  );
}

export default function Configurations() {
  const [params, setParams] = useSearchParams();
  const section = () => (SECTIONS.some((s) => s.value === params.section) ? params.section : 'japanese');
  const q = useApi(() => '/configurations');
  return (
    <Page title="Study settings" back={{ href: '/settings/data', label: 'Settings' }} subtitle="Defaults and connections for each area">
      <Pills class="mb-6" value={section()} onChange={(s) => setParams({ section: s })} options={SECTIONS} />
      <Load q={q}>
        {(d) => (
          <Switch>
            <Match when={section() === 'japanese'}><Japanese d={d} /></Match>
            <Match when={section() === 'chinese'}><Chinese d={d} /></Match>
            <Match when={section() === 'math'}><MathGoals d={d} /></Match>
            <Match when={section() === 'skills'}><Skills d={d} /></Match>
            <Match when={section() === 'meditation'}><Meditation d={d} /></Match>
          </Switch>
        )}
      </Load>
    </Page>
  );
}
