'use client';

import { useState } from 'react';
import { btnCls, btnPrimaryCls } from '@/components/ui';

export function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={primary ? btnPrimaryCls : btnCls}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
