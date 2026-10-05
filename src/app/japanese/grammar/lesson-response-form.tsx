'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnPrimaryCls, inputCls } from '@/components/ui';
import type { GrammarAppRating } from '@/lib/grammar-coach';
import { submitGrammarLessonRatingsAction } from './actions';

interface LessonRatingItem {
  learningItemId: string;
  pattern: string;
  meaning: string;
  kind: 'new' | 'review';
}

export function LessonResponseForm({ lessonId, items }: { lessonId: string; items: LessonRatingItem[] }) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, GrammarAppRating | ''>>(() => Object.fromEntries(
    items.map((item) => [item.learningItemId, '']),
  ));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const complete = items.every((item) => ratings[item.learningItemId]);

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      setError(null);
      setMessage(null);
      startTransition(async () => {
        try {
          const result = await submitGrammarLessonRatingsAction({
            lessonId,
            ratings: items.map((item) => ({
              learningItemId: item.learningItemId,
              rating: ratings[item.learningItemId],
            })),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMessage(result.message);
          router.refresh();
        } catch {
          setError('The ratings were not saved. Check the connection and try again.');
        }
      });
    }}>
      <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
        {items.map((item, index) => (
          <div key={item.learningItemId} className="grid gap-2 bg-surface px-3 py-3 sm:grid-cols-[2rem_1fr_10rem] sm:items-center">
            <span className="text-[12px] font-semibold tabular-nums text-muted">{index + 1}.</span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{item.pattern} <span className="text-[10px] uppercase text-muted">{item.kind}</span></div>
              <div className="mt-0.5 truncate text-[11px] text-muted">{item.meaning}</div>
            </div>
            <select
              aria-label={`Rating for ${item.pattern}`}
              value={ratings[item.learningItemId]}
              disabled={pending}
              required
              className={inputCls}
              onChange={(event) => setRatings((current) => ({
                ...current,
                [item.learningItemId]: event.target.value as GrammarAppRating | '',
              }))}
            >
              <option value="">Choose rating…</option>
              <option value="AGAIN">Again</option>
              <option value="GOOD">Good</option>
              <option value="PERFECT">Perfect</option>
            </select>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md bg-surface-2 p-3 text-[11px] leading-5 text-muted">
        <strong className="text-foreground">Again</strong> means the point still needs teaching. <strong className="text-foreground">Good</strong> means you understood it with some effort or correction. <strong className="text-foreground">Perfect</strong> means immediate command; a new point becomes mature immediately, while a review receives an Easy interval.
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !complete} className={`${btnPrimaryCls} disabled:opacity-50`}>
          {pending ? 'Saving…' : 'Save lesson ratings'}
        </button>
        {error && <span role="alert" className="text-[12px] text-red-300">{error}</span>}
        {message && <span role="status" className="text-[12px] text-green-300">{message}</span>}
      </div>
    </form>
  );
}
