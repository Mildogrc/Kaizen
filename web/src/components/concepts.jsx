// Concepts: the prerequisite tree, concept chips, linked-source rows, and the
// forms that link a video, a page range or a web link to a concept.
import { A } from '@solidjs/router';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { del, patch, post, useApi } from '../lib/api';
import { attempt } from '../lib/store';
import { Icon } from './icons';
import { Field, Modal, Pills, Progress, cx, focusOnMount } from './ui';

export const ROLES = [
  { value: 'INTUITION', label: 'Intuition', hint: 'Builds the picture: a visual explainer, an analogy.' },
  { value: 'LECTURE', label: 'Lecture', hint: 'The standard treatment, as taught in a course.' },
  { value: 'RIGOROUS', label: 'Rigorous', hint: 'Definitions and proofs: a textbook section.' },
  { value: 'PRACTICE', label: 'Practice', hint: 'Problems to work: a problem set, exercises.' },
];
export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label ?? role;

const COVERAGE = {
  COVERED: { label: 'Covered', border: 'color-mix(in srgb, var(--good) 55%, transparent)', bg: 'var(--good-soft)', dot: 'var(--good)', dash: false },
  STARTED: { label: 'Started', border: 'color-mix(in srgb, var(--info) 60%, transparent)', bg: 'var(--info-soft)', dot: 'var(--info)', dash: false },
  NOT_COVERED: { label: 'Not covered yet', border: 'var(--line-strong)', bg: 'var(--surface)', dot: 'var(--faint)', dash: true },
};
export const coverageLabel = (c) => COVERAGE[c]?.label ?? c;

