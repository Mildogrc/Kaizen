'use client';

// Flashcard review session: front → reveal → Again/Hard/Good/Easy.
// Keyboard: Space/Enter reveals, 1–4 rate. Lapsed (Again) and still-learning
// cards re-enter the session queue. Rich Anki-imported cards render pinyin,
// sentences, images, and audio from metadata.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rateFlashcard } from '@/lib/actions';
import type { Rating } from '@/lib/srs';
import { Badge, Card, EmptyState, btnCls } from '@/components/ui';

export interface SessionCard {
  recordId: string;
  front: string;
  back: string;
  metadata: Record<string, unknown>;
  maturity: string;
  courseName: string;
  courseColor: string | null;
}

interface AnkiMeta {
  audio?: string | null;
  frontAudio?: string | null;
  traditional?: string;
  partOfSpeech?: string;
  twPronunciation?: string;
  note?: string;
  sentence?: {
    simplified?: string;
    traditional?: string;
    pinyin?: string;
    meaning?: string;
    audio?: string | null;
    image?: string | null;
  };
}

const RATINGS: { rating: Rating; label: string; key: string; cls: string }[] = [
  { rating: 'AGAIN', label: 'Again', key: '1', cls: 'border-red-800 bg-red-950/50 text-red-300 hover:bg-red-950' },
  { rating: 'HARD', label: 'Hard', key: '2', cls: 'border-amber-800 bg-amber-950/50 text-amber-300 hover:bg-amber-950' },
  { rating: 'GOOD', label: 'Good', key: '3', cls: 'border-green-800 bg-green-950/50 text-green-300 hover:bg-green-950' },
  { rating: 'EASY', label: 'Easy', key: '4', cls: 'border-blue-800 bg-blue-950/50 text-blue-300 hover:bg-blue-950' },
];

export function ReviewSession({ cards }: { cards: SessionCard[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState<SessionCard[]>(cards);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState({ AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const current = queue[0] ?? null;
  const meta = useMemo(() => (current?.metadata ?? {}) as AnkiMeta, [current]);

  const playAudio = useCallback((src?: string | null) => {
    if (!src) return;
    audioRef.current?.pause();
    audioRef.current = new Audio(src);
    audioRef.current.play().catch(() => {});
  }, []);

  const reveal = useCallback(() => {
    if (!current || revealed) return;
    setRevealed(true);
    playAudio(meta.audio ?? meta.frontAudio);
  }, [current, revealed, meta, playAudio]);

  const applyRating = useCallback(
    (rating: Rating) => {
      if (!current || !revealed) return;
      const card = current;
      rateFlashcard(card.recordId, rating).catch(() => {});
      setStats((s) => ({ ...s, [rating]: s[rating] + 1 }));
      setQueue((q) => {
        const rest = q.slice(1);
        // Lapsed or still-learning cards come back later in this session.
        const learningAgain = rating === 'AGAIN' || (rating === 'HARD' && card.maturity === 'LEARNING');
        const graduatingFirstStep = rating === 'GOOD' && (card.maturity === 'NEW' || card.maturity === 'LEARNING');
        if (learningAgain || (graduatingFirstStep && card.maturity === 'NEW')) {
          return [...rest, { ...card, maturity: 'LEARNING' }];
        }
        return rest;
      });
      if (rating !== 'AGAIN') setDone((d) => d + 1);
      setRevealed(false);
    },
    [current, revealed],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) reveal();
        else applyRating('GOOD');
      }
      const r = RATINGS.find((x) => x.key === e.key);
      if (r && revealed) {
        e.preventDefault();
        applyRating(r.rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, applyRating, revealed]);

  if (cards.length === 0) {
    return <EmptyState>Nothing due. Import content or come back when reviews are due.</EmptyState>;
  }

  if (!current) {
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <div className="text-lg font-semibold text-green-300">Session complete</div>
        <p className="mt-2 text-[13px] text-muted">
          {done} cards reviewed — {stats.AGAIN} again · {stats.HARD} hard · {stats.GOOD} good · {stats.EASY} easy
        </p>
        <button className={`${btnCls} mt-4`} onClick={() => router.refresh()}>
          Load next batch
        </button>
      </Card>
    );
  }

  const sentence = meta.sentence;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted tabular-nums">
        <span>
          {queue.length} left in session · {done} done
        </span>
        <span className="flex items-center gap-2">
          <Badge tone={current.maturity === 'NEW' ? 'neutral' : current.maturity === 'LEARNING' ? 'amber' : 'blue'}>
            {current.maturity.toLowerCase()}
          </Badge>
          <Badge>{current.courseName}</Badge>
        </span>
      </div>

      <Card className="min-h-72 p-8">
        {/* Front */}
        <div className="text-center">
          <div className={`font-medium ${current.front.length <= 4 ? 'text-6xl' : current.front.length <= 12 ? 'text-4xl' : 'text-2xl'}`}>
            {current.front}
          </div>
          {revealed && meta.traditional && (
            <div className="mt-1 text-[13px] text-muted">trad. {meta.traditional}</div>
          )}
        </div>

        {/* Back */}
        {revealed ? (
          <div className="mt-6 border-t border-line pt-5 text-center">
            <div className="text-xl">{current.back}</div>
            <div className="mt-1 flex items-center justify-center gap-2 text-[12px] text-muted">
              {meta.partOfSpeech && <span>{meta.partOfSpeech}</span>}
              {meta.audio && (
                <button onClick={() => playAudio(meta.audio)} className="text-accent hover:underline cursor-pointer">
                  ▶ audio
                </button>
              )}
            </div>
            {sentence?.simplified && (
              <div className="mx-auto mt-4 max-w-md rounded-md border border-line bg-surface-2/60 p-3 text-left">
                <div className="text-[15px]">{sentence.simplified}</div>
                {sentence.pinyin && <div className="mt-0.5 text-[12px] text-muted">{sentence.pinyin}</div>}
                {sentence.meaning && <div className="mt-0.5 text-[12px]">{sentence.meaning}</div>}
                <div className="mt-1.5 flex items-center gap-3">
                  {sentence.audio && (
                    <button onClick={() => playAudio(sentence.audio)} className="text-[11px] text-accent hover:underline cursor-pointer">
                      ▶ sentence audio
                    </button>
                  )}
                </div>
                {sentence.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sentence.image} alt="" className="mt-2 max-h-40 rounded" />
                )}
              </div>
            )}
            {meta.note && <p className="mt-3 text-[12px] text-muted">{meta.note}</p>}
          </div>
        ) : (
          <div className="mt-8 text-center text-[12px] text-muted">press Space to reveal</div>
        )}
      </Card>

      {/* Controls */}
      <div className="mt-4 flex justify-center gap-2">
        {revealed ? (
          RATINGS.map((r) => (
            <button
              key={r.rating}
              onClick={() => applyRating(r.rating)}
              className={`w-24 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer ${r.cls}`}
            >
              {r.label}
              <span className="ml-1.5 text-[10px] opacity-60">{r.key}</span>
            </button>
          ))
        ) : (
          <button onClick={reveal} className={`${btnCls} w-64 justify-center py-2`}>
            Show answer <span className="ml-1 text-[10px] opacity-60">space</span>
          </button>
        )}
      </div>
    </div>
  );
}
