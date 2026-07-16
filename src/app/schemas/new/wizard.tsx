'use client';

// Guided course/schema creation. One dense form walking through the ten
// questions: name, category, target, exam, date, content type, fields,
// practice modes, spaced repetition, completion.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSchemaWithCourse } from '@/lib/actions';
import { FIELD_TYPES, type FieldDef, type FieldTypeName } from '@/lib/schema-types';
import { btnCls, btnPrimaryCls, inputCls } from '@/components/ui';

const CATEGORIES = ['LANGUAGE', 'MATH', 'CERTIFICATION', 'BOOK', 'SKILL', 'CUSTOM'];
const PRACTICE_MODES = [
  'flashcard', 'cloze', 'recognition', 'production', 'multiple choice', 'free recall',
  'fill in the blank', 'typing drill', 'matching', 'ordering', 'proof reconstruction',
  'problem solving', 'mistake review',
];

interface EditableField extends FieldDef {
  _key: number;
  enumText?: string; // comma-separated editor state for ENUM options
}

let keyCounter = 1;

function emptyField(): EditableField {
  return { _key: keyCounter++, name: '', label: '', fieldType: 'TEXT', required: false };
}

export function NewSchemaWizard({ courses }: { courses: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [courseMode, setCourseMode] = useState<'existing' | 'new'>('new');
  const [courseSlug, setCourseSlug] = useState('');
  const [newCourseName, setNewCourseName] = useState('');
  const [category, setCategory] = useState('CUSTOM');
  const [target, setTarget] = useState('');
  const [examName, setExamName] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [name, setName] = useState('');
  const [itemType, setItemType] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<EditableField[]>([emptyField()]);
  const [practiceModes, setPracticeModes] = useState<string[]>(['flashcard']);
  const [srsEnabled, setSrsEnabled] = useState(true);
  const [completionCriteria, setCompletionCriteria] = useState('');
  const [llmPrompt, setLlmPrompt] = useState('');

  const updateField = (key: number, patch: Partial<EditableField>) =>
    setFields((prev) => prev.map((f) => (f._key === key ? { ...f, ...patch } : f)));

  const submit = () => {
    setError(null);
    if (!name.trim() || !itemType.trim()) {
      setError('Schema name and item type are required.');
      return;
    }
    const cleanFields = fields
      .filter((f) => f.name.trim())
      .map((f) => ({
        name: f.name.trim(),
        label: f.label.trim() || f.name.trim(),
        description: f.description,
        fieldType: f.fieldType,
        required: f.required,
        enumOptions:
          f.fieldType === 'ENUM' && f.enumText
            ? f.enumText.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
        exampleValue: f.exampleValue,
        llmInstructions: f.llmInstructions,
      }));
    if (cleanFields.length === 0) {
      setError('Define at least one field.');
      return;
    }
    startTransition(async () => {
      try {
        const result = await createSchemaWithCourse({
          name: name.trim(),
          itemType: itemType.trim(),
          category,
          courseSlug: courseMode === 'existing' ? courseSlug || undefined : undefined,
          newCourseName: courseMode === 'new' ? newCourseName.trim() || undefined : undefined,
          description: description.trim() || undefined,
          target: target.trim() || undefined,
          examName: examName.trim() || undefined,
          targetDate: targetDate || undefined,
          fields: cleanFields,
          practiceModes,
          srsEnabled,
          completionCriteria: completionCriteria.trim() || undefined,
          llmPrompt: llmPrompt.trim() || undefined,
        });
        router.push(`/schemas/${result.slug}`);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const q = (n: number, title: string) => (
    <div className="mb-1.5 text-[13px] font-semibold">
      <span className="mr-1.5 text-muted">{n}.</span>{title}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div className="rounded-lg border border-line bg-surface p-4">
        {q(1, 'What course does this belong to?')}
        <div className="mb-2 flex gap-3 text-[12px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={courseMode === 'new'} onChange={() => setCourseMode('new')} /> new course
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={courseMode === 'existing'} onChange={() => setCourseMode('existing')} /> existing course
          </label>
        </div>
        {courseMode === 'new' ? (
          <input value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} placeholder="Course name, e.g. Korean, Chess, Coding Interview Prep" className={inputCls} />
        ) : (
          <select value={courseSlug} onChange={(e) => setCourseSlug(e.target.value)} className={inputCls}>
            <option value="">— pick a course —</option>
            {courses.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        {q(2, 'What category is it?')}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={`rounded-md border px-2.5 py-1 text-[12px] cursor-pointer ${category === c ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-2 text-muted hover:text-foreground'}`}>
              {c.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        {q(3, 'What is the target? Is there an exam or target date? (4, 5)')}
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder='Target, e.g. "Pass TOPIK II" or "Solve 150 LeetCode mediums"' className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="Exam name (optional)" className={inputCls} />
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
        {q(6, 'What content type does this schema define?')}
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schema name, e.g. Korean Vocabulary" className={inputCls} />
          <input value={itemType} onChange={(e) => setItemType(e.target.value)} placeholder="Item type, e.g. KoreanVocabularyItem" className={inputCls} />
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line description" className={inputCls} />
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        {q(7, 'What fields should each content item have?')}
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f._key} className="rounded-md border border-line bg-surface-2/50 p-2.5">
              <div className="grid grid-cols-[1fr_1fr_130px_auto_auto] items-center gap-2">
                <input value={f.name} onChange={(e) => updateField(f._key, { name: e.target.value })} placeholder="field_name" className={`${inputCls} font-mono`} />
                <input value={f.label} onChange={(e) => updateField(f._key, { label: e.target.value })} placeholder="Display label" className={inputCls} />
                <select value={f.fieldType} onChange={(e) => updateField(f._key, { fieldType: e.target.value as FieldTypeName })} className={inputCls}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t.toLowerCase().replace('_', ' ')}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer">
                  <input type="checkbox" checked={f.required ?? false} onChange={(e) => updateField(f._key, { required: e.target.checked })} /> req
                </label>
                <button onClick={() => setFields((prev) => prev.filter((x) => x._key !== f._key))} className="text-[12px] text-muted hover:text-red-400 cursor-pointer" title="Remove field">✕</button>
              </div>
              {f.fieldType === 'ENUM' && (
                <input value={f.enumText ?? ''} onChange={(e) => updateField(f._key, { enumText: e.target.value })} placeholder="Enum options, comma-separated" className={`${inputCls} mt-2`} />
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input value={(f.exampleValue as string) ?? ''} onChange={(e) => updateField(f._key, { exampleValue: e.target.value || undefined })} placeholder="Example value" className={inputCls} />
                <input value={f.llmInstructions ?? ''} onChange={(e) => updateField(f._key, { llmInstructions: e.target.value || undefined })} placeholder="LLM generation instructions" className={inputCls} />
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => setFields((prev) => [...prev, emptyField()])} className={`${btnCls} mt-2`}>+ Add field</button>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        {q(8, 'What practice modes should be generated?')}
        <div className="flex flex-wrap gap-1.5">
          {PRACTICE_MODES.map((m) => (
            <button
              key={m}
              onClick={() => setPracticeModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
              className={`rounded-md border px-2.5 py-1 text-[12px] cursor-pointer ${practiceModes.includes(m) ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-2 text-muted hover:text-foreground'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        {q(9, 'Should items be reviewed with spaced repetition?')}
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input type="checkbox" checked={srsEnabled} onChange={(e) => setSrsEnabled(e.target.checked)} />
          Yes — schedule generated cards with the SM-2 scheduler
        </label>
        {q(10, 'What does completion mean?')}
        <input value={completionCriteria} onChange={(e) => setCompletionCriteria(e.target.value)} placeholder='e.g. "All 2,000 items mature" or "Mock exam ≥ 80%"' className={inputCls} />
        <div>
          <div className="mb-1 text-[12px] text-muted">LLM generation prompt (optional — used in the Course Addition Contract)</div>
          <textarea value={llmPrompt} onChange={(e) => setLlmPrompt(e.target.value)} rows={2} placeholder="Extra guidance for an LLM generating items against this schema" className={inputCls} />
        </div>
      </div>

      {error && <div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-[13px] text-red-300">{error}</div>}

      <button onClick={submit} disabled={pending} className={`${btnPrimaryCls} disabled:opacity-50`}>
        {pending ? 'Creating…' : 'Create course schema'}
      </button>
    </div>
  );
}
