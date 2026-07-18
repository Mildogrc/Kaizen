'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnPrimaryCls, inputCls } from '@/components/ui';
import { syncCodeforcesAction } from './actions';

export function CodeforcesConnectForm({ initialValue = '' }: { initialValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await syncCodeforcesAction(value);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setValue(result.handle);
      setMessage(`Synced ${result.submissions.toLocaleString()} submissions and ${result.contests} rated contests.`);
      router.push(`/codeforces?profile=${result.profileId}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 md:flex-row md:items-center">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://codeforces.com/profile/handle"
        className={inputCls}
        aria-label="Codeforces profile URL or handle"
        required
      />
      <button type="submit" disabled={pending} className={`${btnPrimaryCls} shrink-0 disabled:opacity-50`}>
        {pending ? 'Syncing… about 5 seconds' : 'Connect / sync'}
      </button>
      {message && <span className="text-[12px] text-muted md:max-w-sm">{message}</span>}
    </form>
  );
}
