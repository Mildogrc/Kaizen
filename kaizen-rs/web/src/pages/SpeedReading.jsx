import { A } from '@solidjs/router';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ai } from '../lib/ai';
import { api, post, useApi } from '../lib/api';
import { pct } from '../lib/format';
import { attempt, toast } from '../lib/store';
import { Icon } from '../components/icons';
import { Badge, Card, Disclosure, Empty, Field, Load, Page, Pills, Section, Stat, StatGrid } from '../components/ui';

// Same rule as the server: word-like segments, punctuation attached to the
// previous token.
function tokenize(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const tokens = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (/^\s+$/u.test(segment)) continue;
    if (isWordLike || !tokens.length) tokens.push(segment);
    else tokens[tokens.length - 1] += segment;
  }
  return tokens;
}

const MODES = [
  { value: 'RSVP', label: 'RSVP', title: 'One word at a time in place' },
  { value: 'CHUNKING', label: 'Chunking', title: 'Groups of words' },
  { value: 'PACED', label: 'Paced', title: 'Highlight moves through the text' },
  { value: 'BENCHMARK', label: 'Benchmark', title: 'Read at your own pace; measures WPM' },
];

function Trainer(props) {
  const [passageId, setPassageId] = createSignal(props.passages[0]?.id);
  const [mode, setMode] = createSignal(props.settings.mode);
  const [wpm, setWpm] = createSignal(props.recommendedWpm);
  const [chunk, setChunk] = createSignal(props.settings.chunkSize);
  const [phase, setPhase] = createSignal('setup');
  const [index, setIndex] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [answers, setAnswers] = createStore({});
  const [result, setResult] = createSignal(null);
  let startedAt = null;
  let finishedAt = null;
  let questionsAt = null;

  const passage = createMemo(() => props.passages.find((p) => p.id === passageId()) ?? props.passages[0]);
  const tokens = createMemo(() => tokenize(passage()?.text ?? ''));
  const step = () => (mode() === 'CHUNKING' ? Math.max(2, chunk()) : mode() === 'RSVP' ? chunk() : chunk());
  const visible = () => tokens().slice(index(), index() + step()).join(' ');

  const finishReading = () => { finishedAt = Date.now(); questionsAt = Date.now(); setPaused(false); setPhase('questions'); };
  createEffect(() => {
    if (phase() !== 'reading' || paused() || mode() === 'BENCHMARK') return;
    const words = tokens().slice(index(), index() + step());
    const pause = props.settings.punctuationPause && /[.!?;:。！？；：]$/u.test(words.at(-1) ?? '') ? 260 : 0;
    const delay = Math.max(40, (60000 / wpm()) * Math.max(1, words.length) + pause);
    const timer = setTimeout(() => {
      const next = index() + step();
      if (next >= tokens().length) finishReading();
      else setIndex(next);
    }, delay);
    onCleanup(() => clearTimeout(timer));
  });

  const start = () => { setIndex(0); setAnswers({}); setResult(null); startedAt = new Date(); finishedAt = null; setPaused(false); setPhase('reading'); };
  const measuredWpm = () => {
    if (mode() !== 'BENCHMARK' || !finishedAt) return wpm();
    const minutes = Math.max(1 / 60, (finishedAt - startedAt.getTime()) / 60000);
    return Math.max(50, Math.min(2000, Math.round(tokens().length / minutes)));
  };
  const submit = async () => {
    const body = {
      passageId: passage().id, mode: mode(), wpm: measuredWpm(), chunkSize: step(), fontSize: props.settings.fontSize,
      punctuationPause: props.settings.punctuationPause, comprehensionThreshold: props.settings.comprehensionThreshold / 100,
      startedAt: startedAt.toISOString(), durationSec: Math.max(1, Math.round(((finishedAt ?? Date.now()) - startedAt.getTime()) / 1000)),
      responseTimeMs: Date.now() - questionsAt, answers: { ...answers },
    };
    const r = await attempt(() => post('/speed-reading/sessions', body));
    if (r) { setResult(r); setWpm(r.recommendedNextWpm); setPhase('result'); }
  };

  return (
    <Switch>
      <Match when={phase() === 'setup'}>
        <Card>
          <div class="grid gap-4 lg:grid-cols-2">
            <Field label="Passage">
              <div class="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
                <For each={props.passages}>
                  {(p) => (
                    <button class={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${p.id === passage()?.id ? 'bg-accent-soft text-accent-text' : 'hover:bg-surface-2'}`} onClick={() => setPassageId(p.id)}>
                      <span class="truncate">{p.title}</span>
                      <span class="shrink-0 text-[11px] text-faint">{p.wordCount} words · {p.difficulty}</span>
                    </button>
                  )}
                </For>
              </div>
            </Field>
            <div class="space-y-3">
              <Field label="Mode"><Pills options={MODES} value={mode()} onChange={setMode} /></Field>
              <Show when={mode() !== 'BENCHMARK'}>
                <Field label={`Speed · ${wpm()} WPM`}><input type="range" min="100" max="1000" step="10" value={wpm()} onInput={(e) => setWpm(Number(e.currentTarget.value))} class="w-full accent-[var(--accent)]" /></Field>
                <Field label="Words at once"><Pills options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} value={chunk()} onChange={setChunk} /></Field>
              </Show>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button class="btn btn-primary" onClick={start} disabled={!passage()}><Icon name="play" size={14} /> {mode() === 'BENCHMARK' ? 'Start benchmark' : `Start at ${wpm()} WPM`}</button>
            <span class="text-[12px] text-muted">{passage()?.topic} · {passage()?.questions.length} questions · {props.settings.sessionMinutes} min target</span>
          </div>
        </Card>
      </Match>
      <Match when={phase() === 'reading'}>
        <Card class="min-h-[420px]">
          <div class="mb-4 flex items-center justify-between text-[11.5px] text-muted">
            <span>{passage().title} · {mode().toLowerCase()}</span>
            <span class="tnum">{Math.min(tokens().length, index() + step())} / {tokens().length}</span>
          </div>
          <Switch>
            <Match when={mode() === 'PACED'}>
              <div class="mx-auto max-w-3xl leading-[2.1]" style={{ 'font-size': `${Math.min(props.settings.fontSize, 26)}px` }}>
                <For each={tokens()}>{(t, i) => <span class={i() >= index() && i() < index() + step() ? 'rounded bg-accent-soft text-accent-text' : i() < index() ? 'text-faint' : ''}>{t} </span>}</For>
              </div>
            </Match>
            <Match when={mode() === 'BENCHMARK'}>
              <div class="mx-auto max-w-3xl whitespace-pre-line leading-[1.8]" style={{ 'font-size': `${Math.min(props.settings.fontSize, 22)}px` }}>{passage().text}</div>
            </Match>
            <Match when={true}>
              <div class="flex min-h-72 items-center justify-center text-center font-medium" style={{ 'font-size': `${props.settings.fontSize}px` }}>{visible()}</div>
            </Match>
          </Switch>
          <div class="mt-6 flex justify-center gap-2">
            <Show when={mode() !== 'BENCHMARK'} fallback={<button class="btn btn-primary" onClick={finishReading}>I’ve finished reading</button>}>
              <button class="btn" onClick={() => setPaused(!paused())}>{paused() ? '▶ Resume' : 'Ⅱ Pause'}</button>
              <button class="btn btn-ghost" onClick={finishReading}>Skip to questions</button>
            </Show>
          </div>
        </Card>
      </Match>
      <Match when={phase() === 'questions'}>
        <Card>
          <div class="text-[15px] font-semibold">Comprehension check</div>
          <p class="mb-4 text-[12px] text-muted">Answer from memory — the passage stays hidden.</p>
          <div class="space-y-5">
            <For each={passage().questions}>
              {(question, qi) => (
                <fieldset>
                  <legend class="mb-2 text-[13.5px] font-medium">{qi() + 1}. {question.prompt}</legend>
                  <div class="grid gap-1.5 sm:grid-cols-2">
                    <For each={question.choices}>
                      {(choice, ci) => (
                        <button class={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors ${answers[question.id] === ci() ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}
                          onClick={() => setAnswers(question.id, ci())}>{choice}</button>
                      )}
                    </For>
                  </div>
                </fieldset>
              )}
            </For>
          </div>
          <button class="btn btn-primary mt-5" disabled={Object.keys(answers).length !== passage().questions.length} onClick={submit}>Submit answers</button>
        </Card>
      </Match>
      <Match when={phase() === 'result' && result()}>
        <Card>
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div class="text-[20px] font-semibold text-good">{result().correct}/{result().total} correct · {Math.round(result().accuracy * 100)}%</div>
              <div class="mt-0.5 text-[12.5px] text-muted">Next recommended speed: <b class="text-text">{result().recommendedNextWpm} WPM</b> · retention check tomorrow</div>
            </div>
            <button class="btn btn-primary" onClick={() => {
              const i = props.passages.findIndex((p) => p.id === passage().id);
              setPassageId(props.passages[(i + 1) % props.passages.length]?.id);
              setPhase('setup');
            }}>Next passage</button>
          </div>
          <div class="mt-4 divide-y divide-line">
            <For each={result().explanations}>
              {(x, i) => <div class="py-2.5 text-[12.5px]"><span class={x.isCorrect ? 'text-good' : 'text-bad'}>{x.isCorrect ? '✓' : '✗'} Question {i() + 1}</span><p class="mt-0.5 text-muted">{x.explanation}</p></div>}
            </For>
          </div>
        </Card>
      </Match>
    </Switch>
  );
}

function Retention(props) {
  const [answers, setAnswers] = createStore({});
  return (
    <Card>
      <div class="mb-1 text-[14px] font-semibold">{props.check.title}</div>
      <p class="mb-3 text-[12px] text-muted">How much stuck from yesterday’s read?</p>
      <div class="space-y-4">
        <For each={props.check.questions}>
          {(question, qi) => (
            <fieldset>
              <legend class="mb-1.5 text-[13px] font-medium">{qi() + 1}. {question.prompt}</legend>
              <div class="grid gap-1.5 sm:grid-cols-2">
                <For each={question.choices}>{(choice, ci) => <button class={`rounded-lg border px-3 py-1.5 text-left text-[12.5px] ${answers[question.id] === ci() ? 'border-accent bg-accent-soft' : 'border-line'}`} onClick={() => setAnswers(question.id, ci())}>{choice}</button>}</For>
              </div>
            </fieldset>
          )}
        </For>
      </div>
      <button class="btn btn-primary mt-4" disabled={Object.keys(answers).length !== props.check.questions.length}
        onClick={() => attempt(() => post(`/speed-reading/retention/${props.check.sessionId}`, { answers: { ...answers } }), (r) => `Retention ${Math.round(r.accuracy * 100)}% (${r.correct}/${r.total})`)}>Submit retention check</button>
    </Card>
  );
}

function PassageImport(props) {
  const [category, setCategory] = createSignal(props.settings.category === 'all' ? 'science and history' : props.settings.category);
  const [difficulty, setDifficulty] = createSignal(props.settings.difficulty === 'all' ? 'intermediate' : props.settings.difficulty);
  const [words, setWords] = createSignal(450);
  const [text, setText] = createSignal('');
  const importJson = async (value) => {
    const r = await attempt(() => post('/speed-reading/passages', typeof value === 'string' ? { text: value } : { json: value }));
    if (r) { toast(`Imported “${r.title}”`, 'good'); setText(''); }
    return r;
  };
  const generate = async () => {
    const { prompt } = await api(`/speed-reading/prompt?${new URLSearchParams({ category: category(), difficulty: difficulty(), targetWords: String(words()) })}`);
    ai.ask({
      kind: 'reading-passage', title: 'New reading passage', prompt,
      actions: (extras) => (extras.json ? [{ label: 'Import this passage', primary: true, run: async () => { if (await importJson(extras.json)) ai.close(); } }] : []),
    });
  };
  return (
    <div class="grid gap-5 lg:grid-cols-2">
      <div class="space-y-3">
        <Field label="Topic category"><input class="input" value={category()} onInput={(e) => setCategory(e.currentTarget.value)} /></Field>
        <Field label="Difficulty"><Pills options={['beginner', 'intermediate', 'advanced']} value={difficulty()} onChange={setDifficulty} /></Field>
        <Field label={`Length · about ${words()} words`}><input type="range" min="150" max="1500" step="50" value={words()} onInput={(e) => setWords(Number(e.currentTarget.value))} class="w-full accent-[var(--accent)]" /></Field>
        <button class="btn btn-primary" onClick={generate}><Icon name="sparkle" size={14} /> Generate with AI</button>
      </div>
      <div>
        <Field label="…or paste passage JSON from any LLM">
          <textarea class="input min-h-44 font-mono text-[11.5px]" value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder='{"title":"…","text":"…","questions":[…],"answerKey":[…]}' />
        </Field>
        <button class="btn mt-2" disabled={!text().trim()} onClick={() => importJson(text())}>Validate & import</button>
      </div>
    </div>
  );
}

export default function SpeedReading() {
  const q = useApi(() => '/speed-reading');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Speed reading" glyph="»" back={{ href: '/skills', label: 'Skills' }} subtitle="Focused reading sessions with comprehension and next-day retention checks"
          actions={<><A href="/configurations?section=skills" class="btn">Configure</A><A href="/analytics?area=reading" class="btn">Analytics</A></>}>
          <StatGrid>
            <Stat label="Next speed" value={`${d.recommendedWpm} WPM`} />
            <Stat label="Comprehension" value={pct(d.accuracy)} />
            <Stat label="Streak" value={`${d.streak}d`} />
            <Stat label="Retention due" value={d.retentionDue.length} />
          </StatGrid>
          <Show when={d.retentionDue.length}>
            <Section title="Retention checks"><div class="space-y-3"><For each={d.retentionDue}>{(c) => <Retention check={c} />}</For></div></Section>
          </Show>
          <Section title="Read">
            <Show when={d.passages.length} fallback={<Empty>Add a passage below to start.</Empty>}>
              <Trainer passages={d.passages} settings={d.settings} recommendedWpm={d.recommendedWpm} />
            </Show>
          </Section>
          <Disclosure title={<><Badge tone="accent">+</Badge> Add or generate a passage</>}><PassageImport settings={d.settings} /></Disclosure>
        </Page>
      )}
    </Load>
  );
}
