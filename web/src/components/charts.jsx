// Lightweight SVG charts sized to their container (no chart library).
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

function useWidth(fallback = 600) {
  const [width, setWidth] = createSignal(fallback);
  let el;
  const ref = (node) => { el = node; };
  onMount(() => {
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.floor(entry.contentRect.width))));
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });
  return [ref, width];
}

function Tooltip(props) {
  return (
    <Show when={props.text}>
      <div
        class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[11px] shadow-[var(--shadow-lg)]"
        style={{ left: `${props.x}px`, top: `${props.y - 6}px` }}
      >
        {props.text}
      </div>
    </Show>
  );
}

const niceMax = (max) => {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const n = max / magnitude;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * magnitude;
};

export function Bars(props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = createSignal(null);
  const height = () => props.height ?? 140;
  const geometry = createMemo(() => {
    const data = props.data ?? [];
    const top = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
    const left = 30;
    const bottom = 18;
    const plotW = Math.max(10, width() - left - 4);
    const plotH = height() - bottom - 6;
    const slot = data.length ? plotW / data.length : plotW;
    const bar = Math.max(2, Math.min(36, slot * 0.72));
    const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44))));
    return { data, top, left, plotW, plotH, slot, bar, every };
  });
  return (
    <div ref={ref} class="relative w-full">
      <svg width={width()} height={height()} role="img" aria-label={props.label ?? 'Bar chart'}>
        <For each={[0, 0.5, 1]}>
          {(f) => {
            const g = geometry();
            const y = 6 + g.plotH * (1 - f);
            return (
              <>
                <line x1={g.left} x2={g.left + g.plotW} y1={y} y2={y} stroke="var(--line)" stroke-dasharray={f === 0 ? undefined : '3 3'} />
                <text x={g.left - 6} y={y + 3} text-anchor="end" font-size="10" fill="var(--faint)" class="tnum">{Math.round(g.top * f)}</text>
              </>
            );
          }}
        </For>
        <For each={geometry().data}>
          {(d, i) => {
            const g = geometry();
            const h = () => (g.top ? ((d.value ?? 0) / g.top) * g.plotH : 0);
            const x = g.left + i() * g.slot + (g.slot - g.bar) / 2;
            return (
              <g onMouseEnter={() => setHover({ i: i(), x: x + g.bar / 2, y: 6 + g.plotH - h(), text: d.tooltip ?? `${d.label}: ${d.value}` })} onMouseLeave={() => setHover(null)}>
                <rect x={g.left + i() * g.slot} y={6} width={g.slot} height={g.plotH} fill="transparent" />
                <rect x={x} y={6 + g.plotH - h()} width={g.bar} height={Math.max(h(), d.value ? 1.5 : 0)} rx={Math.min(3, g.bar / 3)} fill={d.color ?? props.color ?? 'var(--accent)'} opacity={hover() && hover().i !== i() ? 0.55 : 0.92} />
                <Show when={i() % g.every === 0}>
                  <text x={x + g.bar / 2} y={height() - 4} text-anchor="middle" font-size="10" fill="var(--faint)">{d.label}</text>
                </Show>
              </g>
            );
          }}
        </For>
      </svg>
      <Tooltip text={hover()?.text} x={hover()?.x} y={hover()?.y} />
    </div>
  );
}

