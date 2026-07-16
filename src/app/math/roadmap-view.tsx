'use client';

// Interactive math roadmap rendered as a layered tree (DAG): nodes are placed
// on rows by prerequisite depth, edges are drawn as curves in an SVG underlay
// (solid = prerequisite, dashed amber = application). Target buttons filter
// the tree to a target's prerequisite subgraph. Clicking a node cycles
// not started → in progress → completed.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { cycleNodeStatus } from '@/lib/actions';
import { pathToTarget } from '@/lib/roadmap';

interface NodeVM {
  id: string;
  slug: string;
  title: string;
  status: string;
  branch: string | null;
  level: string;
  isTarget: boolean;
  description: string | null;
}

interface EdgeVM {
  fromNodeId: string;
  toNodeId: string;
  kind: string;
}

const BOX_W = 148;
const BOX_H = 46;
const H_GAP = 16;
const V_GAP = 56;
const PAD = 12;

// Dwell time before a hovered node's prerequisite ancestry lights up.
// Tune to taste; anywhere in the 200–1000ms range feels reasonable.
const HOVER_DELAY_MS = 350;

const STATUS_BOX: Record<string, string> = {
  NOT_STARTED: 'border-line bg-surface-2 text-[#aab2c4]',
  IN_PROGRESS: 'border-blue-700 bg-blue-950/70 text-blue-200',
  COMPLETED: 'border-green-800 bg-green-950/70 text-green-300',
};

const STATUS_DOT: Record<string, string> = {
  NOT_STARTED: 'bg-slate-600',
  IN_PROGRESS: 'bg-blue-400',
  COMPLETED: 'bg-green-400',
};

// Not started, but every prerequisite up the tree is completed → you could
// start this right now. Rendered with a cyan glow.
const READY_BOX =
  'border-cyan-500/70 bg-cyan-950/40 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.28)]';
const READY_DOT = 'bg-cyan-300';

interface LayoutResult {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

// Layered DAG layout: depth = longest prerequisite chain from the roots,
// within-row order refined by parent/child barycenter sweeps to reduce
// edge crossings, rows centered on the widest row. Rows wider than
// `maxPerRow` wrap into sub-rows so the tree fits the container and grows
// downward instead of sideways.
function layoutTree(nodes: NodeVM[], edges: EdgeVM[], maxPerRow: number): LayoutResult {
  const ids = new Set(nodes.map((n) => n.id));
  const prereq = edges.filter(
    (e) => e.kind === 'PREREQUISITE' && ids.has(e.fromNodeId) && ids.has(e.toNodeId),
  );

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of prereq) {
    (parents.get(e.toNodeId) ?? parents.set(e.toNodeId, []).get(e.toNodeId)!).push(e.fromNodeId);
    (children.get(e.fromNodeId) ?? children.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId);
  }

