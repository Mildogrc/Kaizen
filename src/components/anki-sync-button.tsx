'use client';

import { useState, useTransition } from 'react';
import { runAnkiSync } from '@/lib/actions';
import { btnCls } from '@/components/ui';

export function AnkiSyncButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={`${btnCls} py-1 text-[11px] disabled:opacity-50`}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await runAnkiSync();
              setMessage(result.ok ? `${result.cardsSynced.toLocaleString()} cards synced` : result.error ?? 'Sync failed');
            } catch {
              setMessage('Sync failed; keep Anki open and try again');
            }
          });
        }}
      >
        {pending ? 'Syncing…' : '⟳ Sync Anki'}
      </button>
      {message && <span className="max-w-48 truncate text-[10px] text-muted">{message}</span>}
    </span>
  );
}