export function LineChart(props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = createSignal(null);
  const height = () => props.height ?? 150;
  const geometry = createMemo(() => {
    const data = props.data ?? [];
    const values = data.map((d) => d.value ?? 0);
    const hi = Math.max(...values, 1);
    const lo = props.zero === false ? Math.min(...values) : 0;
    const pad = (hi - lo) * 0.08 || 1;
    const top = hi + pad;
    const bottomValue = props.zero === false ? lo - pad : 0;
    const left = 36;
    const plotW = Math.max(10, width() - left - 8);
    const plotH = height() - 24;
    const x = (i) => left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = (v) => 6 + plotH * (1 - (v - bottomValue) / (top - bottomValue || 1));
    const points = data.map((d, i) => [x(i), y(d.value ?? 0)]);
    const path = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
    const area = points.length ? `${path} L${points.at(-1)[0]},${6 + plotH} L${points[0][0]},${6 + plotH} Z` : '';
    const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56))));
    return { data, points, path, area, top, bottomValue, left, plotW, plotH, every, y };
  });
  const id = `lg-${Math.random().toString(36).slice(2)}`;
  return (
    <div ref={ref} class="relative w-full">
      <Show when={(props.data ?? []).length} fallback={<div class="py-10 text-center text-[12px] text-muted">No data yet</div>}>
        <svg width={width()} height={height()} role="img" aria-label={props.label ?? 'Line chart'} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color={props.color ?? 'var(--accent)'} stop-opacity="0.22" />
              <stop offset="100%" stop-color={props.color ?? 'var(--accent)'} stop-opacity="0" />
            </linearGradient>
          </defs>
          <For each={[0, 0.5, 1]}>
            {(f) => {
              const g = geometry();
              const v = g.bottomValue + (g.top - g.bottomValue) * f;
              const yy = g.y(v);
              return (
                <>
                  <line x1={g.left} x2={g.left + g.plotW} y1={yy} y2={yy} stroke="var(--line)" stroke-dasharray={f === 0 ? undefined : '3 3'} />
                  <text x={g.left - 6} y={yy + 3} text-anchor="end" font-size="10" fill="var(--faint)" class="tnum">{Math.round(v)}</text>
                </>
              );
            }}
          </For>
          <path d={geometry().area} fill={`url(#${id})`} />
          <path d={geometry().path} fill="none" stroke={props.color ?? 'var(--accent)'} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <For each={geometry().data}>
            {(d, i) => {
              const g = geometry();
              const [px, py] = g.points[i()] ?? [0, 0];
              const slot = g.plotW / Math.max(1, g.data.length);
              return (
                <g onMouseEnter={() => setHover({ i: i(), x: px, y: py, text: d.tooltip ?? `${d.label}: ${d.value}` })}>
                  <rect x={px - slot / 2} y={0} width={slot} height={height()} fill="transparent" />
                  <circle cx={px} cy={py} r={hover()?.i === i() ? 4 : g.data.length > 40 ? 0 : 2.5} fill="var(--surface)" stroke={props.color ?? 'var(--accent)'} stroke-width="2" />
                  <Show when={i() % g.every === 0}>
                    <text x={px} y={height() - 4} text-anchor="middle" font-size="10" fill="var(--faint)">{d.label}</text>
                  </Show>
                </g>
              );
            }}
          </For>
        </svg>
        <Tooltip text={hover()?.text} x={hover()?.x} y={hover()?.y} />
      </Show>
    </div>
  );
}

/** Lower/upper band over time (known-word bounds). */
export function BandChart(props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = createSignal(null);
  const height = () => props.height ?? 140;
  const geometry = createMemo(() => {
    const pts = props.points ?? [];
    const top = niceMax(Math.max(1, ...pts.map((p) => p.upper)));
    const left = 36;
    const plotW = Math.max(10, width() - left - 8);
    const plotH = height() - 24;
    const x = (i) => left + (pts.length <= 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const y = (v) => 6 + plotH * (1 - v / top);
    const upper = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.upper)}`).join(' ');
    const lowerBack = pts.map((p, i) => [x(i), y(p.lower)]).reverse().map(([a, b]) => `L${a},${b}`).join(' ');
    const lower = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.lower)}`).join(' ');
    return { pts, top, left, plotW, plotH, x, y, band: pts.length ? `${upper} ${lowerBack} Z` : '', lower };
  });
  return (
    <div ref={ref} class="relative w-full">
      <Show when={(props.points ?? []).length} fallback={<div class="py-10 text-center text-[12px] text-muted">No history yet</div>}>
        <svg width={width()} height={height()} onMouseLeave={() => setHover(null)}>
          <For each={[0, 0.5, 1]}>
            {(f) => {
              const g = geometry();
              const yy = 6 + g.plotH * (1 - f);
              return (
                <>
                  <line x1={g.left} x2={g.left + g.plotW} y1={yy} y2={yy} stroke="var(--line)" stroke-dasharray={f === 0 ? undefined : '3 3'} />
                  <text x={g.left - 6} y={yy + 3} text-anchor="end" font-size="10" fill="var(--faint)" class="tnum">{Math.round(g.top * f)}</text>
                </>
              );
            }}
          </For>
          <path d={geometry().band} fill={props.color ?? 'var(--info)'} opacity="0.18" />
          <path d={geometry().lower} fill="none" stroke={props.color ?? 'var(--info)'} stroke-width="2" />
          <For each={geometry().pts}>
            {(p, i) => {
              const g = geometry();
              const slot = g.plotW / Math.max(1, g.pts.length);
              return (
                <rect x={g.x(i()) - slot / 2} y="0" width={slot} height={height()} fill="transparent"
                  onMouseEnter={() => setHover({ x: g.x(i()), y: g.y(p.upper), text: `${p.date}: ${p.lower === p.upper ? p.lower : `${p.lower}–${p.upper}`} words` })} />
              );
            }}
          </For>
        </svg>
        <Tooltip text={hover()?.text} x={hover()?.x} y={hover()?.y} />
      </Show>
    </div>
  );
}

