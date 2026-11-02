import { useNavigate } from '@solidjs/router';
import { For, Show, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { post, useApi } from '../lib/api';
import { titleCase } from '../lib/format';
import { toast } from '../lib/store';
import { Icon } from '../components/icons';
import { Card, Field, Load, Page, Pills, Section, Toggle } from '../components/ui';

const blankField = () => ({ name: '', label: '', fieldType: 'TEXT', required: false, description: '', enumText: '', example: '' });

export default function SchemaNew() {
  const navigate = useNavigate();
  const schemas = useApi(() => '/schemas');
  const options = useApi(() => '/import');
  const [form, setForm] = createStore({
    name: '', itemType: '', category: 'CUSTOM', courseMode: 'existing', courseSlug: '', newCourseName: '', target: '', examName: '', targetDate: '',
    description: '', fields: [blankField()], rules: [], srsEnabled: true, completionCriteria: '', llmPrompt: '',
  });
  const [saving, setSaving] = createSignal(false);

  const parseExample = (f) => {
    if (!f.example.trim()) return undefined;
    try { return JSON.parse(f.example); } catch { return f.example; }
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await post('/schemas', {
        name: form.name, itemType: form.itemType, category: form.category, description: form.description,
        courseSlug: form.courseMode === 'existing' ? form.courseSlug || null : null,
        newCourseName: form.courseMode === 'new' ? form.newCourseName : null,
        target: form.target, examName: form.examName, targetDate: form.targetDate,
        fields: form.fields.map((f) => ({
          name: f.name.trim(), label: f.label.trim() || f.name.trim(), fieldType: f.fieldType, required: f.required,
          description: f.description || undefined,
          enumOptions: f.fieldType === 'ENUM' ? f.enumText.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          exampleValue: parseExample(f),
        })),
        flashcardRules: form.rules.filter((r) => r.name && r.front && r.back),
        srsEnabled: form.srsEnabled, completionCriteria: form.completionCriteria, llmPrompt: form.llmPrompt,
      });
      toast('Schema created', 'good');
      navigate(`/schemas/${r.slug}`);
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Load q={schemas}>
      {(s) => (
        <Page title="New content type" back={{ href: '/schemas', label: 'Content types' }} subtitle="Describe what one item of this content looks like. Items are validated against it on import.">
          <div class="mx-auto max-w-3xl">
            <Section title="Basics">
              <Card class="grid gap-3 md:grid-cols-2">
                <Field label="Name"><input class="input" value={form.name} onInput={(e) => setForm('name', e.currentTarget.value)} placeholder="Korean vocabulary" /></Field>
                <Field label="Item type" hint="PascalCase, e.g. KoreanVocabularyItem"><input class="input font-mono" value={form.itemType} onInput={(e) => setForm('itemType', e.currentTarget.value)} /></Field>
                <Field label="Category" class="md:col-span-2"><Pills value={form.category} onChange={(v) => setForm('category', v)} options={s.categories.map((c) => ({ value: c, label: titleCase(c) }))} /></Field>
                <Field label="Description" class="md:col-span-2"><input class="input" value={form.description} onInput={(e) => setForm('description', e.currentTarget.value)} /></Field>
              </Card>
            </Section>
            <Section title="Course">
              <Card class="space-y-3">
                <Pills value={form.courseMode} onChange={(v) => setForm('courseMode', v)} options={[{ value: 'existing', label: 'Existing course' }, { value: 'new', label: 'New course' }, { value: 'none', label: 'No course' }]} />
                <Show when={form.courseMode === 'existing'}>
                  <Pills value={form.courseSlug} onChange={(v) => setForm('courseSlug', v)} options={(options.data()?.courses ?? []).map((c) => ({ value: c.slug, label: c.name }))} />
                </Show>
                <Show when={form.courseMode === 'new'}>
                  <div class="grid gap-3 md:grid-cols-2">
                    <Field label="Course name"><input class="input" value={form.newCourseName} onInput={(e) => setForm('newCourseName', e.currentTarget.value)} placeholder="Korean" /></Field>
                    <Field label="Target (becomes a goal)"><input class="input" value={form.target} onInput={(e) => setForm('target', e.currentTarget.value)} placeholder="Pass TOPIK II" /></Field>
                    <Field label="Exam (optional)"><input class="input" value={form.examName} onInput={(e) => setForm('examName', e.currentTarget.value)} /></Field>
                    <Field label="Target date"><input class="input" type="date" value={form.targetDate} onInput={(e) => setForm('targetDate', e.currentTarget.value)} /></Field>
                  </div>
                </Show>
              </Card>
            </Section>
            <Section title="Fields" actions={<button class="btn btn-sm" onClick={() => setForm('fields', (f) => [...f, blankField()])}><Icon name="plus" size={13} /> Field</button>}>
              <div class="space-y-2.5">
                <For each={form.fields}>
                  {(f, i) => (
                    <Card class="grid gap-3 p-3.5 md:grid-cols-[1fr_1fr_10rem_auto]">
                      <Field label="Name"><input class="input font-mono" value={f.name} onInput={(e) => setForm('fields', i(), 'name', e.currentTarget.value)} placeholder="term" /></Field>
                      <Field label="Label"><input class="input" value={f.label} onInput={(e) => setForm('fields', i(), 'label', e.currentTarget.value)} placeholder="Term" /></Field>
                      <Field label="Type">
                        <select class="input" value={f.fieldType} onChange={(e) => setForm('fields', i(), 'fieldType', e.currentTarget.value)}>
                          <For each={s.fieldTypes}>{(t) => <option value={t}>{titleCase(t)}</option>}</For>
                        </select>
                      </Field>
                      <div class="flex items-end gap-2 pb-1">
                        <Toggle checked={f.required} onChange={(v) => setForm('fields', i(), 'required', v)} label="Required" />
                        <button class="btn btn-ghost btn-sm text-muted" disabled={form.fields.length === 1} onClick={() => setForm('fields', produce((list) => list.splice(i(), 1)))}><Icon name="trash" size={13} /></button>
                      </div>
                      <Field label="Description / AI guidance" class="md:col-span-2"><input class="input" value={f.description} onInput={(e) => setForm('fields', i(), 'description', e.currentTarget.value)} /></Field>
                      <Show when={f.fieldType === 'ENUM'} fallback={<Field label="Example value" class="md:col-span-2"><input class="input" value={f.example} onInput={(e) => setForm('fields', i(), 'example', e.currentTarget.value)} /></Field>}>
                        <Field label="Options (comma separated)" class="md:col-span-2"><input class="input" value={f.enumText} onInput={(e) => setForm('fields', i(), 'enumText', e.currentTarget.value)} /></Field>
                      </Show>
                    </Card>
                  )}
                </For>
              </div>
            </Section>
            <Section title="Flashcards" actions={<button class="btn btn-sm" onClick={() => setForm('rules', (r) => [...r, { name: '', front: '', back: '' }])}><Icon name="plus" size={13} /> Rule</button>}>
              <Card class="space-y-3">
                <Toggle checked={form.srsEnabled} onChange={(v) => setForm('srsEnabled', v)} label="Review generated cards with Kaizen’s SRS" />
                <p class="text-[12px] text-muted">Templates use <code class="font-mono">{'{{fieldName}}'}</code> placeholders, e.g. front <code class="font-mono">{'{{term}}'}</code>, back <code class="font-mono">{'{{meaning}}'}</code>.</p>
                <For each={form.rules}>
                  {(r, i) => (
                    <div class="grid gap-2 md:grid-cols-[10rem_1fr_1fr_auto]">
                      <input class="input" value={r.name} onInput={(e) => setForm('rules', i(), 'name', e.currentTarget.value)} placeholder="Recognition" />
                      <input class="input font-mono" value={r.front} onInput={(e) => setForm('rules', i(), 'front', e.currentTarget.value)} placeholder="{{term}}" />
                      <input class="input font-mono" value={r.back} onInput={(e) => setForm('rules', i(), 'back', e.currentTarget.value)} placeholder="{{meaning}}" />
                      <button class="btn btn-ghost btn-sm text-muted" onClick={() => setForm('rules', produce((list) => list.splice(i(), 1)))}><Icon name="trash" size={13} /></button>
                    </div>
                  )}
                </For>
              </Card>
            </Section>
            <Section title="Guidance">
              <Card class="grid gap-3">
                <Field label="Completion criteria"><input class="input" value={form.completionCriteria} onInput={(e) => setForm('completionCriteria', e.currentTarget.value)} placeholder="When is an item learned?" /></Field>
                <Field label="Extra instructions for the AI"><textarea class="input min-h-20" value={form.llmPrompt} onInput={(e) => setForm('llmPrompt', e.currentTarget.value)} /></Field>
              </Card>
            </Section>
            <button class="btn btn-primary h-10 px-6" disabled={saving() || !form.name || !form.itemType || !form.fields.some((f) => f.name)} onClick={save}>{saving() ? 'Creating…' : 'Create content type'}</button>
          </div>
        </Page>
      )}
    </Load>
  );
}
