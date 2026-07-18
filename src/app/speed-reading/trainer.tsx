'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import type { SpeedReadingConfiguration } from '@/lib/app-settings';
import { tokenizePassage } from '@/lib/speed-reading';
import { completeSpeedReadingSessionAction } from './actions';

export interface TrainerQuestion {
  id: string;
  prompt: string;
  choices: string[];
}

export interface TrainerPassage {
  id: string;
  title: string;
  topic: string;
  category: string;
  difficulty: string;
  sourceUrl: string | null;
  text: string;
  wordCount: number;
  questions: TrainerQuestion[];
}

type Phase = 'setup' | 'reading' | 'questions' | 'result';

export function SpeedReadingTrainer({ passages, recommendedWpm, settings }: { passages: TrainerPassage[]; recommendedWpm: number; settings: SpeedReadingConfiguration }) {
  const router = useRouter();
  const configuredPassages = useMemo(() => passages.filter((passage) =>
    (settings.category === 'all' || passage.category === settings.category)
    && (settings.difficulty === 'all' || passage.difficulty === settings.difficulty)), [passages, settings.category, settings.difficulty]);
  const availablePassages = configuredPassages.length ? configuredPassages : passages;
  const [passageId, setPassageId] = useState(availablePassages[0]?.id ?? '');
  const mode = settings.mode;
  const [wpm, setWpm] = useState(recommendedWpm);
  const chunkSize = settings.chunkSize;
  const fontSize = settings.fontSize;
  const sessionMinutes = settings.sessionMinutes;
  const threshold = settings.comprehensionThreshold;
  const punctuationPause = settings.punctuationPause;
  const [phase, setPhase] = useState<Phase>('setup');
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof completeSpeedReadingSessionAction>> | null>(null);
  const [remainingTargetSec, setRemainingTargetSec] = useState(0);
  const [pending, startTransition] = useTransition();
  const startedAt = useRef<Date | null>(null);
  const readingFinishedAt = useRef<number | null>(null);
  const questionsStartedAt = useRef<number | null>(null);
  const trainingBlockStartedAt = useRef<number | null>(null);

  const selected = availablePassages.find((passage) => passage.id === passageId) ?? availablePassages[0] ?? passages[0];
  const tokens = useMemo(() => tokenizePassage(selected?.text ?? ''), [selected]);
  const effectiveChunk = mode === 'CHUNKING' ? Math.max(2, chunkSize) : chunkSize;
  const visible = tokens.slice(index, index + effectiveChunk);

  const finishReading = () => {
    readingFinishedAt.current = Date.now();
    questionsStartedAt.current = Date.now();
    setPaused(false);
    setPhase('questions');
  };

  useEffect(() => {
    if (phase !== 'reading' || paused || mode === 'BENCHMARK' || !selected) return;
    const chunk = tokens.slice(index, index + effectiveChunk);
    const punctuationDelay = punctuationPause && /[.!?;:。！？；：]$/u.test(chunk.at(-1) ?? '') ? 260 : 0;
    const delay = Math.max(40, (60_000 / wpm) * Math.max(1, chunk.length) + punctuationDelay);
    const timer = window.setTimeout(() => {
      const next = index + effectiveChunk;
      if (next >= tokens.length) finishReading();
      else setIndex(next);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [phase, paused, mode, selected, tokens, index, effectiveChunk, punctuationPause, wpm]);

  if (!selected) return <div className="text-[12px] text-muted">Import a passage to start training.</div>;

  const start = () => {
    setPassageId(selected.id);
    setIndex(0);
    setAnswers({});
    setMessage(null);
    setResult(null);
    startedAt.current = new Date();
    readingFinishedAt.current = null;
    questionsStartedAt.current = null;
    if (trainingBlockStartedAt.current == null) {
      trainingBlockStartedAt.current = Date.now();
      setRemainingTargetSec(sessionMinutes * 60);
    }
    setPaused(false);
    setPhase('reading');
  };

  const measuredWpm = () => {
    if (mode !== 'BENCHMARK' || !startedAt.current || !readingFinishedAt.current) return wpm;
    const minutes = Math.max(1 / 60, (readingFinishedAt.current - startedAt.current.getTime()) / 60_000);
    return Math.max(50, Math.min(2_000, Math.round(tokens.length / minutes)));
  };

  if (phase === 'reading') {
    return (
      <Card className="min-h-[420px]">
        <div className="mb-4 flex items-center justify-between text-[11px] text-muted">
          <span>{selected.title} · {mode.toLowerCase()} · target {sessionMinutes} min</span>
          <span className="tabular-nums">{Math.min(tokens.length, index + effectiveChunk)} / {tokens.length}</span>
        </div>
        {mode === 'PACED' ? (
          <div className="mx-auto max-w-3xl leading-[2.1]" style={{ fontSize }}>
            {tokens.map((token, tokenIndex) => <span key={`${token}-${tokenIndex}`} className={tokenIndex >= index && tokenIndex < index + effectiveChunk ? 'rounded bg-accent/25 text-white' : tokenIndex < index ? 'text-muted/40' : ''}>{token}{' '}</span>)}
          </div>
        ) : mode === 'BENCHMARK' ? (
          <div className="mx-auto max-w-3xl whitespace-pre-line leading-[1.8]" style={{ fontSize }}>{selected.text}</div>
        ) : (
          <div className="flex min-h-72 items-center justify-center text-center font-medium" style={{ fontSize }}>{visible.join(' ')}</div>
        )}
        <div className="mt-5 flex justify-center gap-2">
          {mode !== 'BENCHMARK' && <button className={btnCls} onClick={() => setPaused((value) => !value)}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button>}
          {mode === 'BENCHMARK' && <button className={btnPrimaryCls} onClick={finishReading}>Finished reading</button>}
        </div>
      </Card>
    );
  }

  if (phase === 'questions') {
    return (
      <Card>
        <div className="mb-1 text-[15px] font-semibold">Comprehension check</div>
        <p className="mb-4 text-[11px] text-muted">The passage is hidden until answers are submitted. Answer from memory.</p>
        <div className="space-y-5">
          {selected.questions.map((question, questionIndex) => (
            <fieldset key={question.id}>
              <legend className="mb-2 text-[13px] font-medium">{questionIndex + 1}. {question.prompt}</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {question.choices.map((choice, choiceIndex) => (
                  <label key={choiceIndex} className={`cursor-pointer rounded-md border px-3 py-2 text-[12px] ${answers[question.id] === choiceIndex ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'}`}>
                    <input type="radio" className="mr-2" name={question.id} checked={answers[question.id] === choiceIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: choiceIndex }))} />{choice}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button disabled={pending || Object.keys(answers).length !== selected.questions.length} className={`${btnPrimaryCls} disabled:opacity-40`} onClick={() => {
            if (!startedAt.current || !questionsStartedAt.current) return;
            const sessionStartedAt = startedAt.current;
            const questionStartTime = questionsStartedAt.current;
            startTransition(async () => {
              const output = await completeSpeedReadingSessionAction({
                passageId: selected.id,
                mode,
                wpm: measuredWpm(),
                chunkSize: effectiveChunk,
                fontSize,
                punctuationPause,
                comprehensionThreshold: threshold / 100,
                startedAt: sessionStartedAt.toISOString(),
                durationSec: Math.max(1, Math.round(((readingFinishedAt.current ?? Date.now()) - sessionStartedAt.getTime()) / 1000)),
                responseTimeMs: Date.now() - questionStartTime,
                answers,
              });
              if (!output.ok) {
                setMessage(output.error);
                return;
              }
              setResult(output);
              setWpm(output.recommendedNextWpm);
              const blockElapsedSec = trainingBlockStartedAt.current == null ? 0 : Math.round((Date.now() - trainingBlockStartedAt.current) / 1000);
              setRemainingTargetSec(Math.max(0, sessionMinutes * 60 - blockElapsedSec));
              setPhase('result');
              router.refresh();
            });
          }}>{pending ? 'Scoring…' : 'Submit answers'}</button>
          {message && <span className="text-[12px] text-red-300">{message}</span>}
        </div>
      </Card>
    );
  }

  if (phase === 'result' && result?.ok) {
    return (
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xl font-semibold text-green-300">{result.correct}/{result.total} correct · {Math.round(result.accuracy * 100)}%</div><div className="mt-1 text-[12px] text-muted">Next recommended speed: <strong className="text-foreground">{result.recommendedNextWpm} WPM</strong></div></div>
          <button className={btnPrimaryCls} onClick={() => {
            if (remainingTargetSec <= 0) trainingBlockStartedAt.current = null;
            const currentIndex = availablePassages.findIndex((passage) => passage.id === selected.id);
            const nextPassage = availablePassages[(currentIndex + 1) % availablePassages.length];
            if (nextPassage) setPassageId(nextPassage.id);
            setPhase('setup');
          }}>
            {remainingTargetSec > 0 ? `Next passage · ${Math.ceil(remainingTargetSec / 60)}m target left` : 'Start another session'}
          </button>
        </div>
        <div className="mt-5 divide-y divide-line">
          {result.explanations.map((explanation, indexNumber) => <div key={explanation.questionId} className="py-3 text-[12px]"><span className={explanation.isCorrect ? 'text-green-300' : 'text-red-300'}>{explanation.isCorrect ? '✓' : '✗'} Question {indexNumber + 1}</span><p className="mt-1 text-muted">{explanation.explanation}</p></div>)}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="grid items-end gap-3 md:grid-cols-[minmax(220px,1fr)_auto]">
        <label className="text-[11px] text-muted">Passage<select className={`${inputCls} mt-1`} value={selected.id} onChange={(event) => setPassageId(event.target.value)}>{availablePassages.map((passage) => <option value={passage.id} key={passage.id}>{passage.title}</option>)}</select></label>
        <button className={btnPrimaryCls} onClick={start}>Start {mode === 'BENCHMARK' ? 'benchmark' : `at ${wpm} WPM`}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <Badge tone="blue">{mode.toLowerCase()}</Badge><span>{selected.topic}</span><span>·</span><span>{selected.wordCount} words</span><span>·</span><span>{selected.questions.length} questions</span><span>·</span><span>{chunkSize} word{chunkSize === 1 ? '' : 's'} at once</span><span>·</span><span>{sessionMinutes} min target</span>
        <Link href="/configurations?section=random-skills&skill=reading" className="ml-auto text-accent hover:underline">Configure →</Link>
      </div>
    </Card>
  );
}
