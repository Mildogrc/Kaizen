'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { btnPrimaryCls, inputCls } from '@/components/ui';
import { addYouTubePlaylist, type YouTubeActionState } from './actions';

const initialState: YouTubeActionState = { ok: false };

export function AddPlaylistForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(addYouTubePlaylist, initialState);

  useEffect(() => {
    if (state.ok && state.playlistId) router.push(`/youtube/${state.playlistId}`);
  }, [router, state.ok, state.playlistId]);

  return (
    <form action={action} className="grid gap-2 md:grid-cols-[1fr_auto]">
      <input
        name="url"
        type="url"
        required
        placeholder="https://www.youtube.com/playlist?list=…"
        aria-label="YouTube playlist URL"
        className={inputCls}
      />
      <button type="submit" disabled={pending} className={`${btnPrimaryCls} disabled:opacity-50`}>
        {pending ? 'Finding lectures…' : 'Add playlist'}
      </button>
      {(state.error || state.message) && (
        <p className={`text-[12px] md:col-span-2 ${state.error ? 'text-red-300' : 'text-green-300'}`}>
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}
