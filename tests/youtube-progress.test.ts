import { describe, expect, it } from 'vitest';
import { formatYouTubeWatchTime, youtubePlaybackUpdate, youtubePlaylistProgress, type YouTubeWatchItem } from '../src/lib/youtube-progress';

const shortVideo: YouTubeWatchItem = { position: 0, durationSeconds: 60, watchedSeconds: 0, completed: false };
const longVideo: YouTubeWatchItem = { position: 1, durationSeconds: 540, watchedSeconds: 0, completed: false };

describe('YouTube time-based progress', () => {
  it('weights finished videos by duration instead of video count', () => {
    const result = youtubePlaylistProgress([{ ...shortVideo, completed: true }, longVideo]);
    expect(result).toMatchObject({ watchedSeconds: 60, totalSeconds: 600, percentage: 10, percentageLabel: '10%' });
  });

  it('includes partial videos down to the second', () => {
    const result = youtubePlaylistProgress([{ ...shortVideo, watchedSeconds: 30 }, { ...longVideo, watchedSeconds: 61 }]);
    expect(result.watchedSeconds).toBe(91);
    expect(result.percentage).toBeCloseTo(91 / 600 * 100);
    expect(result.timeLabel).toBe('1m 31s / 10m 0s');
  });

  it('includes existing manually saved positions without counting them twice', () => {
    const result = youtubePlaylistProgress([shortVideo, { ...longVideo, watchedSeconds: 90 }], 2, { currentPosition: 1, currentSeconds: 100 });
    expect(result.watchedSeconds).toBe(100);
  });

  it('caps each video at its duration and keeps progress after rewatching', () => {
    const update = youtubePlaybackUpdate({ ...shortVideo, watchedSeconds: 60, completed: true }, 20);
    expect(update.watchedSeconds).toBe(60);
    expect(youtubePlaylistProgress([{ ...shortVideo, watchedSeconds: 1000 }]).percentage).toBe(100);
  });

  it('records a finished video at its full duration even if the last save is early', () => {
    expect(youtubePlaybackUpdate(shortVideo, 58, true)).toEqual({ watchedSeconds: 60, currentSeconds: 0, completed: true });
  });

  it('does not count earlier videos just because a later video was watched', () => {
    const result = youtubePlaylistProgress([shortVideo, { ...longVideo, ...youtubePlaybackUpdate(longVideo, 54) }]);
    expect(result.percentage).toBe(9);
  });

  it('does not invent a percentage when total duration is unknown', () => {
    expect(youtubePlaylistProgress([]).percentage).toBeNull();
    expect(youtubePlaylistProgress([shortVideo, { ...longVideo, durationSeconds: null }]).percentage).toBeNull();
    expect(youtubePlaylistProgress([shortVideo], 2).percentageLabel).toBe('—');
  });

  it('keeps hour and second precision and avoids showing 100% prematurely', () => {
    expect(formatYouTubeWatchTime(3661)).toBe('1h 1m 1s');
    expect(youtubePlaylistProgress([{ ...longVideo, durationSeconds: 100000, watchedSeconds: 99999 }]).percentageLabel).toBe('99.99%');
    expect(youtubePlaylistProgress([{ ...longVideo, durationSeconds: 100000, watchedSeconds: 1 }]).percentageLabel).toBe('<0.01%');
  });
});
