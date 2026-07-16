'use client';

// Step-by-step import: 1) pick an area (course), 2) pick the content type
// within it, 3) grab the LLM prompt (.md) to generate importable JSON,
// 4) paste JSON → validate → preview → save. One decision per step.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { runImport, type ImportPreview } from '@/lib/actions';
import { btnCls, btnPrimaryCls, inputCls } from '@/components/ui';

export interface CourseOption {
  slug: string;
  name: string;
  color: string | null;
}

export interface SchemaOption {
  slug: string;
  name: string;
  itemType: string;
  courseSlug: string | null;
}

export function ImportForm({
  courses,
  schemas,
  initialCourse,
  initialSchema,
}: {
  courses: CourseOption[];
  schemas: SchemaOption[];
  initialCourse: string;
  initialSchema: string;
}) {
  const [courseSlug, setCourseSlug] = useState(initialCourse);
  const [schemaSlug, setSchemaSlug] = useState(initialSchema);
  const [jsonText, setJsonText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const courseSchemas = useMemo(
    () => schemas.filter((s) => s.courseSlug === courseSlug),
    [schemas, courseSlug],
  );
  const selected = schemas.find((s) => s.slug === schemaSlug) ?? null;

  const pickCourse = (slug: string) => {
    setCourseSlug(slug);
    setPreview(null);
    const inCourse = schemas.filter((s) => s.courseSlug === slug);
    setSchemaSlug(inCourse.length === 1 ? inCourse[0].slug : '');
  };

  const copyPrompt = async () => {
    if (!selected) return;
    const res = await fetch(`/schemas/${selected.slug}/prompt`);
    await navigator.clipboard.writeText(await res.text());
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1500);
  };

  const run = (commit: boolean) => {
    if (!schemaSlug || !jsonText.trim()) return;
    startTransition(async () => {
      const result = await runImport({ schemaSlug, jsonText, commit });
      setPreview(result);
      if (commit && result.savedCount) setJsonText('');
    });
  };

  const stepBtn = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
      active
        ? 'border-accent bg-accent/15 text-accent'
        : 'border-line bg-surface-2 text-muted hover:border-accent/40 hover:text-foreground'
    }`;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4 space-y-4">
        {/* Step 1: area */}
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">1 · Where does this content go?</div>
          <div className="flex flex-wrap gap-1.5">
            {courses.map((c) => (
              <button key={c.slug} onClick={() => pickCourse(c.slug)} className={stepBtn(courseSlug === c.slug)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: content type */}
        {courseSlug && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">2 · What kind of content?</div>
            {courseSchemas.length === 0 ? (
              <p className="text-[12px] text-muted">
                No schemas for this course yet — create one in the{' '}
                <Link href="/schemas/new" className="text-accent underline">Schema Designer</Link>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {courseSchemas.map((s) => (
                  <button
                    key={s.slug}
                    onClick={() => { setSchemaSlug(s.slug); setPreview(null); }}
                    className={stepBtn(schemaSlug === s.slug)}
                    title={s.itemType}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: LLM prompt */}
        {selected && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">
              3 · Need the JSON generated? Send this prompt + your source material to an LLM
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/schemas/${selected.slug}/prompt`} download className={btnCls}>
                ⬇ Download prompt (.md)
              </a>
              <button onClick={copyPrompt} className={btnCls}>
                {promptCopied ? '✓ Copied' : '⧉ Copy prompt'}
              </button>
              <Link href={`/schemas/${selected.slug}`} className="text-[12px] text-accent underline">
                view schema
              </Link>
            </div>
          </div>
        )}

        {/* Step 4: paste + validate */}
        {selected && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">4 · Paste the JSON array</div>
            <textarea
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); setPreview(null); }}
              rows={10}
              placeholder='[{"…": "…"}, …]'
              className={`${inputCls} font-mono text-[12px]`}
            />
            <div className="mt-2 flex gap-2">
              <button onClick={() => run(false)} disabled={pending || !jsonText.trim()} className={`${btnCls} disabled:opacity-40`}>
                {pending ? 'Working…' : 'Validate & preview'}
              </button>
              {preview?.ok && preview.validCount > 0 && !preview.savedCount && (
                <button onClick={() => run(true)} disabled={pending} className={btnPrimaryCls}>
                  Save {preview.validCount} valid item{preview.validCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="space-y-3">
          {preview.message && (
            <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-[13px] text-red-300">{preview.message}</div>
          )}
          {preview.savedCount != null && (
            <div className="rounded-md border border-green-900 bg-green-950/40 px-3 py-2 text-[13px] text-green-300">
              ✓ Saved {preview.savedCount} items{preview.errorCount > 0 ? ` (${preview.errorCount} skipped with errors)` : ''}.
            </div>
          )}
          {preview.ok && preview.savedCount == null && (
            <div className="flex gap-4 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
              <span>{preview.total} items parsed</span>
              <span className="text-green-400">{preview.validCount} valid</span>
              <span className={preview.errorCount > 0 ? 'text-red-400' : 'text-muted'}>{preview.errorCount} invalid</span>
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="rounded-lg border border-red-900/50 bg-surface p-3">
              <div className="mb-2 text-[12px] font-semibold text-red-300">Validation errors</div>
              <div className="space-y-1.5">
                {preview.errors.map((e) => (
                  <div key={e.index} className="text-[12px]">
                    <span className="font-mono text-muted">item[{e.index}]</span>
                    <ul className="ml-5 list-disc text-red-300/90">
                      {e.errors.map((msg, i) => (
                        <li key={i}>{msg}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.validSample.length > 0 && preview.savedCount == null && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 text-[12px] font-semibold text-muted">Preview (first {preview.validSample.length} valid items)</div>
              <pre className="max-h-72 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] text-green-300/80">
                {JSON.stringify(preview.validSample.map((v) => v.data), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
