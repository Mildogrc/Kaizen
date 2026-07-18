'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnPrimaryCls, inputCls } from '@/components/ui';
import { importGrammarLessonResponseAction } from './actions';

export function LessonResponseForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      setMessage(null);
      startTransition(async () => {
        const result = await importGrammarLessonResponseAction(input);
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setInput('');
        setMessage(`Updated ${result.updated} grammar points${result.passageCreated ? ' and added the reading passage' : ''}.`);
        router.refresh();
      });
    }}>
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className={`${inputCls} min-h-48 font-mono text-[11px]`}
        placeholder='Paste the final {"lessonId": ...} JSON object from the tutor'
        required
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${btnPrimaryCls} disabled:opacity-50`}>
          {pending ? 'Validating…' : 'Import lesson results'}
        </button>
        {message && <span className="text-[12px] text-muted">{message}</span>}
      </div>
    </form>
  );
}
