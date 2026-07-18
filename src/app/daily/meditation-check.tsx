'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui';
import { setMeditationComplete } from './actions';

export function MeditationCheck({ initialComplete, targetMinutes }: { initialComplete: boolean; targetMinutes: number }) {
  const [complete, setComplete] = useState(initialComplete);
  const [pending, startTransition] = useTransition();
  return <Card className={`flex items-center gap-4 p-3 ${complete ? 'border-green-800/60' : ''}`}>
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${complete ? 'bg-green-950 text-green-300' : 'bg-surface-2 text-muted'}`}>1</span>
    <label className="flex flex-1 cursor-pointer items-center gap-3">
      <input type="checkbox" checked={complete} disabled={pending} onChange={(event) => {
        const checked = event.target.checked;
        setComplete(checked);
        startTransition(async () => setMeditationComplete(checked));
      }} />
      <span><span className="block text-[13px] font-medium">Meditate</span><span className="block text-[11px] text-muted">Complete today’s {targetMinutes}-minute meditation</span></span>
    </label>
    {complete && <span className="text-green-300">✓</span>}
  </Card>;
}
