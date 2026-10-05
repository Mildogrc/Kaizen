export interface YouTubeWatchItem {
  position: number;
  durationSeconds: number | null;
  watchedSeconds: number;
  completed: boolean;
}

export function formatYouTubeWatchTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return `${hours ? `${hours}h ` : ''}${minutes}m ${remainder}s`;
}

export function youtubePlaylistProgress(
  items: YouTubeWatchItem[],
  totalItems = items.length,
  resume?: { currentPosition: number; currentSeconds: number },
) {
  let watchedSeconds = 0;
  let totalSeconds = 0;
  let knownDurations = 0;

  for (const item of items) {
    const duration = item.durationSeconds;
    const savedSeconds = Math.max(0, item.watchedSeconds, item.position === resume?.currentPosition ? resume.currentSeconds : 0);
    if (duration != null && duration > 0) {
      totalSeconds += duration;
      knownDurations += 1;
      watchedSeconds += item.completed ? duration : Math.min(savedSeconds, duration);
    } else {
      watchedSeconds += savedSeconds;
    }
  }

  const hasTotalDuration = knownDurations === Math.max(items.length, totalItems) && totalSeconds > 0;
  const percentage = hasTotalDuration ? Math.min(100, watchedSeconds / totalSeconds * 100) : null;
  const percentageLabel = percentage == null ? '—'
    : percentage > 0 && percentage < 0.01 ? '<0.01%'
    : `${Math.floor(percentage * 100) / 100}%`;

  return {
    watchedSeconds,
    totalSeconds: hasTotalDuration ? totalSeconds : null,
    percentage,
    percentageLabel,
    timeLabel: `${formatYouTubeWatchTime(watchedSeconds)} / ${hasTotalDuration ? formatYouTubeWatchTime(totalSeconds) : 'duration unavailable'}`,
  };
}

export type YouTubeWatchProgress = ReturnType<typeof youtubePlaylistProgress>;

export function youtubePlaybackUpdate(item: YouTubeWatchItem, seconds: number, ended = false) {
  const duration = item.durationSeconds != null && item.durationSeconds > 0 ? item.durationSeconds : null;
  const positionSeconds = Math.min(Math.max(0, Math.floor(seconds)), duration ?? Infinity);
  const completed = item.completed || ended || (duration != null && positionSeconds >= duration);
  return {
    watchedSeconds: Math.min(Math.max(item.watchedSeconds, completed && duration != null ? duration : positionSeconds), duration ?? Infinity),
    currentSeconds: ended ? 0 : positionSeconds,
    completed,
  };
}
