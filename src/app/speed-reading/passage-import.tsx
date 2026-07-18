'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { btnCls, btnPrimaryCls, inputCls } from '@/components/ui';
import { buildSpeedReadingPrompt } from '@/lib/speed-reading';
import { importSpeedReadingPassageAction } from './actions';

export function PassageImport() {
  const router = useRouter();
  const [category, setCategory] = useState('science and history');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [targetWords, setTargetWords] = useState(450);
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const prompt = useMemo(() => buildSpeedReadingPrompt({ category, difficulty, targetWords }), [category, difficulty, targetWords]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-muted">Topic category<input className={`${inputCls} mt-1`} value={category} onChange={(event) => setCategory(event.target.value)} /></label>
          <label className="text-[11px] text-muted">Difficulty<select className={`${inputCls} mt-1`} value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option>beginner</option><option>intermediate</option><option>advanced</option></select></label>
          <label className="text-[11px] text-muted">Approx. words<input className={`${inputCls} mt-1`} type="number" min={150} max={1500} step={50} value={targetWords} onChange={(event) => setTargetWords(Number(event.target.value))} /></label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className={btnPrimaryCls} onClick={async () => {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>{copied ? '✓ Copied' : '⧉ Copy generation prompt'}</button>
          <span className="text-[11px] text-muted">Prompt preview</span>
        </div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[10px] leading-4 text-muted">{prompt}</pre>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await importSpeedReadingPassageAction(input);
          if (!result.ok) {
            setMessage(result.error);
            return;
          }
          setInput('');
          setMessage(`Imported “${result.title}”.`);
          router.refresh();
        });
      }}>
        <label className="text-[11px] text-muted">Paste the LLM&apos;s JSON object</label>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} className={`${inputCls} mt-1 min-h-48 font-mono text-[11px]`} placeholder='{"title":"...","text":"...","questions":[...]}' required />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={`${btnCls} disabled:opacity-50`}>{pending ? 'Validating…' : 'Import passage'}</button>
          {message && <span className="text-[12px] text-muted">{message}</span>}
        </div>
      </form>
    </div>
  );
}
