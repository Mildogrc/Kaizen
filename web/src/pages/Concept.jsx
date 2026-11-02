import { ai } from '../lib/ai';
import { A, useNavigate, useParams } from '@solidjs/router';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { del, patch, post, useApi } from '../lib/api';
import { date, plural } from '../lib/format';
import { attempt } from '../lib/store';
import { ConceptLegend, ConceptTree, LinkSourceModal, SourceItem, coverageLabel, roleLabel } from '../components/concepts';
import { Icon } from '../components/icons';
import { Badge, Card, CopyButton, Field, Load, Modal, Page, Section, focusOnMount } from '../components/ui';

function EditConcept(props) {
  const [title, setTitle] = createSignal(props.concept.title);
  const [summary, setSummary] = createSignal(props.concept.summary ?? '');
  const save = async (e) => {
    e.preventDefault();
    if (await attempt(() => patch(`/concepts/${props.concept.id}`, { title: title(), summary: summary() }))) props.onClose();
  };
  return (
    <Modal title="Edit concept" onClose={props.onClose}>
      <form onSubmit={save} class="space-y-4">
        <Field label="Concept"><input class="input" required value={title()} onInput={(e) => setTitle(e.currentTarget.value)} /></Field>
        <Field label="In one line"><input class="input" value={summary()} onInput={(e) => setSummary(e.currentTarget.value)} /></Field>
        <p class="text-[12px] text-muted">The Anki tag stays <code class="kbd">{props.concept.tag}</code> so your tagged cards keep matching.</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function AddPrerequisite(props) {
  const q = useApi(() => '/concepts');
  const [query, setQuery] = createSignal('');
  const options = createMemo(() => {
    const subject = q.data()?.subjects.find((s) => s.subject === props.concept.subject);
    const taken = new Set([props.concept.id, ...props.existing]);
    const term = query().trim().toLowerCase();
    return (subject?.concepts ?? []).filter((c) => !taken.has(c.id) && (!term || c.title.toLowerCase().includes(term)));
  });
  const add = async (id) => {
    if (await attempt(() => post(`/concepts/${props.concept.id}/prerequisites`, { conceptId: id }))) props.onClose();
  };
  return (
    <Modal title={`What do you need before ${props.concept.title}?`} onClose={props.onClose}>
      <input class="input mb-3" ref={focusOnMount} value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="Filter concepts" />
      <div class="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto">
        <For each={options()} fallback={<span class="text-[13px] text-muted">{q.loading() ? 'Loading…' : 'No other concepts in this subject.'}</span>}>
          {(c) => <button class="pill" onClick={() => add(c.id)}>{c.title}</button>}
        </For>
      </div>
    </Modal>
  );
}

/** One number, the noun it counts, and what it means. */
function Metric(props) {
  return (
    <div>
      <div class="flex items-baseline gap-1.5">
        <span class="tnum text-[22px] font-semibold leading-tight">{props.value}</span>
        <span class="text-[13px] text-muted">{props.noun}</span>
      </div>
      <Show when={props.meaning}><div class="mt-0.5 text-[12px] text-muted">{props.meaning}</div></Show>
    </div>
  );
}

function Memory(props) {
  const m = () => props.memory;
  const trend = () => {
    if (m().rememberingPct == null || m().previousPct == null) return null;
    const diff = m().rememberingPct - m().previousPct;
    return diff === 0 ? 'same as the month before' : `${diff > 0 ? 'up' : 'down'} from ${m().previousPct}% the month before`;
  };
  const due = () => {
    if (!m().nextDue) return null;
    const days = Math.round((new Date(m().nextDue) - Date.now()) / 86400000);
    return days <= 0 ? 'due now' : days === 1 ? 'tomorrow' : date(m().nextDue, { month: 'short', day: 'numeric' });
  };
  return (
    <Card>
      <Show when={m().cards} fallback={
        <div class="text-[13px]">
          <p class="font-medium">No Anki cards for this concept yet</p>
          <p class="mt-1 text-muted">Add the tag below to the notes that test it, then sync Anki. Kaizen will show how well you remember it.</p>
        </div>
      }>
        <div class="grid grid-cols-2 gap-4">
          <Show when={m().rememberingPct != null} fallback={<Metric value={m().cards} noun={m().cards === 1 ? 'card' : 'cards'} meaning="no reviews in the last 30 days" />}>
            <Metric value={`${m().rememberingPct}%`} noun="remembered" meaning={trend() ?? `over ${plural(m().reviews30d, 'review')} this month`} />
          </Show>
          <Show when={due()}>
            <Metric value={due()} noun="" meaning={`next review · ${plural(m().cards, 'card')}`} />
          </Show>
        </div>
        <Show when={m().missed7d}>
          <p class="mt-3 text-[12px] text-warn">Missed {plural(m().missed7d, 'time')} in the last 7 days</p>
        </Show>
      </Show>
      <div class="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <code class="kbd min-w-0 truncate">{props.tag}</code>
        <CopyButton small text={props.tag} label="Copy tag" />
      </div>
    </Card>
  );
}

export default function Concept() {
  const params = useParams();
  const navigate = useNavigate();
  const q = useApi(() => `/concepts/${params.id}`);
  return (
    <Load q={q}>
      {(d) => {
        const [linking, setLinking] = createSignal(null);
        const [editing, setEditing] = createSignal(false);
        const [addingPrereq, setAddingPrereq] = createSignal(false);
        const c = () => d.concept;
        const linkedCount = () => d.sources.linked.reduce((n, g) => n + g.sources.length, 0);
        const remove = async () => {
          if (!confirm(`Delete “${c().title}” and its links? Your Anki cards are not touched.`)) return;
          if (await attempt(() => del(`/concepts/${c().id}`))) navigate(`/concepts?subject=${c().subject}`);
        };
        return (
          <Page title={c().title} back={{ href: `/concepts?subject=${c().subject}`, label: c().course?.title ?? 'Concepts' }} subtitle={c().summary}
            actions={<>
              <Badge tone={c().coverage === 'COVERED' ? 'good' : c().coverage === 'STARTED' ? 'info' : 'neutral'}>{c().coverage === 'COVERED' ? '✓ ' : ''}{coverageLabel(c().coverage)}</Badge>
              <button class="btn" onClick={() => ai.ask({ kind: 'concept', ref: c().id, title: c().title, resume: true, prompt: `Help me understand "${c().title}"${c().summary ? ` (${c().summary})` : ''}. Sources I have linked: ${d.sources.linked.flatMap((g) => g.sources.map((x) => x.title ?? x.label)).filter(Boolean).join('; ') || 'none yet'}. Start with the core idea and what it depends on, then let me ask questions.` })}><Icon name="sparkle" size={14} /> Ask about this</button>
              <button class="btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Edit</button>
              <button class="btn btn-danger" onClick={remove} aria-label="Delete concept"><Icon name="trash" size={14} /></button>
            </>}>
            <Show when={d.rewatch}>
              {(r) => (
                <Card class="mb-5 flex flex-wrap items-center justify-between gap-3 border-warn/40 bg-warn-soft/60">
                  <div class="min-w-0 text-[13px]">
                    <p class="font-medium text-warn">
                      {d.memory.missed7d >= 3 ? `You missed these cards ${d.memory.missed7d} times this week.` : `You’re remembering ${d.memory.rememberingPct}% of these cards.`}
                    </p>
                    <p class="mt-0.5">Go back over <span class="font-medium">{r().label}</span>{r().range ? ` (${r().range})` : ''} before your next review.</p>
                  </div>
                  <a class="btn" href={r().kind === 'video' ? `/youtube/${r().playlistId}` : r().kind === 'book' ? `/books/${r().bookId}` : r().url}
                    target={r().kind === 'link' ? '_blank' : undefined} rel="noreferrer">
                    {r().kind === 'video' ? <><Icon name="play" size={14} /> Rewatch</> : 'Open'}
                  </a>
                </Card>
              )}
            </Show>

            <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <Section title="Learn it from" actions={<button class={linkedCount() ? 'btn btn-sm' : 'btn btn-primary btn-sm'} onClick={() => setLinking('LECTURE')}><Icon name="plus" size={13} /> Link a source</button>}>
                <Show when={linkedCount() || d.sources.suggested.length} fallback={
                  <div class="rounded-xl border border-dashed border-line-strong px-5 py-6 text-[13px] text-muted">
                    <p>Nothing linked yet. Link the part of a video, chapter or problem set that explains this, so you can find it again when the cards slip.</p>
                    <div class="mt-3 flex flex-wrap gap-1.5">
                      <For each={['INTUITION', 'LECTURE', 'RIGOROUS', 'PRACTICE']}>{(role) => <button class="pill" onClick={() => setLinking(role)}>+ {roleLabel(role)}</button>}</For>
                    </div>
                  </div>
                }>
                  <Card pad={false}>
                    <For each={d.sources.linked}>
                      {(g) => (
                        <div class="border-b border-line last:border-b-0">
                          <div class="px-4 pt-3 text-[12px] font-semibold uppercase tracking-wider text-muted">{roleLabel(g.role)}</div>
                          <For each={g.sources}>{(s) => <SourceItem source={s} />}</For>
                        </div>
                      )}
                    </For>
                    <Show when={d.sources.suggested.length}>
                      <div class="p-3">
                        <div class="px-1 pb-2 text-[12px] text-muted">Suggested · not counted until you link them</div>
                        <div class="space-y-2"><For each={d.sources.suggested}>{(s) => <SourceItem source={s} />}</For></div>
                      </div>
                    </Show>
                  </Card>
                </Show>
              </Section>

              <Section title="Your cards">
                <Memory memory={d.memory} tag={c().tag} />
              </Section>
            </div>

            <Section title="Where it sits" actions={<button class="btn btn-sm" onClick={() => setAddingPrereq(true)}><Icon name="plus" size={13} /> Needs first</button>}>
              <div class="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="text-muted">Needs first:</span>
                  <For each={d.prerequisites} fallback={<span class="text-muted">nothing</span>}>
                    {(p) => (
                      <span class="inline-flex h-[24px] items-center gap-1 rounded-full border border-line bg-surface-2 pl-2 pr-1 text-[12px]">
                        <A href={`/concepts/${p.id}`} class="hover:text-accent-text">{p.title}</A>
                        <button class="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-text" aria-label={`Remove ${p.title} as a prerequisite`}
                          onClick={() => attempt(() => del(`/concepts/${c().id}/prerequisites/${p.id}`))}><Icon name="close" size={11} /></button>
                      </span>
                    )}
                  </For>
                </div>
                <Show when={d.unlocks.length}>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-muted">Leads to:</span>
                    <For each={d.unlocks}>{(u) => <A href={`/concepts/${u.id}`} class="text-[12px] text-accent-text hover:underline">{u.title}</A>}</For>
                  </div>
                </Show>
              </div>
              <Show when={d.map.nodes.length > 1}>
                <div class="mb-2.5"><ConceptLegend /></div>
                <ConceptTree nodes={d.map.nodes} edges={d.map.edges} layers={d.map.layers} current={c().id} gapEdges />
              </Show>
            </Section>

            <Show when={linking()}><LinkSourceModal conceptId={c().id} role={linking()} title={`Link a source to ${c().title}`} onClose={() => setLinking(null)} /></Show>
            <Show when={editing()}><EditConcept concept={c()} onClose={() => setEditing(false)} /></Show>
            <Show when={addingPrereq()}><AddPrerequisite concept={c()} existing={d.prerequisites.map((p) => p.id)} onClose={() => setAddingPrereq(false)} /></Show>
          </Page>
        );
      }}
    </Load>
  );
}