/** GitHub-style calendar heatmap of daily counts. */
export function Heatmap(props) {
  const [ref, width] = useWidth(700);
  const [hover, setHover] = createSignal(null);
  const key = () => props.valueKey ?? 'reviews';
  const thresholds = () => props.thresholds ?? [1, 10, 30, 60];
  const layout = createMemo(() => {
    const days = props.days ?? [];
    if (!days.length) return { cells: [], weeks: 0, size: 10, months: [] };
    const first = new Date(`${days[0].date}T12:00:00`);
    const offset = first.getDay();
    const weeks = Math.ceil((days.length + offset) / 7);
    const size = Math.max(6, Math.min(13, Math.floor((width() - 28) / weeks) - 2));
    const cells = days.map((d, i) => ({ ...d, col: Math.floor((i + offset) / 7), row: (i + offset) % 7 }));
    const months = [];
    let last = -1;
    for (const c of cells) {
      const m = new Date(`${c.date}T12:00:00`).getMonth();
      if (m !== last && c.row === 0) {
        // Skip a label that would collide with the previous one (partial first month).
        if (months.length && c.col - months.at(-1).col < 3) months.pop();
        months.push({ col: c.col, label: new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }) });
        last = m;
      }
    }
    return { cells, weeks, size, months };
  });
  const level = (v) => { const t = thresholds(); let l = 0; for (const x of t) if (v >= x) l++; return l; };
  const opacities = [0, 0.28, 0.5, 0.75, 1];
  return (
    <div ref={ref} class="relative w-full overflow-x-auto">
      <svg width={28 + layout().weeks * (layout().size + 2)} height={16 + 7 * (layout().size + 2)}>
        <For each={layout().months}>{(m) => <text x={28 + m.col * (layout().size + 2)} y="10" font-size="10" fill="var(--faint)">{m.label}</text>}</For>
        <For each={['Mon', 'Wed', 'Fri']}>{(label, i) => <text x="0" y={16 + (1 + i() * 2) * (layout().size + 2) + layout().size - 2} font-size="9" fill="var(--faint)">{label}</text>}</For>
        <For each={layout().cells}>
          {(c) => {
            const v = c[key()] ?? 0;
            const l = level(v);
            const x = 28 + c.col * (layout().size + 2);
            const y = 16 + c.row * (layout().size + 2);
            return (
              <rect x={x} y={y} width={layout().size} height={layout().size} rx="2"
                fill={l ? props.color ?? 'var(--good)' : 'var(--surface-3)'} fill-opacity={l ? opacities[Math.min(l, 4)] : 1}
                onMouseEnter={() => setHover({ x: x + layout().size / 2, y, text: `${c.date}: ${v} ${props.unit ?? 'reviews'}${c.minutes != null && key() === 'reviews' ? ` · ${c.minutes} min` : ''}` })}
                onMouseLeave={() => setHover(null)} />
            );
          }}
        </For>
      </svg>
      <Tooltip text={hover()?.text} x={hover()?.x} y={hover()?.y} />
    </div>
  );
}

/** Horizontal labelled bars (distributions). */
export function HBars(props) {
  const max = () => Math.max(1, ...(props.data ?? []).map((d) => d.value));
  return (
    <div class="space-y-1.5">
      <For each={props.data}>
        {(d) => (
          <div class="grid grid-cols-[minmax(4rem,8rem)_1fr_auto] items-center gap-2 text-[12px]" title={d.tooltip}>
            <span class="truncate text-muted">{d.label}</span>
            <div class="h-2 overflow-hidden rounded-full bg-surface-3"><div class="h-full rounded-full" style={{ width: `${(d.value / max()) * 100}%`, background: d.color ?? props.color ?? 'var(--accent)' }} /></div>
            <span class="tnum w-10 text-right">{d.value}</span>
          </div>
        )}
      </For>
    </div>
  );
}