/** "2:10" or "1:02:05" or "130" → seconds; blank → null. */
export function parseClock(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function formatClock(seconds) {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const SOURCE_GLYPH = { video: '▶', book: '❦', link: '↗' };
export const sourceGlyph = (s) => (s.role === 'PRACTICE' && s.kind !== 'video' ? '✎' : SOURCE_GLYPH[s.kind]);

// ------------------------------------------------------------------ tree

const BOX_W = 156;
const BOX_H = 46;
const H_GAP = 14;
const V_GAP = 46;
const PAD = 14;

/**
 * Layered prerequisite tree. Layers come from the server; rows wider than the
 * container wrap so it never scrolls sideways. A dashed edge leaves a concept
 * not covered yet. Nodes link to their concept page.
 */
export function ConceptTree(props) {
  const [width, setWidth] = createSignal(900);
  let container;
  onMount(() => {
    setWidth(container.clientWidth);
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  const byId = createMemo(() => new Map(props.nodes.map((n) => [n.id, n])));
  const perRow = () => Math.max(2, Math.floor((width() - PAD * 2 + H_GAP) / (BOX_W + H_GAP)));
  const layout = createMemo(() => {
    const rows = [];
    for (const layer of props.layers) for (let i = 0; i < layer.length; i += perRow()) rows.push(layer.slice(i, i + perRow()));
    const widest = Math.max(1, ...rows.map((r) => r.length));
    const w = Math.max(width(), widest * BOX_W + (widest - 1) * H_GAP + PAD * 2);
    const pos = new Map();
    rows.forEach((row, r) => {
      const offset = (w - (row.length * BOX_W + (row.length - 1) * H_GAP)) / 2;
      row.forEach((id, i) => pos.set(id, { x: offset + i * (BOX_W + H_GAP), y: PAD + r * (BOX_H + V_GAP) }));
    });
    return { pos, width: w, height: rows.length ? PAD * 2 + rows.length * BOX_H + (rows.length - 1) * V_GAP : 80 };
  });
  const [hover, setHover] = createSignal(null);
  const near = createMemo(() => {
    const id = hover();
    if (!id) return null;
    const set = new Set([id]);
    for (const [a, b] of props.edges) { if (a === id) set.add(b); if (b === id) set.add(a); }
    return set;
  });
  const curve = (a, b) => {
    const x1 = a.x + BOX_W / 2, y1 = a.y + BOX_H, x2 = b.x + BOX_W / 2, y2 = b.y;
    const bend = Math.max(16, Math.min(40, Math.abs(y2 - y1) / 2));
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  };
  return (
    <div ref={container} class="card overflow-x-auto p-0">
      <div class="relative mx-auto" style={{ width: `${layout().width}px`, height: `${layout().height}px` }}>
        <svg width={layout().width} height={layout().height} class="absolute inset-0" aria-hidden="true">
          <For each={props.edges}>
            {([from, to]) => {
              const a = () => layout().pos.get(from);
              const b = () => layout().pos.get(to);
              const gap = () => props.gapEdges && byId().get(from)?.coverage === 'NOT_COVERED';
              const lit = () => near() && near().has(from) && near().has(to) && (from === hover() || to === hover());
              return (
                <Show when={a() && b()}>
                  <path d={curve(a(), b())} fill="none" stroke={lit() ? 'var(--accent)' : 'var(--line-strong)'} stroke-width={lit() ? 1.8 : 1.3}
                    stroke-dasharray={gap() ? '4 4' : undefined} opacity={near() && !lit() ? 0.15 : 0.95} style={{ transition: 'opacity 140ms, stroke 140ms' }} />
                </Show>
              );
            }}
          </For>
        </svg>
        <For each={props.layers.flat()}>
          {(id) => {
            const n = () => byId().get(id);
            const p = () => layout().pos.get(id);
            const s = () => COVERAGE[n()?.coverage] ?? COVERAGE.NOT_COVERED;
            const current = () => id === props.current;
            return (
              <Show when={n() && p()}>
                <A href={`/concepts/${id}`}
                  class="absolute flex flex-col items-center justify-center rounded-lg border px-2 text-center leading-tight transition-[opacity,box-shadow] duration-150 hover:shadow-[0_0_0_2px_var(--accent)]"
                  style={{
                    left: `${p().x}px`, top: `${p().y}px`, width: `${BOX_W}px`, height: `${BOX_H}px`,
                    'border-color': current() ? 'var(--accent)' : s().border, 'border-style': s().dash && !current() ? 'dashed' : 'solid',
                    'border-width': current() ? '2px' : '1px', background: current() ? 'var(--accent-soft)' : s().bg, color: 'var(--text)',
                    opacity: near() && !near().has(id) ? 0.35 : 1,
                  }}
                  title={`${n().title} · ${s().label}`}
                  onMouseEnter={() => setHover(id)} onMouseLeave={() => setHover(null)}>
                  <span class="line-clamp-2 text-[12px] font-medium">{n().title}</span>
                  <Show when={n().weak || current()}>
                    <span class="mt-0.5 text-[11px]" style={{ color: current() ? 'var(--accent-text)' : 'var(--warn)' }}>{current() ? 'this concept' : 'slipping'}</span>
                  </Show>
                </A>
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function ConceptLegend() {
  const box = (c) => <span class="h-3 w-4 rounded-[4px] border" style={{ background: COVERAGE[c].bg, 'border-color': COVERAGE[c].border, 'border-style': COVERAGE[c].dash ? 'dashed' : 'solid' }} />;
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      <span class="flex items-center gap-1.5">{box('COVERED')} covered: finished a linked source</span>
      <span class="flex items-center gap-1.5">{box('STARTED')} started</span>
      <span class="flex items-center gap-1.5">{box('NOT_COVERED')} not covered yet</span>
      <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--line-strong)" stroke-width="1.5" /></svg> needed before</span>
    </div>
  );
}

// ------------------------------------------------------------------ chips

/** A small tag naming a concept; ✓ when covered, dashed when not covered yet. */
export function ConceptChip(props) {
  const covered = () => props.coverage === 'COVERED' || props.finished;
  return (
    <A href={`/concepts/${props.id}`} title={props.hint ?? props.title}
      class={cx('inline-flex h-[22px] max-w-full items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap transition-colors hover:border-line-strong hover:text-text',
        covered() ? 'border-transparent bg-good-soft text-good' : props.coverage === 'NOT_COVERED' ? 'border-dashed border-line-strong text-muted' : 'border-line bg-surface-2 text-muted')}>
      <Show when={covered()}><span aria-hidden="true">✓</span></Show>
      <span class="truncate">{props.title}</span>
    </A>
  );
}

// ------------------------------------------------------------------ sources

/** One linked unit of a source: glyph, unit, source name, range and progress. */
export function SourceItem(props) {
  const s = () => props.source;
  const href = () => (s().kind === 'video' ? `/youtube/${s().playlistId}` : s().kind === 'book' ? `/books/${s().bookId}` : s().url);
  const external = () => s().kind === 'link';
  const [counting, setCounting] = createSignal(false);
  const setDone = (done) => attempt(() => patch(`/concept-sources/${s().id}`, { progressDone: done }));
  return (
    <div class={cx('flex gap-3 px-4 py-3', s().status === 'SUGGESTED' && 'border border-dashed border-line-strong rounded-lg')}>
      <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[13px] text-muted" aria-hidden="true">{sourceGlyph(s())}</span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <a href={href()} target={external() ? '_blank' : undefined} rel={external() ? 'noreferrer' : undefined} class="text-[13px] font-medium hover:text-accent-text">{s().label}</a>
          <Show when={s().range}><span class="tnum text-[12px] text-muted">{s().range}</span></Show>
          <Show when={s().finished && s().status === 'LINKED'}><span class="text-[12px] text-good">✓ done</span></Show>
        </div>
        <div class="truncate text-[12px] text-muted">
          {[s().title, s().author].filter(Boolean).join(' · ')}
          <Show when={s().missing}> · no longer in the playlist</Show>
          <Show when={s().status === 'SUGGESTED'}> · suggested{s().suggestedBy === 'ai' ? ' by AI' : ''}</Show>
        </div>
        <Show when={s().status === 'LINKED' && !s().finished && s().progress.pct > 0}>
          <div class="mt-1.5 flex items-center gap-2">
            <Progress class="max-w-[200px]" value={s().progress.pct} color={s().kind === 'video' ? 'var(--video, var(--video))' : 'var(--accent)'} />
            <span class="tnum text-[11px] text-muted">{s().progress.total ? `${s().progress.done} of ${s().progress.total}` : `${s().progress.pct}%`}</span>
          </div>
        </Show>
        <Show when={s().status === 'LINKED' && s().progress.total && !s().finished}>
          <div class="mt-1.5 flex items-center gap-1.5">
            <Show when={s().progress.pct === 0}><span class="tnum text-[11px] text-muted">0 of {s().progress.total}</span></Show>
            <button class="btn btn-sm" disabled={counting()} onClick={async () => { setCounting(true); await setDone((s().progress.done ?? 0) + 1); setCounting(false); }}>+1 done</button>
          </div>
        </Show>
      </div>
      <div class="flex shrink-0 items-start gap-1">
        <Show when={s().status === 'SUGGESTED'} fallback={
          <button class="btn btn-ghost btn-sm text-muted" title="Unlink" aria-label="Unlink" onClick={() => attempt(() => del(`/concept-sources/${s().id}`))}><Icon name="close" size={13} /></button>
        }>
          <button class="btn btn-sm" onClick={() => attempt(() => patch(`/concept-sources/${s().id}`, { status: 'LINKED' }), 'Linked')}>Link</button>
          <button class="btn btn-ghost btn-sm" onClick={() => attempt(() => patch(`/concept-sources/${s().id}`, { status: 'DISMISSED' }))}>Dismiss</button>
        </Show>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ link form

/**
 * Link one unit of a source to a concept. Either the concept is fixed
 * (`conceptId`, from a concept page) and the learner picks the source, or the
 * source is fixed (`preset`, from a lecture or book: "This explains…") and
 * the learner picks the concept.
 */
export function LinkSourceModal(props) {
  const preset = props.preset;
  const [kind, setKind] = createSignal(preset?.kind ?? 'video');
  const [conceptId, setConceptId] = createSignal(props.conceptId ?? null);
  const [conceptQuery, setConceptQuery] = createSignal('');
  const [playlistId, setPlaylistId] = createSignal(preset?.playlistId ?? '');
  const [videoId, setVideoId] = createSignal(preset?.videoId ?? '');
  const [bookId, setBookId] = createSignal(preset?.bookId ?? '');
  const [url, setUrl] = createSignal('');
  const [label, setLabel] = createSignal('');
  const [role, setRole] = createSignal(props.role ?? 'LECTURE');
  const [start, setStart] = createSignal(preset?.start != null ? formatClock(preset.start) : '');
  const [end, setEnd] = createSignal('');
  const [problems, setProblems] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const concepts = useApi(() => (props.conceptId ? null : '/concepts'));
  const playlists = useApi(() => (!preset && kind() === 'video' ? '/youtube' : null));
  const playlist = useApi(() => (!preset && kind() === 'video' && playlistId() ? `/youtube/${playlistId()}` : null));
  const books = useApi(() => (!preset && kind() === 'book' ? '/books' : null));

  const allConcepts = createMemo(() => (concepts.data()?.subjects ?? []).flatMap((s) => s.concepts.map((c) => ({ ...c, subjectTitle: s.title }))));
  const matches = createMemo(() => {
    const q = conceptQuery().trim().toLowerCase();
    const list = allConcepts().filter((c) => !q || c.title.toLowerCase().includes(q) || c.tag.includes(q));
    return list.slice(0, 8);
  });
  const chosen = () => allConcepts().find((c) => c.id === conceptId());

  const submit = async (e) => {
    e.preventDefault();
    const isVideo = kind() === 'video';
    const parse = isVideo ? parseClock : (t) => (String(t).trim() ? Number(t) : null);
    const rangeStart = parse(start()), rangeEnd = parse(end());
    if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) return attempt(() => Promise.reject(new Error(isVideo ? 'Write times like 2:10 or 1:02:05.' : 'Pages are whole numbers.')));
    if (!conceptId()) return attempt(() => Promise.reject(new Error('Choose the concept this explains.')));
    const target = isVideo ? { playlistId: playlistId(), videoId: videoId() } : kind() === 'book' ? { bookId: bookId() } : { url: url() };
    setBusy(true);
    const r = await attempt(() => post(`/concepts/${conceptId()}/sources`, {
      ...target, role: role(), label: label() || null, rangeStart, rangeEnd,
      progressTotal: role() === 'PRACTICE' && problems() ? Number(problems()) : null,
    }), 'Linked');
    setBusy(false);
    if (r) props.onClose();
  };

  return (
    <Modal title={props.title ?? 'Link a source'} onClose={props.onClose} width="max-w-xl">
      <form onSubmit={submit} class="space-y-4">
        <Show when={!props.conceptId}>
          <Field label="Which concept does this explain?">
            <Show when={chosen()} fallback={
              <>
                <input class="input" ref={focusOnMount} value={conceptQuery()} onInput={(e) => setConceptQuery(e.currentTarget.value)} placeholder="Search your concepts" />
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <For each={matches()} fallback={<span class="text-[12px] text-muted">{concepts.loading() ? 'Loading…' : <>No matches. <A href="/concepts" class="text-accent-text">Add concepts</A> first.</>}</span>}>
                    {(c) => <button type="button" class="pill" onClick={() => setConceptId(c.id)} title={c.subjectTitle}>{c.title}</button>}
                  </For>
                </div>
              </>
            }>
              <div class="flex items-center gap-2">
                <span class="pill" aria-pressed="true">{chosen().title}</span>
                <button type="button" class="btn btn-ghost btn-sm" onClick={() => setConceptId(null)}>Change</button>
              </div>
            </Show>
          </Field>
        </Show>

        <Show when={!preset}>
          <Field label="What kind of source?">
            <Pills value={kind()} onChange={setKind} options={[{ value: 'video', label: '▶ Video' }, { value: 'book', label: '❦ Book' }, { value: 'link', label: '↗ Web link' }]} />
          </Field>
          <Show when={kind() === 'video'}>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label="Playlist">
                <select class="input" value={playlistId()} onChange={(e) => { setPlaylistId(e.currentTarget.value); setVideoId(''); }} required>
                  <option value="">Choose…</option>
                  <For each={playlists.data()?.playlists ?? []}>{(p) => <option value={p.id}>{p.title}</option>}</For>
                </select>
              </Field>
              <Field label="Video">
                <select class="input" value={videoId()} onChange={(e) => setVideoId(e.currentTarget.value)} required disabled={!playlistId()}>
                  <option value="">Choose…</option>
                  <For each={playlist.data()?.items ?? []}>{(i) => <option value={i.videoId}>{i.position + 1}. {i.title}</option>}</For>
                </select>
              </Field>
            </div>
          </Show>
          <Show when={kind() === 'book'}>
            <Field label="Book">
              <select class="input" value={bookId()} onChange={(e) => setBookId(e.currentTarget.value)} required>
                <option value="">Choose…</option>
                <For each={books.data()?.books ?? []}>{(b) => <option value={b.id}>{b.title}{b.author ? ` · ${b.author}` : ''}</option>}</For>
              </select>
            </Field>
          </Show>
          <Show when={kind() === 'link'}>
            <Field label="Link"><input class="input" type="url" required value={url()} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://…" /></Field>
          </Show>
        </Show>
        <Show when={preset}>
          <div class="rounded-lg bg-surface-2 px-3 py-2 text-[13px]"><span class="text-muted">{SOURCE_GLYPH[preset.kind]}</span> {preset.label}</div>
        </Show>

        <Field label="Role">
          <Pills value={role()} onChange={setRole} options={ROLES.map((r) => ({ value: r.value, label: r.label, title: r.hint }))} />
        </Field>

        <Show when={kind() !== 'link'}>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label={kind() === 'video' ? 'From (optional)' : 'From page (optional)'}>
              <input class="input tnum" inputmode="numeric" value={start()} onInput={(e) => setStart(e.currentTarget.value)} placeholder={kind() === 'video' ? 'e.g. 2:10' : 'e.g. 133'} />
            </Field>
            <Field label={kind() === 'video' ? 'To (optional)' : 'To page (optional)'}>
              <input class="input tnum" inputmode="numeric" value={end()} onInput={(e) => setEnd(e.currentTarget.value)} placeholder={kind() === 'video' ? 'e.g. 9:30' : 'e.g. 140'} />
            </Field>
          </div>
        </Show>
        <div class="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Name this part (optional)" hint={kind() === 'book' ? 'Like “§5A” or “Problem set 6.1”.' : kind() === 'video' ? 'Defaults to the video title.' : 'Defaults to the site name.'}>
            <input class="input" value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
          </Field>
          <Show when={role() === 'PRACTICE'}>
            <Field label="Problems"><input class="input tnum" type="number" min="1" value={problems()} onInput={(e) => setProblems(e.currentTarget.value)} placeholder="12" /></Field>
          </Show>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn btn-primary" disabled={busy()}>Link</button>
        </div>
      </form>
    </Modal>
  );
}

/** Concept chips for a playlist (by video id) or a book. */
export function useConceptLinks(query) {
  return useApi(() => (query() ? `/concept-links?${query()}` : null));
}
