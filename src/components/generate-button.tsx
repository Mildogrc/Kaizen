'use client';

// "Generate flashcards" button: runs schema-rule generation for a course and
// reports what happened inline.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCourseCards } from '@/lib/actions';
import { btnCls } from '@/components/ui';

export function GenerateButton({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const s = await generateCourseCards(courseId);
      const parts: string[] = [];
      if (s.cardsCreated) parts.push(`${s.cardsCreated} flashcards`);
      if (s.practiceCreated) parts.push(`${s.practiceCreated} practice items`);
      let text = parts.length > 0 ? `✓ Created ${parts.join(' + ')}` : 'Nothing new to generate';
      if (s.skippedExisting) text += ` · ${s.skippedExisting} already existed`;
      if (s.ankiSkipped.length) text += ` · left to Anki: ${s.ankiSkipped.join(', ')}`;
      setMessage(text);
      router.refresh();
    });
  };

  return (
    <span className="relative">
      <button onClick={run} disabled={pending} className={`${btnCls} disabled:opacity-50`}>
        {pending ? 'Generating…' : '⚡ Generate cards'}
      </button>
      {message && (
        <span className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-muted shadow-lg">
          {message}
        </span>
      )}
    </span>
  );
}