  // Longest-path depth via Kahn topological order.
  const indegree = new Map<string, number>();
  for (const n of nodes) indegree.set(n.id, parents.get(n.id)?.length ?? 0);
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const depth = new Map<string, number>(queue.map((id) => [id, 0]));
  const topo: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const c of children.get(id) ?? []) {
      depth.set(c, Math.max(depth.get(c) ?? 0, (depth.get(id) ?? 0) + 1));
      const d = indegree.get(c)! - 1;
      indegree.set(c, d);
      if (d === 0) queue.push(c);
    }
  }

  const maxDepth = Math.max(0, ...depth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  // Initial order: group siblings by branch so related fields sit together.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted = [...nodes].sort(
    (a, b) => (a.branch ?? '').localeCompare(b.branch ?? '') || a.title.localeCompare(b.title),
  );
  for (const n of sorted) layers[depth.get(n.id) ?? 0].push(n.id);

  const index = new Map<string, number>();
  const reindex = () => layers.forEach((layer) => layer.forEach((id, i) => index.set(id, i)));
  reindex();

  const barycenter = (id: string, neighbors: Map<string, string[]>) => {
    const ns = neighbors.get(id) ?? [];
    const xs = ns.map((p) => index.get(p)).filter((v): v is number => v !== undefined);
    return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : index.get(id)!;
  };

  // Two down-sweeps (order by parents) and one up-sweep (order by children).
  for (let pass = 0; pass < 3; pass++) {
    const useParents = pass !== 1;
    const neighbors = useParents ? parents : children;
    const order = useParents ? layers : [...layers].reverse();
    for (const layer of order) {
      layer.sort((a, b) => barycenter(a, neighbors) - barycenter(b, neighbors) || (byId.get(a)!.title < byId.get(b)!.title ? -1 : 1));
      reindex();
    }
  }

  // Wrap over-wide layers into sub-rows of at most maxPerRow nodes.
  const subRows: string[][] = [];
  for (const layer of layers) {
    if (layer.length === 0) continue;
    for (let i = 0; i < layer.length; i += maxPerRow) {
      subRows.push(layer.slice(i, i + maxPerRow));
    }
  }

  const widest = Math.max(1, ...subRows.map((r) => r.length));
  const totalWidth = widest * BOX_W + (widest - 1) * H_GAP + PAD * 2;
  const pos = new Map<string, { x: number; y: number }>();
  subRows.forEach((row, r) => {
    const rowWidth = row.length * BOX_W + (row.length - 1) * H_GAP;
    const offset = (totalWidth - rowWidth) / 2;
    row.forEach((id, i) => {
      pos.set(id, { x: offset + i * (BOX_W + H_GAP), y: PAD + r * (BOX_H + V_GAP) });
    });
  });

  const rows = subRows.length;
  return { pos, width: totalWidth, height: PAD * 2 + rows * BOX_H + (rows - 1) * V_GAP };
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x1 = from.x + BOX_W / 2;
  const y1 = from.y + BOX_H;
  const x2 = to.x + BOX_W / 2;
  const y2 = to.y;
  const bend = Math.min(40, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

export function MathRoadmap({ nodes, edges, initialTarget }: { nodes: NodeVM[]; edges: EdgeVM[]; initialTarget: string | null }) {
  const targets = nodes.filter((n) => n.isTarget);
  const [targetSlug, setTargetSlug] = useState<string | null>(initialTarget);
  const [hideAdvanced, setHideAdvanced] = useState(false);
  const [, startTransition] = useTransition();
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});

  // Track container width so the tree wraps to fit instead of scrolling sideways.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const maxPerRow = Math.max(3, Math.floor((containerWidth - PAD * 2 + H_GAP) / (BOX_W + H_GAP)));

  // Dwell-hover: after HOVER_DELAY_MS on a node, highlight its full
  // prerequisite closure (prereqs, their prereqs, …) and fade the rest.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const onNodeEnter = (id: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverId(id), HOVER_DELAY_MS);
  };
  const onNodeLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoverId(null);
  };

  const effective = (n: { id: string; status: string }) => statusOverride[n.id] ?? n.status;

  const targetNode = targetSlug ? nodes.find((n) => n.slug === targetSlug) ?? null : null;

  // Visible subgraph: a target's prerequisite closure, or the whole roadmap
  // (optionally without advanced/target nodes).
  const visibleNodes = useMemo(() => {
    if (targetNode) return pathToTarget(targetNode.id, nodes, edges) as NodeVM[];
    if (hideAdvanced) return nodes.filter((n) => n.level === 'FOUNDATION' || n.level === 'CORE');
    return nodes;
  }, [targetNode, hideAdvanced, nodes, edges]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.fromNodeId) && visibleIds.has(e.toNodeId)),
    [edges, visibleIds],
  );

  const layout = useMemo(
    () => layoutTree(visibleNodes, visibleEdges, maxPerRow),
    [visibleNodes, visibleEdges, maxPerRow],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Nodes that are NOT_STARTED but whose entire prerequisite closure (direct
  // prereqs, their prereqs, …) is COMPLETED — i.e. unlocked and startable.
  // Computed over the full graph so filtering the view never changes readiness.
  const readySet = useMemo(() => {
    const parents = new Map<string, string[]>();
    for (const e of edges) {
      if (e.kind !== 'PREREQUISITE') continue;
      if (!parents.has(e.toNodeId)) parents.set(e.toNodeId, []);
      parents.get(e.toNodeId)!.push(e.fromNodeId);
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const cache = new Map<string, boolean>();
    // completeUpTo: this node AND everything above it is completed.
    const completeUpTo = (id: string): boolean => {
      if (cache.has(id)) return cache.get(id)!;
      cache.set(id, false); // cycle guard
      const node = nodeById.get(id);
      const ok =
        !!node &&
        effective(node) === 'COMPLETED' &&
        (parents.get(id) ?? []).every(completeUpTo);
      cache.set(id, ok);
      return ok;
    };
    const ready = new Set<string>();
    for (const n of nodes) {
      if (effective(n) !== 'NOT_STARTED') continue;
      if ((parents.get(n.id) ?? []).every(completeUpTo)) ready.add(n.id);
    }
    return ready;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, statusOverride]);

  const hoverSet = useMemo(() => {
    if (!hoverId || !visibleIds.has(hoverId)) return null;
    return new Set(pathToTarget(hoverId, visibleNodes, visibleEdges).map((n) => n.id));
  }, [hoverId, visibleIds, visibleNodes, visibleEdges]);

  const studyOrder = useMemo(
    () => (targetNode ? (pathToTarget(targetNode.id, nodes, edges) as NodeVM[]) : null),
    [targetNode, nodes, edges],
  );
  const doneCount = visibleNodes.filter((n) => effective(n) === 'COMPLETED').length;

  const onNodeClick = (node: NodeVM) => {
    const cycle = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];
    const next = cycle[(cycle.indexOf(effective(node)) + 1) % cycle.length];
    setStatusOverride((prev) => ({ ...prev, [node.id]: next }));
    startTransition(() => cycleNodeStatus(node.id));
  };

  const targetBtn = (label: string, slug: string | null, active: boolean) => (
    <button
      key={slug ?? 'all'}
      onClick={() => setTargetSlug(slug)}
      className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
        active
          ? 'border-amber-600 bg-amber-950/50 text-amber-200'
          : 'border-line bg-surface-2 text-muted hover:border-amber-700/50 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {/* Target buttons */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {targetBtn('Full roadmap', null, targetSlug === null)}
        {targets.map((t) => targetBtn(t.title, t.slug, targetSlug === t.slug))}
        {!targetNode && (
          <label className="ml-2 flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={hideAdvanced} onChange={(e) => setHideAdvanced(e.target.checked)} />
            Hide advanced
          </label>
        )}
      </div>

      {/* Summary + legend */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="tabular-nums">
          {targetNode ? `Path to ${targetNode.title}: ` : ''}
          {doneCount}/{visibleNodes.length} completed
        </span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-600" /> not started</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.8)]" /> ready to start</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" /> in progress</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-400" /> completed</span>
        <span className="flex items-center gap-1"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#64748b" strokeWidth="1.5" /></svg> prerequisite</span>
        <span className="flex items-center gap-1"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#b4832a" strokeWidth="1.5" strokeDasharray="4 3" /></svg> application</span>
        <span className="ml-auto">click: cycle status · hover: trace prerequisites</span>
      </div>

      {/* Tree diagram */}
      <div ref={containerRef} className="overflow-x-auto rounded-lg border border-line bg-surface">
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} className="absolute inset-0">
            {visibleEdges.map((e, i) => {
              const from = layout.pos.get(e.fromNodeId);
              const to = layout.pos.get(e.toNodeId);
              if (!from || !to) return null;
              const app = e.kind === 'APPLICATION';
              // While a hover trace is active, prerequisite edges inside the
              // closure light up; everything else recedes.
              const inTrace =
                hoverSet === null
                  ? null
                  : !app && hoverSet.has(e.fromNodeId) && hoverSet.has(e.toNodeId);
              return (
                <path
                  key={i}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={inTrace ? '#6ea8fe' : app ? '#b4832a' : '#3d4557'}
                  strokeWidth={inTrace ? 1.6 : 1.2}
                  strokeDasharray={app ? '5 4' : undefined}
                  opacity={inTrace === null ? (app ? 0.75 : 0.8) : inTrace ? 1 : 0.07}
                  style={{ transition: 'opacity 180ms ease, stroke 180ms ease' }}
                />
              );
            })}
          </svg>
          {visibleNodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const faded = hoverSet !== null && !hoverSet.has(n.id);
            const ready = readySet.has(n.id);
            return (
              <button
                key={n.id}
                onClick={() => onNodeClick(n)}
                onMouseEnter={() => onNodeEnter(n.id)}
                onMouseLeave={onNodeLeave}
                title={`${n.title}${n.description ? `\n${n.description}` : ''}${ready ? '\nAll prerequisites completed — ready to start.' : ''}\nClick to cycle status · hold hover to trace prerequisites.`}
                className={`absolute flex flex-col items-center justify-center rounded-md border px-1.5 text-center leading-tight transition-[opacity,border-color,filter,box-shadow] duration-200 hover:border-accent/70 cursor-pointer ${ready ? READY_BOX : STATUS_BOX[effective(n)]} ${n.isTarget ? 'ring-1 ring-amber-500/60' : ''} ${faded ? 'opacity-20 grayscale' : ''} ${hoverId === n.id ? 'border-accent' : ''}`}
                style={{ left: p.x, top: p.y, width: BOX_W, height: BOX_H }}
              >
                <span className="line-clamp-2 text-[11px] font-medium">{n.title}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wide opacity-70">
                  <span className={`h-1 w-1 rounded-full ${ready ? READY_DOT : STATUS_DOT[effective(n)]}`} />
                  {ready ? 'ready to start' : n.isTarget ? 'target' : n.branch}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ordered study path for the selected target */}
      {studyOrder && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-muted hover:text-foreground">
            Study order for {targetNode!.title} ({studyOrder.length} courses)
          </summary>
          <ol className="mt-2 grid gap-x-6 gap-y-0.5 md:grid-cols-2 xl:grid-cols-3">
            {studyOrder.map((n, i) => (
              <li key={n.id} className="flex items-center gap-2 text-[12px]">
                <span className="w-5 text-right text-[10px] text-muted tabular-nums">{i + 1}.</span>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[effective(byId.get(n.id)!)]}`} />
                {n.title}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
