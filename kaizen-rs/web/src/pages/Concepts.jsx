import { useNavigate, useSearchParams } from '@solidjs/router';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { post, useApi } from '../lib/api';
import { plural } from '../lib/format';
import { attempt } from '../lib/store';
import { ConceptChip, ConceptLegend, ConceptTree } from '../components/concepts';
import { Icon } from '../components/icons';
import { Card, Empty, Field, Load, Modal, Page, Pills, Section, focusOnMount } from '../components/ui';

function NewConcept(props) {
  const navigate = useNavigate();
  const [subject, setSubject] = createSignal(props.subject ?? props.subjects[0]?.subject ?? '');
  const [newSubject, setNewSubject] = createSignal(props.subjects.length === 0);
  const [title, setTitle] = createSignal('');
  const [summary, setSummary] = createSignal('');
  const [prereqs, setPrereqs] = createSignal([]);
  const [query, setQuery] = createSignal('');
  const inSubject = createMemo(() => props.subjects.find((s) => s.subject === subject())?.concepts ?? []);
  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    return inSubject().filter((c) => prereqs().includes(c.id) || !q || c.title.toLowerCase().includes(q)).slice(0, 24);
  });
  const toggle = (id) => setPrereqs((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async (e) => {
    e.preventDefault();
    const r = await attempt(() => post('/concepts', { subject: subject(), title: title(), summary: summary() || null, prerequisiteIds: prereqs() }));
    if (r) navigate(`/concepts/${r.id}`);
  };
  return (
    <Modal title="New concept" onClose={props.onClose} width="max-w-xl">
      <form onSubmit={save} class="space-y-4">
        <Field label="Subject" hint={newSubject() ? 'A short name in Latin letters, like linalg or pharm. It becomes part of the Anki tag.' : undefined}>
          <Show when={!newSubject()} fallback={
            <div class="flex gap-2">
              <input class="input" required value={subject()} onInput={(e) => setSubject(e.currentTarget.value)} placeholder="linalg" />
              <Show when={props.subjects.length}><button type="button" class="btn" onClick={() => { setNewSubject(false); setSubject(props.subjects[0].subject); }}>Cancel</button></Show>
            </div>
          }>
            <div class="flex flex-wrap items-center gap-1.5">
              <Pills value={subject()} onChange={(s) => { setSubject(s); setPrereqs([]); }} options={props.subjects.map((s) => ({ value: s.subject, label: s.title }))} />
              <button type="button" class="pill" onClick={() => { setNewSubject(true); setSubject(''); setPrereqs([]); }}><Icon name="plus" size={12} /> New subject</button>
            </div>
          </Show>
        </Field>
        <Field label="Concept"><input class="input" required ref={focusOnMount} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Eigenvalues and eigenvectors" /></Field>
        <Field label="In one line (optional)"><input class="input" value={summary()} onInput={(e) => setSummary(e.currentTarget.value)} placeholder="Directions a map only stretches, and by how much." /></Field>
        <Show when={inSubject().length}>
          <Field label={`What you need to know first${prereqs().length ? ` (${prereqs().length} chosen)` : ''}`}>
            <Show when={inSubject().length > 12}><input class="input mb-2" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="Filter" /></Show>
            <div class="flex flex-wrap gap-1.5">
              <For each={shown()}>{(c) => <button type="button" class="pill" aria-pressed={prereqs().includes(c.id)} onClick={() => toggle(c.id)}>{c.title}</button>}</For>
            </div>
          </Field>
        </Show>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn btn-primary">Add concept</button>
        </div>
      </form>
    </Modal>
  );
}

function Starters(props) {
  const [busy, setBusy] = createSignal(null);
  const install = async (s) => {
    setBusy(s.key);
    await attempt(() => post(`/concepts/starters/${s.key}`), (r) => `Added ${plural(r.added, 'concept')} to ${s.title}`);
    setBusy(null);
    props.onInstalled?.(s.subject);
  };
  return (
    <div class="grid gap-3 md:grid-cols-2">
      <For each={props.starters}>
        {(s) => (
          <Card class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="text-[15px] font-semibold">{s.title}</div>
              <p class="mt-0.5 text-[13px] text-muted">{s.description}</p>
              <p class="mt-1 text-[12px] text-muted">{plural(s.concepts, 'concept')}, linked by what you need to know first</p>
            </div>
            <button class={props.primary ? 'btn btn-primary' : 'btn'} disabled={busy() === s.key} onClick={() => install(s)}>Add map</button>
          </Card>
        )}
      </For>
    </div>
  );
}

export default function Concepts() {
  const [params, setParams] = useSearchParams();
  const q = useApi(() => '/concepts');
  return (
    <Load q={q}>
      {(d) => {
        const [adding, setAdding] = createSignal(false);
        const subject = createMemo(() => d.subjects.find((s) => s.subject === params.subject) ?? d.subjects[0]);
        const counts = createMemo(() => {
          const list = subject()?.concepts ?? [];
          return {
            total: list.length,
            covered: list.filter((c) => c.coverage === 'COVERED').length,
            noSource: list.filter((c) => c.sources === 0).length,
            weak: list.filter((c) => c.weak),
          };
        });
        const available = () => d.starters.filter((s) => !s.installed);
        return (
          <Page title="Concepts" glyph="◇" subtitle="Each idea you’re learning, what teaches it, and whether you still remember it."
            actions={<Show when={d.subjects.length}><button class="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> New concept</button></Show>}>
            <Show when={d.subjects.length} fallback={
              <>
                <Empty class="mb-6">
                  <p class="text-[14px] text-text">Start with a map of a subject, or add concepts one at a time.</p>
                  <p class="mt-1">Link videos, chapters and problem sets to each concept. Tag Anki cards <code class="kbd">concept::subject::name</code> and Kaizen shows how well you remember it.</p>
                  <button class="btn mt-4" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add a concept</button>
                </Empty>
                <Section title="Starter maps"><Starters starters={d.starters} primary onInstalled={(s) => setParams({ subject: s })} /></Section>
              </>
            }>
              <Show when={d.subjects.length > 1}>
                <Pills class="mb-4" label="Subject" value={subject().subject} onChange={(s) => setParams({ subject: s })}
                  options={d.subjects.map((s) => ({ value: s.subject, label: s.title }))} />
              </Show>
              <Section title={subject().title}>
                <p class="mb-3 text-[14px]">
                  {counts().covered} of {plural(counts().total, 'concept')} covered
                  <Show when={counts().noSource}><span class="text-muted"> · {counts().noSource} with nothing linked to learn from yet</span></Show>
                </p>
                <Show when={counts().weak.length}>
                  <Card class="mb-3 flex flex-wrap items-center gap-2 border-warn/40 bg-warn-soft/50">
                    <span class="text-[13px] font-medium text-warn">Slipping in your cards:</span>
                    <For each={counts().weak}>{(c) => <ConceptChip id={c.id} title={c.title} coverage={c.coverage} hint={c.rememberingPct != null ? `Remembering ${c.rememberingPct}%` : undefined} />}</For>
                  </Card>
                </Show>
                <div class="mb-2.5"><ConceptLegend /></div>
                <ConceptTree nodes={subject().concepts} edges={subject().edges} layers={subject().layers} />
              </Section>
              <Show when={available().length}>
                <Section title="More starter maps"><Starters starters={available()} onInstalled={(s) => setParams({ subject: s })} /></Section>
              </Show>
            </Show>
            <Show when={adding()}><NewConcept subjects={d.subjects} subject={subject()?.subject} onClose={() => setAdding(false)} /></Show>
          </Page>
        );
      }}
    </Load>
  );
}
