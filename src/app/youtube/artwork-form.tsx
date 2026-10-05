'use client';

import { useActionState } from 'react';
import { btnCls, inputCls } from '@/components/ui';
import { type YouTubeActionState, updateYouTubeArtwork } from './actions';

const initialState: YouTubeActionState = { ok: false };

export function ArtworkForm({ playlistId }: { playlistId: string }) {
  const actionWithId = updateYouTubeArtwork.bind(null, playlistId);
  const [state, action, pending] = useActionState(actionWithId, initialState);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
      <label className="text-[11px] text-muted">
        Upload the image GPT made
        <input name="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className={`${inputCls} mt-1`} />
      </label>
      <label className="text-[11px] text-muted">
        Or paste an image URL
        <input name="imageUrl" type="url" placeholder="https://…" className={`${inputCls} mt-1`} />
      </label>
      <button type="submit" disabled={pending} className={`${btnCls} disabled:opacity-50`}>
        {pending ? 'Saving…' : 'Save artwork'}
      </button>
      {(state.error || state.message) && (
        <p className={`text-[11px] md:col-span-3 ${state.error ? 'text-red-300' : 'text-green-300'}`}>
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}
