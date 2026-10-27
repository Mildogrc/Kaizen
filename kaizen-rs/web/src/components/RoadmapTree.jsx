// Layered DAG view of the math roadmap. Rows come from the server
// (longest-prerequisite depth, barycenter-ordered to reduce crossings); rows
// wider than the container wrap downward so the tree never scrolls sideways.
// Edges: solid = prerequisite, dashed amber = application. Hovering a node
// for a moment traces its full prerequisite chain; clicking cycles status.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

const BOX_W = 152;
const BOX_H = 48;
const H_GAP = 14;
const V_GAP = 54;
const PAD = 14;
const HOVER_DELAY_MS = 350;

const STATUS_STYLE = {
  NOT_STARTED: { border: 'var(--line-strong)', bg: 'var(--surface-2)', text: 'var(--muted)', dot: 'var(--faint)' },
  IN_PROGRESS: { border: 'color-mix(in srgb, var(--info) 60%, transparent)', bg: 'var(--info-soft)', text: 'var(--text)', dot: 'var(--info)' },
  COMPLETED: { border: 'color-mix(in srgb, var(--good) 55%, transparent)', bg: 'var(--good-soft)', text: 'var(--text)', dot: 'var(--good)' },
};
const READY_STYLE = { border: 'var(--accent)', bg: 'var(--accent-soft)', text: 'var(--text)', dot: 'var(--accent)' };

export function RoadmapTree(props) {
  const [width, setWidth] = createSignal(1000);
  let container;
  onMount(() => {
    setWidth(container.clientWidth);
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    observer.observe(container);
    onCleanup(() => observer.disconnect());
  });
  const perRow = () => Math.max(2, Math.floor((width() - PAD * 2 + H_GAP) / (BOX_W + H_GAP)));
  const byId = createMemo(() => new Map(props.nodes.map((n) => [n.id, n])));

  const layout = createMemo(() => {
    const rows = [];
    for (const layer of props.layers) {
      for (let i = 0; i < layer.length; i += perRow()) rows.push(layer.slice(i, i + perRow()));
    }
    const widest = Math.max(1, ...rows.map((r) => r.length));
    const w = Math.max(width(), widest * BOX_W + (widest - 1) * H_GAP + PAD * 2);
    const pos = new Map();
    rows.forEach((row, r) => {
      const rowWidth = row.length * BOX_W + (row.length - 1) * H_GAP;
      const offset = (w - rowWidth) / 2;
      row.forEach((id, i) => pos.set(id, { x: offset + i * (BOX_W + H_GAP), y: PAD + r * (BOX_H + V_GAP) }));
    });
    const h = rows.length ? PAD * 2 + rows.length * BOX_H + (rows.length - 1) * V_GAP : 120;
    return { pos, width: w, height: h };
  });
  const visible = createMemo(() => new Set(props.layers.flat()));
  const edges = createMemo(() => props.edges.filter((e) => visible().has(e.fromNodeId) && visible().has(e.toNodeId)));

  const [hover, setHover] = createSignal(null);
  let timer;
  const enter = (id) => { clearTimeout(timer); timer = setTimeout(() => setHover(id), HOVER_DELAY_MS); };
  const leave = () => { clearTimeout(timer); setHover(null); };
  onCleanup(() => clearTimeout(timer));
  const trace = createMemo(() => {
    const id = hover();
    if (!id || !visible().has(id)) return null;
    return new Set([id, ...(props.ancestors[id] ?? [])]);
  });

  const ready = createMemo(() => new Set(props.ready));
  const style = (n) => (ready().has(n.id) ? READY_STYLE : STATUS_STYLE[props.status(n.id)] ?? STATUS_STYLE.NOT_STARTED);
  const curve = (a, b) => {
    const x1 = a.x + BOX_W / 2, y1 = a.y + BOX_H, x2 = b.x + BOX_W / 2, y2 = b.y;
    const bend = Math.max(18, Math.min(46, Math.abs(y2 - y1) / 2));
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  };

  return (
    <div ref={container} class="card overflow-x-auto p-0">
      <div class="relative mx-auto" style={{ width: `${layout().width}px`, height: `${layout().height}px` }}>
        <svg width={layout().width} height={layout().height} class="absolute inset-0" aria-hidden="true">
          <For each={edges()}>
            {(e) => {
              const a = () => layout().pos.get(e.fromNodeId);
              const b = () => layout().pos.get(e.toNodeId);
              const app = e.kind === 'APPLICATION';
              const lit = () => trace() && !app && trace().has(e.fromNodeId) && trace().has(e.toNodeId);
              return (
                <Show when={a() && b()}>
                  <path d={curve(a(), b())} fill="none"
                    stroke={lit() ? 'var(--accent)' : app ? 'var(--warn)' : 'var(--line-strong)'}
                    stroke-width={lit() ? 1.8 : 1.3}
                    stroke-dasharray={app ? '5 4' : undefined}
                    opacity={trace() ? (lit() ? 1 : 0.08) : app ? 0.7 : 0.9}
                    style={{ transition: 'opacity 160ms, stroke 160ms' }} />
                </Show>
              );
            }}
          </For>
        </svg>
        <For each={props.layers.flat()}>
          {(id) => {
            const n = () => byId().get(id);
            const p = () => layout().pos.get(id);
            const s = () => style(n());
            const faded = () => trace() && !trace().has(id);
            return (
              <Show when={n() && p()}>
                <button
                  class="absolute flex flex-col items-center justify-center rounded-lg border px-2 text-center leading-tight transition-[opacity,box-shadow,filter] duration-200 hover:shadow-[0_0_0_2px_var(--accent)]"
                  style={{
                    left: `${p().x}px`, top: `${p().y}px`, width: `${BOX_W}px`, height: `${BOX_H}px`,
                    'border-color': s().border, background: s().bg, color: s().text,
                    opacity: faded() ? 0.18 : 1, filter: faded() ? 'grayscale(1)' : undefined,
                    'box-shadow': ready().has(id) ? '0 0 14px color-mix(in srgb, var(--accent) 35%, transparent)' : n().isTarget ? '0 0 0 1.5px var(--warn)' : undefined,
                  }}
                  title={`${n().title}${n().description ? `\n${n().description}` : ''}${ready().has(id) ? '\nAll prerequisites done — ready to start.' : ''}\nClick to cycle status · hover to trace prerequisites`}
                  onClick={() => props.onCycle(n())}
                  onMouseEnter={() => enter(id)}
                  onMouseLeave={leave}
                >
                  <span class="line-clamp-2 text-[11.5px] font-medium">{n().title}</span>
                  <span class="mt-0.5 flex items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-75">
                    <span class="h-1.5 w-1.5 rounded-full" style={{ background: s().dot }} />
                    {ready().has(id) ? 'ready' : n().isTarget ? 'target' : n().branch}
                  </span>
                </button>
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export function RoadmapLegend() {
  const dot = (c) => <span class="h-2 w-2 rounded-full" style={{ background: c }} />;
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
      <span class="flex items-center gap-1.5">{dot('var(--faint)')} not started</span>
      <span class="flex items-center gap-1.5">{dot('var(--accent)')} ready to start</span>
      <span class="flex items-center gap-1.5">{dot('var(--info)')} in progress</span>
      <span class="flex items-center gap-1.5">{dot('var(--good)')} completed</span>
      <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--line-strong)" stroke-width="1.5" /></svg> prerequisite</span>
      <span class="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4 3" /></svg> application</span>
    </div>
  );
}
