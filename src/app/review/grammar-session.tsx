'use client';

import { useState } from 'react';
import { Badge, Card, EmptyState, btnCls } from '@/components/ui';
import type { Rating } from '@/lib/srs';
import { rateGrammarReviewAction } from './actions';

export interface GrammarReviewCard {
  progressId: string;
  pattern: string;
  meaning: string;
  level: string;
  examples: string[];
  status: string;
}

const RATINGS: { rating: Rating; label: string; className: string }[] = [
  { rating: 'AGAIN', label: 'Again', className: 'border-red-800 text-red-300' },
  { rating: 'HARD', label: 'Hard', className: 'border-amber-800 text-amber-300' },
  { rating: 'GOOD', label: 'Good', className: 'border-green-800 text-green-300' },
  { rating: 'EASY', label: 'Easy', className: 'border-blue-800 text-blue-300' },
];

export function GrammarReviewSession({ cards }: { cards: GrammarReviewCard[] }) {
  const [queue, setQueue] = useState(cards);
  const [revealed, setRevealed] = useState(false);
  const current = queue[0];
  if (!cards.length) return <EmptyState>No Japanese grammar is due right now. New grammar is introduced through the Grammar Coach.</EmptyState>;
  if (!current) return <Card className="p-8 text-center"><div className="text-lg font-semibold text-green-300">Grammar review complete</div></Card>;

  return <div className="mx-auto max-w-2xl">
    <div className="mb-2 flex items-center justify-between text-[11px] text-muted"><span>{queue.length} grammar points left</span><span className="flex gap-2"><Badge>{current.level}</Badge><Badge tone={current.status === 'MASTERED' ? 'green' : 'blue'}>{current.status.toLowerCase()}</Badge></span></div>
    <Card className="min-h-72 p-8 text-center">
      <div className="text-4xl font-medium">{current.pattern}</div>
      {revealed ? <div className="mt-6 border-t border-line pt-5"><div className="text-xl">{current.meaning}</div>{current.examples.map((example) => <div key={example} className="mt-3 text-[13px] text-muted">{example}</div>)}</div> : <div className="mt-8 text-[12px] text-muted">Recall the meaning and usage, then reveal.</div>}
    </Card>
    <div className="mt-4 flex justify-center gap-2">
      {!revealed ? <button className={`${btnCls} w-64 justify-center`} onClick={() => setRevealed(true)}>Show answer</button> : RATINGS.map((item) => <button key={item.rating} className={`w-24 rounded-md border px-3 py-2 text-[13px] ${item.className}`} onClick={() => {
        rateGrammarReviewAction(current.progressId, item.rating).catch(() => {});
        setQueue((existing) => item.rating === 'AGAIN' ? [...existing.slice(1), current] : existing.slice(1));
        setRevealed(false);
      }}>{item.label}</button>)}
    </div>
  </div>;
}
