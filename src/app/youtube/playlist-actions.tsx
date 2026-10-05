'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnCls, btnPrimaryCls } from '@/components/ui';
import { generateYouTubeArtworkPrompt, refreshYouTubePlaylist } from './actions';

export function PlaylistMetadataActions({ playlistId }: { playlistId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = (kind: 'refresh' | 'prompt') => {
    setMessage(null);
    startTransition(async () => {
      const result = kind === 'refresh'
        ? await refreshYouTubePlaylist(playlistId)
        : await generateYouTubeArtworkPrompt(playlistId);
      setMessage(result.error ?? result.message ?? null);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => run('refresh')} className={`${btnCls} disabled:opacity-50`}>
        Refresh lectures
      </button>
      <button type="button" disabled={pending} onClick={() => run('prompt')} className={`${btnPrimaryCls} disabled:opacity-50`}>
        Generate image prompt
      </button>
      {message && <span className="text-[11px] text-muted">{message}</span>}
    </div>
  );
}
