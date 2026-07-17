'use client';

// Chart primitives for Anki analytics. Dark-surface palette validated with
// the dataviz validator against surface #11151f: sequential/ordinal blue ramp
// #184f95 → #6da7ec, activity=blue #3987e5, forecast=aqua #199e70.

import { useState } from 'react';

const INK_MUTED = '#8b93a7';
const GRID = '#232a3b';
const RAMP = ['#184f95', '#256abf', '#3987e5', '#6da7ec'];

// ------------------------------------------------------------------ Tooltip

function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = (e: React.MouseEvent, text: string) => {
    const host = (e.currentTarget as SVGElement | HTMLElement).closest('[data-chart]') as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-foreground shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      {tip.text}
    </div>
  ) : null;
  return { show, hide, node };
}

// ------------------------------------------------------------------ Heatmap

export interface HeatDay {
  date: string;
  reviews: number;
}

const heatColor = (n: number) =>
  n === 0 ? '#161b27' : n < 10 ? RAMP[0] : n < 25 ? RAMP[1] : n < 50 ? RAMP[2] : RAMP[3];

/** GitHub-style 365-day activity heatmap. Sequential single-hue ramp. */
export function ActivityHeatmap({ days }: { days: HeatDay[] }) {
  const { show, hide, node } = useTooltip();
  const CELL = 10;
  const GAP = 2;
  // Column per ISO week; pad the front so weeks align on Monday.
  const firstDay = new Date(days[0]?.date ?? Date.now());
  const padStart = (firstDay.getDay() + 6) % 7; // Monday = 0
  const cells: (HeatDay | null)[] = [...Array<null>(padStart).fill(null), ...days];
  const weeks: (HeatDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  const monthLabels: { x: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, w) => {
    const first = week.find(Boolean);
    if (!first) return;
    const month = new Date(first.date).getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ x: w * (CELL + GAP), label: new Date(first.date).toLocaleString('en', { month: 'short' }) });
      lastMonth = month;
    }
  });

  return (
    <div data-chart className="relative overflow-x-auto">
      <svg width={width} height={height + 16} className="block">
        {monthLabels.map((m, i) => (
          <text key={i} x={m.x} y={10} fill={INK_MUTED} fontSize={9}>{m.label}</text>
        ))}
        {weeks.map((week, w) =>
          week.map((day, d) =>
            day === null ? null : (
              <rect
                key={`${w}-${d}`}
                x={w * (CELL + GAP)}
                y={16 + d * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={heatColor(day.reviews)}
                onMouseEnter={(e) => show(e, `${day.date}: ${day.reviews} reviews`)}
                onMouseLeave={hide}
              />
            ),
          ),
        )}
      </svg>
      {node}
      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
        less
        {['#161b27', ...RAMP].map((c) => (
          <span key={c} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
        ))}
        more
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- Bars

export interface BarDatum {
  label: string; // axis label (short)
  tooltip: string;
  value: number;
}

/** Single-series bar chart: thin bars, rounded data ends, hover tooltips. */
export function Bars({ data, color = '#3987e5', height = 120 }: { data: BarDatum[]; color?: string; height?: number }) {
  const { show, hide, node } = useTooltip();
  const max = Math.max(1, ...data.map((d) => d.value));
  const BAR_GAP = 2;
  const width = Math.max(280, data.length * 12);
  const barW = width / data.length - BAR_GAP;
  const maxIndex = data.findIndex((d) => d.value === max);
  const gridYs = [0.25, 0.5, 0.75].map((f) => height - f * height);

  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${width} ${height + 16}`} className="block w-full">
        {gridYs.map((y, i) => (
          <line key={i} x1={0} x2={width} y1={y} y2={y} stroke={GRID} strokeWidth={0.5} />
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * height);
          const x = i * (barW + BAR_GAP);
          return (
            <g key={i}>
              <rect
                x={x}
                y={height - h}
                width={barW}
                height={h}
                rx={Math.min(2, barW / 2)}
                fill={color}
                onMouseEnter={(e) => show(e, d.tooltip)}
                onMouseLeave={hide}
              />
              {/* invisible full-height hit target */}
              <rect x={x} y={0} width={barW + BAR_GAP} height={height} fill="transparent" onMouseEnter={(e) => show(e, d.tooltip)} onMouseLeave={hide} />
              {i === maxIndex && d.value > 0 && (
                <text x={x + barW / 2} y={height - h - 3} textAnchor="middle" fill={INK_MUTED} fontSize={9}>
                  {d.value}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={width} y1={height} y2={height} stroke="#383f52" strokeWidth={1} />
        {data.map((d, i) =>
          d.label && (i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 5) === 0) ? (
            <text key={i} x={i * (barW + BAR_GAP) + barW / 2} y={height + 12} textAnchor="middle" fill={INK_MUTED} fontSize={9}>
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {node}
    </div>
  );
}

// ----------------------------------------------------------- Band line

export interface BandPoint {
  date: string;
  lower: number;
  upper: number;
}

/** Known-words over time: upper/lower bound lines with a band fill between. */
export function BandLine({ points, height = 140 }: { points: BandPoint[]; height?: number }) {
  const { show, hide, node } = useTooltip();
  if (points.length === 0) return <div className="text-[12px] text-muted">No history yet.</div>;

  const PAD_Y = 8;
  const width = Math.max(320, points.length * 24);
  const max = Math.max(1, ...points.map((p) => p.upper));
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * (width - 8) + 4);
  const y = (v: number) => height - PAD_Y - (v / max) * (height - PAD_Y * 2);

  const line = (get: (p: BandPoint) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(get(p))}`).join(' ');
  const band =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.upper)}`).join(' ') +
    ' ' +
    [...points].reverse().map((p, ri) => `L ${x(points.length - 1 - ri)} ${y(p.lower)}`).join(' ') +
    ' Z';

  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${width} ${height + 14}`} className="block w-full">
        {[0.5].map((f) => (
          <line key={f} x1={0} x2={width} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth={0.5} />
        ))}
        <path d={band} fill="#3987e5" opacity={0.15} />
        <path d={line((p) => p.upper)} fill="none" stroke="#6da7ec" strokeWidth={1.6} />
        <path d={line((p) => p.lower)} fill="none" stroke="#3987e5" strokeWidth={1.6} />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.lower)} r={points.length > 40 ? 1.5 : 3} fill="#3987e5" />
            <rect
              x={x(i) - 8} y={0} width={16} height={height} fill="transparent"
              onMouseEnter={(e) => show(e, `${p.date}: ${p.lower === p.upper ? p.lower : `${p.lower}–${p.upper}`} words`)}
              onMouseLeave={hide}
            />
          </g>
        ))}
        <line x1={0} x2={width} y1={height - PAD_Y} y2={height - PAD_Y} stroke="#383f52" strokeWidth={1} />
        <text x={4} y={height + 11} fill={INK_MUTED} fontSize={9}>{points[0].date}</text>
        <text x={width - 4} y={height + 11} textAnchor="end" fill={INK_MUTED} fontSize={9}>
          {points[points.length - 1].date}
        </text>
      </svg>
      {node}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: '#3987e5' }} /> lower bound</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: '#6da7ec' }} /> upper bound</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- State breakdown

export interface StateSegment {
  label: string;
  count: number;
}

/** Ordinal progression bar: NEW → LEARNING → YOUNG → MATURE (+ suspended). */
export function StateBar({ segments }: { segments: StateSegment[] }) {
  const { show, hide, node } = useTooltip();
  const colors: Record<string, string> = {
    new: RAMP[0],
    learning: RAMP[1],
    young: RAMP[2],
    mature: RAMP[3],
    suspended: '#4b5265',
  };
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;
  return (
    <div data-chart className="relative">
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.label}
              className="h-full"
              style={{ width: `${(s.count / total) * 100}%`, background: colors[s.label] ?? '#4b5265' }}
              onMouseEnter={(e) => show(e, `${s.label}: ${s.count} (${Math.round((s.count / total) * 100)}%)`)}
              onMouseLeave={hide}
            />
          ))}
      </div>
      {node}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[s.label] ?? '#4b5265' }} />
            {s.label} <span className="tabular-nums text-foreground">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
