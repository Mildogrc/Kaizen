'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MANDARIN_INITIAL_TONES,
  MANDARIN_TONES,
  type MandarinPronunciationCandidate,
  type MandarinTone,
  type TonePairKey,
} from '@/lib/mandarin-pronunciation';

const TONE_STYLES: Record<MandarinTone, string> = {
  1: 'text-red-400',
  2: 'text-lime-400',
  3: 'text-sky-400',
  4: 'text-fuchsia-400',
  5: 'text-zinc-400',
};

const TONE_LABELS: Record<MandarinTone, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: 'Neutral',
};

export function TonePairGrid({ entries }: { entries: Record<TonePairKey, MandarinPronunciationCandidate | null> }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<TonePairKey | null>(null);
  const [audioError, setAudioError] = useState(false);

  useEffect(() => () => audioRef.current?.pause(), []);

  const play = (tonePair: TonePairKey, entry: MandarinPronunciationCandidate) => {
    audioRef.current?.pause();
    setAudioError(false);
    const audio = new Audio(`/chinese/pronunciation/audio?file=${encodeURIComponent(entry.audioFilename)}`);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    audio.onerror = () => {
      setPlaying(null);
      setAudioError(true);
    };
    setPlaying(tonePair);
    audio.play().catch(() => {
      setPlaying(null);
      setAudioError(true);
    });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="grid min-w-[850px] grid-cols-[110px_repeat(5,minmax(145px,1fr))]">
          <div className="flex items-center justify-center border-b border-r border-line bg-surface-2 px-3 py-4 text-[12px] font-semibold uppercase tracking-wider text-muted">Tones</div>
          {MANDARIN_TONES.map((tone) => <div key={`column-${tone}`} className={`flex items-center justify-center border-b border-r border-line bg-surface-2 px-3 py-4 text-[13px] font-semibold last:border-r-0 ${TONE_STYLES[tone]}`}>{TONE_LABELS[tone]} tone</div>)}
          {MANDARIN_INITIAL_TONES.flatMap((firstTone) => [
            <div key={`row-${firstTone}`} className={`flex items-center justify-center border-b border-r border-line bg-surface-2 px-3 py-4 text-[13px] font-semibold ${TONE_STYLES[firstTone]}`}>{TONE_LABELS[firstTone]} tone</div>,
            ...MANDARIN_TONES.map((secondTone) => {
              const tonePair = `${firstTone}-${secondTone}` as TonePairKey;
              const entry = entries[tonePair];
              return <button
                key={tonePair}
                type="button"
                disabled={!entry}
                onClick={() => entry && play(tonePair, entry)}
                aria-label={entry ? `Play ${entry.word}, tones ${firstTone} and ${secondTone}` : `No reviewed word for tones ${firstTone} and ${secondTone}`}
                className={`relative min-h-32 border-b border-r border-line px-3 py-3 text-center transition-colors last:border-r-0 ${entry ? 'cursor-pointer hover:bg-surface-2 focus:bg-surface-2 focus:outline-none' : 'cursor-default bg-surface/40'}`}
              >
                {entry ? <>
                  <span className="block text-2xl font-semibold tracking-wide">{entry.word}</span>
                  <span className="mt-1 block text-[15px] font-medium">
                    {entry.syllables.map((syllable, index) => <span key={`${syllable.pinyin}-${index}`} className={TONE_STYLES[syllable.tone]}>{syllable.pinyin}</span>)}
                  </span>
                  <span className="mt-1.5 line-clamp-2 block text-[11px] leading-4 text-muted">{entry.definition || 'Reviewed Mandarin word'}</span>
                  <span className="absolute right-2 top-2 text-[10px] text-muted">{playing === tonePair ? '●' : '▶'}</span>
                </> : <span className="text-[11px] text-muted/50">No reviewed word yet</span>}
              </button>;
            }),
          ])}
        </div>
      </div>
      {audioError && <p role="status" className="mt-2 text-[11px] text-amber-300">Word audio could not be loaded. Keep Anki open and try again.</p>}
    </>
  );
}
