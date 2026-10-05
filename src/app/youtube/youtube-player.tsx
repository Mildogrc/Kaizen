'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { btnCls } from '@/components/ui';
import { YOUTUBE_PROGRESS_EVENT } from './watch-progress';

interface PlayerVideoData {
  video_id?: string;
}

interface YouTubePlayerInstance {
  destroy(): void;
  getCurrentTime(): number;
  getPlaylistIndex(): number;
  getVideoData(): PlayerVideoData;
}

interface YouTubePlayerEvent {
  target: YouTubePlayerInstance;
  data: number;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId?: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YouTubeApi>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

export function YouTubePlayer({
  playlistDatabaseId,
  youtubePlaylistId,
  videoId,
  position,
  seconds,
}: {
  playlistDatabaseId: string;
  youtubePlaylistId: string;
  videoId: string | null;
  position: number;
  seconds: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const [status, setStatus] = useState('Position saves automatically while you watch.');

  const saveProgress = useCallback(async (ended = false, keepalive = false) => {
    const player = playerRef.current;
    if (!player) return;
    const currentVideoId = player.getVideoData().video_id;
    if (!currentVideoId) return;
    const response = await fetch(`/api/youtube/playlists/${encodeURIComponent(playlistDatabaseId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: currentVideoId,
        position: Math.max(0, player.getPlaylistIndex()),
        seconds: Math.max(0, player.getCurrentTime()),
        ended,
      }),
      keepalive,
    }).catch(() => null);
    if (!keepalive) {
      if (response?.ok) {
        const result = await response.json();
        window.dispatchEvent(new CustomEvent(YOUTUBE_PROGRESS_EVENT, { detail: { playlistId: playlistDatabaseId, progress: result.progress } }));
        setStatus(ended ? 'Lecture completed and position saved.' : 'Position saved.');
      } else {
        setStatus('Could not save your position. Try “Save position now” again.');
      }
    }
  }, [playlistDatabaseId]);

  useEffect(() => {
    let disposed = false;
    let saveTimer: number | null = null;
    const mount = mountRef.current;
    if (!mount) return;

    loadYouTubeApi().then((api) => {
      if (disposed) return;
      playerRef.current = new api.Player(mount, {
        ...(videoId ? { videoId } : {}),
        playerVars: {
          list: youtubePlaylistId,
          listType: 'playlist',
          index: Math.max(0, position),
          start: Math.max(0, seconds),
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: () => setStatus('Ready — position saves automatically while you watch.'),
          onStateChange: (event) => {
            if (event.data === api.PlayerState.PLAYING) {
              if (saveTimer != null) window.clearInterval(saveTimer);
              saveTimer = window.setInterval(() => void saveProgress(), 15_000);
            } else {
              if (saveTimer != null) window.clearInterval(saveTimer);
              saveTimer = null;
              if (event.data === api.PlayerState.PAUSED) void saveProgress();
              if (event.data === api.PlayerState.ENDED) void saveProgress(true);
            }
          },
          onError: () => setStatus('This lecture cannot be embedded. Use “Open in YouTube” below.'),
        },
      });
    });

    const saveBeforeLeaving = () => void saveProgress(false, true);
    window.addEventListener('pagehide', saveBeforeLeaving);
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', saveBeforeLeaving);
      if (saveTimer != null) window.clearInterval(saveTimer);
      void saveProgress(false, true);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [position, saveProgress, seconds, videoId, youtubePlaylistId]);

  const saveNow = async () => {
    await saveProgress();
  };

  return (
    <div>
      <div className="aspect-video overflow-hidden rounded-lg border border-line bg-black">
        <div ref={mountRef} className="h-full w-full" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={saveNow} className={btnCls}>Save position now</button>
        <span className="text-[11px] text-muted">{status}</span>
      </div>
    </div>
  );
}
