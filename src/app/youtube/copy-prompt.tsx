'use client';

import { useState } from 'react';
import { btnCls } from '@/components/ui';

export function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <button type="button" onClick={copy} className={btnCls}>{copied ? 'Copied' : 'Copy for GPT'}</button>;
}
