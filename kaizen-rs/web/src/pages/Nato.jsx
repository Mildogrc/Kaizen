import { A } from '@solidjs/router';
import { For, Match, Show, Switch, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { date, pct } from '../lib/format';
import { Card, Empty, Load, Page, Section, Stat, StatGrid } from '../components/ui';

function Trainer(props) {
  const [phase, setPhase] = createSignal('ready'); // ready | typing | saving | done | error
  const [index, setIndex] = createSignal(0);
  const [answer, setAnswer] = createSignal('');
  const [missed, setMissed] = createSignal(null);
  const [attempts, setAttempts] = createSignal([]);
  const [result, setResult] = createSignal(null);
  const [error, setError] = createSignal(null);
  let startedAt = 0;
  let input;
  const word = () => props.word;
  const letter = () => word()[index()];

  const begin = () => { setPhase('typing'); startedAt = performance.now(); setTimeout(() => input?.focus()); };
  const save = async (list) => {
    setPhase('saving');
    try {
      const r = await post('/nato/sessions', { word: word(), attempts: list.map((a) => ({ typed: a.typed, timeMs: a.timeMs })) });
      setResult(r.stats);
      setPhase('done');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  };
  const advance = (list) => {
    if (index() === word().length - 1) return save(list);
    setIndex(index() + 1);
    setAnswer('');
    setMissed(null);
    startedAt = performance.now();
    setTimeout(() => input?.focus());
  };
  const submit = (e) => {
    e.preventDefault();
    if (!answer().trim() || missed()) return;
    const expected = props.codeWords[letter()];
    const attempt = { letter: letter(), expected, typed: answer().trim(), timeMs: Math.max(50, Math.round(performance.now() - startedAt)) };
    attempt.correct = attempt.typed.toLowerCase() === expected.toLowerCase();
    const list = [...attempts(), attempt];
    setAttempts(list);
    if (attempt.correct) advance(list);
    else setMissed(attempt);
  };

  return (
    <Card class="py-8">
      <Switch>
        <Match when={phase() === 'ready'}>
          <div class="text-center">
            <p class="mb-3 text-[13px] text-muted">Recall the code word for each letter. Timing starts when you begin.</p>
            <button class="btn btn-primary" onClick={begin}>Start timed word</button>
          </div>
        </Match>
        <Match when={phase() === 'typing'}>
          <div class="mb-5 flex justify-center gap-1.5 font-mono text-[34px] font-semibold tracking-widest">
            <For each={word().split('')}>
              {(ch, i) => <span class={`rounded-lg px-2 py-0.5 ${i() === index() ? 'bg-accent-soft text-accent-text' : i() < index() ? 'text-good' : 'text-faint'}`}>{ch}</span>}
            </For>
          </div>
          <p class="mb-3 text-center text-[12.5px] text-muted">Letter {index() + 1} of {word().length} — the code word for <b class="text-text">{letter()}</b></p>
          <form onSubmit={submit} class="mx-auto flex max-w-md gap-2">
            <input ref={input} class="input h-10 text-[15px]" value={answer()} onInput={(e) => setAnswer(e.currentTarget.value)} disabled={!!missed()} placeholder={`${letter()} is…`} autocomplete="off" autocapitalize="off" spellcheck={false} />
            <Show when={!missed()}><button class="btn btn-primary h-10">Enter</button></Show>
          </form>
          <Show when={missed()}>
            <div class="mx-auto mt-3 flex max-w-md items-center justify-between rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
              <span>It’s <b>{missed().expected}</b></span>
              <button class="btn btn-sm" onClick={() => advance(attempts())} autofocus>Next →</button>
            </div>
          </Show>
        </Match>
        <Match when={phase() === 'saving'}><p class="text-center text-[13px] text-muted">Saving your times…</p></Match>
        <Match when={phase() === 'error'}>
          <div class="text-center"><p class="text-[13px] text-bad">{error()}</p><button class="btn mt-3" onClick={() => save(attempts())}>Retry save</button></div>
        </Match>
        <Match when={phase() === 'done' && result()}>
          <div class="text-center">
            <div class="text-[18px] font-semibold">{Math.round(result().accuracy * 100)}% · {(result().averageRecallMs / 1000).toFixed(1)}s average</div>
            <p class="mt-1 text-[12.5px] text-muted">Next review in {result().nextIntervalDays} days. Your next word emphasizes slow or missed letters.</p>
            <div class="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-1.5">
              <For each={result().attempts}>
                {(a) => <span class={`rounded-md border px-2 py-1 text-[12px] ${a.correct ? 'border-good/40 text-good' : 'border-bad/40 text-bad'}`}>{a.letter} · {a.expected} · {(a.timeMs / 1000).toFixed(1)}s</span>}
              </For>
            </div>
          </div>
        </Match>
      </Switch>
    </Card>
  );
}

export default function Nato() {
  const q = useApi(() => '/nato');
  return (
    <Load q={q}>
      {(d) => (
        <Page title="NATO alphabet" glyph="Ⓝ" back={{ href: '/skills', label: 'Skills' }} subtitle="Timed code-word recall weighted toward slow and missed letters"
          actions={<A href="/analytics?area=nato" class="btn">Analytics</A>}>
          <StatGrid>
            <Stat label="Sessions" value={d.analytics.sessions} />
            <Stat label="Accuracy" value={pct(d.analytics.accuracy)} />
            <Stat label="Avg recall" value={d.analytics.averageRecallMs == null ? '—' : `${(d.analytics.averageRecallMs / 1000).toFixed(1)}s`} />
            <Stat label="Next due" value={d.analytics.nextDueAt ? date(d.analytics.nextDueAt) : 'Now'} hint="7–28 day adaptive interval" />
          </StatGrid>
          <Section title={`Timed word · ${d.word.length} letters`}><Trainer word={d.word} codeWords={d.codeWords} /></Section>
          <Section title="Letter recall">
            <Show when={d.letters.length} fallback={<Empty>Finish a word to start letter analytics.</Empty>}>
              <Card pad={false}>
                <div class="divide-y divide-line">
                  <For each={d.letters}>
                    {(m) => (
                      <div class="grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-3 px-4 py-2 text-[12.5px]">
                        <span class="text-[16px] font-semibold">{m.letter}</span>
                        <div class="h-1.5 overflow-hidden rounded-full bg-surface-3"><div class="h-full rounded-full bg-info" style={{ width: `${Math.min(100, (m.averageMs / 5000) * 100)}%` }} /></div>
                        <span class="tnum">{(m.averageMs / 1000).toFixed(1)}s</span>
                        <span class="tnum w-20 text-right text-muted">{Math.round(m.accuracy * 100)}% · {m.attempts}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Card>
            </Show>
          </Section>
        </Page>
      )}
    </Load>
  );
}
