'use client';

// Per-deck leech browser: pick a deck, slide how many leeches to include.
// The table and the lesson-plan download/copy honor the selection.

import { useState } from 'react';
import { Card, btnCls } from '@/components/ui';

export interface LeechCard {
  ankiCardId: string;
  front: string;
  back: string;
  lapses: number;
  intervalDays: number;
  ease: number;
}

export interface DeckLeeches {
  mappingId: string;
  deckName: string;
  leeches: LeechCard[];
}

export function LeechPanel({ decks }: { decks: DeckLeeches[] }) {
  const withLeeches = decks.filter((d) => d.leeches.length > 0);
  const [mappingId, setMappingId] = useState(withLeeches[0]?.mappingId ?? '');
  const selected = withLeeches.find((d) => d.mappingId === mappingId) ?? withLeeches[0] ?? null;
  const total = selected?.leeches.length ?? 0;
  const [countByDeck, setCountByDeck] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  if (!selected) {
    return <Card className="p-3 text-[12px] text-muted">No leeches — nothing is stuck.</Card>;
  }

  const count = Math.min(countByDeck[selected.mappingId] ?? Math.min(10, total), total);
  const shown = selected.leeches.slice(0, count);
  const planUrl = `/anki/leech-plan/${selected.mappingId}?limit=${count}`;

  const copyPlan = async () => {
    const res = await fetch(planUrl);
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      {/* Deck picker */}
      {withLeeches.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {withLeeches.map((d) => (
            <button
              key={d.mappingId}
              onClick={() => setMappingId(d.mappingId)}
              className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
                d.mappingId === selected.mappingId
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-2 text-muted hover:border-accent/40 hover:text-foreground'
              }`}
            >
              {d.deckName} <span className="tabular-nums opacity-70">({d.leeches.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Count slider + actions */}
      <Card className="mb-2 flex flex-wrap items-center gap-4 p-3">
        <label className="flex min-w-56 flex-1 items-center gap-3 text-[12px] text-muted">
          <span className="shrink-0">
            leeches: <span className="font-semibold tabular-nums text-foreground">{count}</span>
            <span className="tabular-nums"> / {total}</span>
          </span>
          <input
            type="range"
            min={1}
            max={total}
            value={count}
            onChange={(e) =>
              setCountByDeck((prev) => ({ ...prev, [selected.mappingId]: Number(e.target.value) }))
            }
            className="h-1.5 w-full max-w-72 cursor-pointer accent-[#6ea8fe]"
            aria-label="Number of leeches to include"
          />
        </label>
        <div className="flex items-center gap-2">
          <a href={planUrl} download className={btnCls}>
            ⬇ Lesson plan (.md) — top {count}
          </a>
          <button onClick={copyPlan} className={btnCls}>
            {copied ? '✓ Copied' : '⧉ Copy'}
          </button>
        </div>
      </Card>

      {/* Leech table */}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Answer</th>
              <th className="px-3 py-2 text-right">Lapses</th>
              <th className="px-3 py-2 text-right">Interval</th>
              <th className="px-3 py-2 text-right">Ease</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.ankiCardId} className="border-b border-line/50">
                <td className="max-w-56 truncate px-3 py-1.5">{c.front}</td>
                <td className="max-w-72 truncate px-3 py-1.5 text-muted">{c.back}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-300">{c.lapses}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.intervalDays}d</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{c.ease.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
