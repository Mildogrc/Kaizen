'use client';

import { useEffect, useState } from 'react';
import { ProgressBar, StatCard } from '@/components/ui';
import type { YouTubeWatchProgress } from '@/lib/youtube-progress';

export const YOUTUBE_PROGRESS_EVENT = 'youtube-progress-saved';

export function WatchProgress({ playlistId, initialProgress, display }: {
  playlistId: string;
  initialProgress: YouTubeWatchProgress;
  display: 'stat' | 'bar';
}) {
  const [savedProgress, setSavedProgress] = useState<YouTubeWatchProgress | null>(null);
  const progress = savedProgress ?? initialProgress;

  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ playlistId: string; progress: YouTubeWatchProgress }>).detail;
      if (detail.playlistId === playlistId) setSavedProgress(detail.progress);
    };
    window.addEventListener(YOUTUBE_PROGRESS_EVENT, onSaved);
    return () => window.removeEventListener(YOUTUBE_PROGRESS_EVENT, onSaved);
  }, [playlistId]);

  if (display === 'stat') return <StatCard label="Progress" value={progress.percentageLabel} hint="Based on time watched" />;
  return (
    <div className="mb-6">
      <div className="mb-1 flex justify-between gap-3 text-[11px] text-muted"><span>Time watched</span><span>{progress.timeLabel}</span></div>
      <ProgressBar pct={progress.percentage ?? 0} />
    </div>
  );
}
