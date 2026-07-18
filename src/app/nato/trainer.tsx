'use client';

import { FormEvent, useRef, useState, useTransition } from 'react';
import { Card, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { NATO_CODE_WORDS, type NatoAttempt } from '@/lib/nato';
import { saveNatoSessionAction } from './actions';

export function NatoTrainer({ word }: { word: string }) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [attempts, setAttempts] = useState<NatoAttempt[]>([]);
  const [missed, setMissed] = useState<NatoAttempt | null>(null);
  const [complete, setComplete] = useState(false);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef(0);
  const letter = word[index];

  const begin = () => {
    setStarted(true);
    startedAt.current = performance.now();
  };

  const finishOrAdvance = (nextAttempts: NatoAttempt[]) => {
    if (index === word.length - 1) {
      setComplete(true);
      startTransition(async () => {
        await saveNatoSessionAction(JSON.stringify({ word, attempts: nextAttempts }));
      });
      return;
    }
    setIndex((value) => value + 1);
    setAnswer('');
    setMissed(null);
    startedAt.current = performance.now();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!answer.trim() || missed) return;
    const expected = NATO_CODE_WORDS[letter];
    const attempt = {
      letter,
      expected,
      typed: answer.trim(),
      correct: answer.trim().toLowerCase() === expected.toLowerCase(),
      timeMs: Math.max(50, Math.round(performance.now() - startedAt.current)),
    };
    const nextAttempts = [...attempts, attempt];
    setAttempts(nextAttempts);
    if (attempt.correct) finishOrAdvance(nextAttempts);
    else setMissed(attempt);
  };

  if (!started) return <Card className="text-center"><div className="mb-2 text-[13px] text-muted">You will recall one NATO code word at a time. Timing begins when you start.</div><button onClick={begin} className={btnPrimaryCls}>Start timed word</button></Card>;
  if (complete) return <Card className="text-center"><div className="text-lg font-semibold">Session complete</div><p className="mt-1 text-[12px] text-muted">{pending ? 'Saving recall times…' : 'Saved. Your next word will emphasize slower or missed letters.'}</p></Card>;

  return <Card>
    <div className="mb-5 flex justify-center gap-1 font-mono text-3xl font-semibold tracking-widest">
      {word.split('').map((character, position) => <span key={`${character}-${position}`} className={`rounded px-1.5 py-1 ${position === index ? 'bg-accent/20 text-accent' : position < index ? 'text-green-300' : 'text-muted'}`}>{character}</span>)}
    </div>
    <div className="mb-2 text-center text-[12px] text-muted">Letter {index + 1} of {word.length} · type the NATO code word for <strong className="text-foreground">{letter}</strong></div>
    <form onSubmit={submit} className="mx-auto flex max-w-lg gap-2">
      <input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={Boolean(missed)} className={inputCls} placeholder={`${letter} is…`} autoComplete="off" />
      {!missed && <button className={btnPrimaryCls}>Submit</button>}
    </form>
    {missed && <div className="mx-auto mt-3 flex max-w-lg items-center justify-between rounded-md border border-amber-900 bg-amber-950/30 px-3 py-2 text-[12px]"><span><span className="text-muted">Correct answer:</span> <strong>{missed.expected}</strong></span><button onClick={() => finishOrAdvance(attempts)} className={btnCls}>Next</button></div>}
  </Card>;
}
