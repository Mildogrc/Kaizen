'use client';

// Migaku import + Anki pull controls. Accepts a pasted export or a
// .json/.csv/.txt file (read client-side), normalizes server-side.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importMigakuWordsAction, refreshAnkiWordsAction } from '@/lib/actions';
import { Card, Section, btnCls, btnPrimaryCls, inputCls } from '@/components/ui';

export function WordsImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState<'ja' | 'zh'>('ja');
  const [text, setText] = useState('');
  const [includeLearning, setIncludeLearning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, startImport] = useTransition();
  const [pulling, startPull] = useTransition();

  const pill = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-[12px] transition-colors cursor-pointer ${
      active
        ? 'border-accent bg-accent/15 text-accent'
        : 'border-line bg-surface-2 text-muted hover:border-accent/40 hover:text-foreground'
    }`;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setMessage(`Loaded ${file.name}`);
  };

  const runImport = () => {
    if (!text.trim()) return;
    setMessage(null);
    startImport(async () => {
      const s = await importMigakuWordsAction({ language, text, includeLearning });
      setMessage(
        `✓ ${s.added} added · ${s.duplicates} already known · ${s.unparseable} unparseable` +
          (s.filteredOut ? ` · ${s.filteredOut} filtered by status` : '') +
          ` (from ${s.parsed} entries)`,
      );
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    });
  };

  const runAnkiPull = () => {
    setMessage(null);
    startPull(async () => {
      const s = await refreshAnkiWordsAction();
      setMessage(`✓ Anki: ${s.added} words added, ${s.removed} pruned (from ${s.scanned} mature cards, ${s.unparseable} unparseable)`);
      router.refresh();
    });
  };

  return (
    <Section
      title="Import"
      actions={
        <button onClick={runAnkiPull} disabled={pulling} className={`${btnCls} disabled:opacity-50`}>
          {pulling ? 'Pulling…' : '★ Pull mature words from Anki'}
        </button>
      }
    >
      <Card className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-muted">Migaku export →</span>
          <button onClick={() => setLanguage('ja')} className={pill(language === 'ja')}>Japanese</button>
          <button onClick={() => setLanguage('zh')} className={pill(language === 'zh')}>Chinese</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-[12px] text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface-2 file:px-2.5 file:py-1 file:text-[12px] file:text-muted"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={includeLearning} onChange={(e) => setIncludeLearning(e.target.checked)} />
            include “Learning” words
          </label>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'…or paste the export here (JSON / CSV / one word per line)'}
          className={`${inputCls} font-mono text-[12px]`}
        />
        <div className="flex items-center gap-3">
          <button onClick={runImport} disabled={importing || !text.trim()} className={`${btnPrimaryCls} disabled:opacity-40`}>
            {importing ? 'Importing… (lemmatizing)' : 'Import words'}
          </button>
          {message && <span className="text-[12px] text-muted">{message}</span>}
        </div>
      </Card>
    </Section>
  );
}
