'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnPrimaryCls } from '@/components/ui';
import { completeMandarinBlueprintLevelAction } from './actions';

export function LevelAction({ level, completed, pushed }: { level: number; completed: boolean; pushed: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (pushed) return null;
  return <div className="mt-3">
    <button className={`${btnPrimaryCls} disabled:opacity-50`} disabled={pending} onClick={() => startTransition(async () => {
      setMessage(null);
      const result = await completeMandarinBlueprintLevelAction(level);
      setMessage(result.ok ? result.message ?? 'Pushed to Anki.' : result.error ?? 'Push failed.');
      router.refresh();
    })}>{pending ? 'Enriching and pushing…' : completed ? 'Retry Anki push' : 'Complete level & push to Anki'}</button>
    {message && <div className={`mt-2 text-[11px] ${message.includes('failed') || message.includes('not reachable') ? 'text-red-300' : 'text-muted'}`}>{message}</div>}
  </div>;
}
