'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, btnPrimaryCls } from '@/components/ui';
import { completeRetentionCheckAction } from './actions';
import type { TrainerQuestion } from './trainer';

export interface RetentionCheck {
  sessionId: string;
  title: string;
  readAt: string;
  questions: TrainerQuestion[];
}

export function RetentionChecks({ checks }: { checks: RetentionCheck[] }) {
  const router = useRouter();
  const check = checks[0];
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!check) return null;

  return (
    <Card>
      <div className="mb-1 text-[13px] font-semibold">Retention mode · {check.title}</div>
      <p className="mb-4 text-[11px] text-muted">Read {new Date(check.readAt).toLocaleDateString()}. The passage remains hidden to measure delayed retention.</p>
      <div className="space-y-4">
        {check.questions.map((question, questionIndex) => <fieldset key={question.id}><legend className="mb-1.5 text-[12px]">{questionIndex + 1}. {question.prompt}</legend><div className="grid gap-1 sm:grid-cols-2">{question.choices.map((choice, choiceIndex) => <label key={choiceIndex} className={`cursor-pointer rounded border px-2.5 py-1.5 text-[11px] ${answers[question.id] === choiceIndex ? 'border-accent bg-accent/10' : 'border-line bg-surface-2'}`}><input className="mr-2" type="radio" name={`retention-${question.id}`} checked={answers[question.id] === choiceIndex} onChange={() => setAnswers((current) => ({ ...current, [question.id]: choiceIndex }))} />{choice}</label>)}</div></fieldset>)}
      </div>
      <div className="mt-4 flex items-center gap-3"><button disabled={pending || Object.keys(answers).length !== check.questions.length} className={`${btnPrimaryCls} disabled:opacity-40`} onClick={() => startTransition(async () => {
        const result = await completeRetentionCheckAction(check.sessionId, answers);
        if (!result.ok) setMessage(result.error);
        else {
          setMessage(`Retention: ${result.correct}/${result.total} (${Math.round(result.accuracy * 100)}%).`);
          router.refresh();
        }
      })}>{pending ? 'Scoring…' : 'Submit retention check'}</button>{message && <span className="text-[12px] text-muted">{message}</span>}</div>
    </Card>
  );
}
