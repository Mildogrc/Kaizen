import { describe, expect, it } from 'vitest';
import { pathToTarget, pathProgress, type GraphEdge, type GraphNode } from '../src/lib/roadmap';
import { MATH_NODES, MATH_EDGES } from '../prisma/seed-data/math-roadmap';

// Build the seed roadmap as an in-memory graph (ids = slugs).
const nodes: GraphNode[] = MATH_NODES.map((n) => ({
  id: n.slug, slug: n.slug, title: n.title, status: 'NOT_STARTED', branch: n.branch,
}));
const edges: GraphEdge[] = MATH_EDGES.map((e) => ({
  fromNodeId: e.from, toNodeId: e.to, kind: e.kind ?? 'PREREQUISITE',
}));

function assertTopological(order: GraphNode[]) {
  const position = new Map(order.map((n, i) => [n.id, i]));
  for (const e of edges) {
    if (e.kind !== 'PREREQUISITE') continue;
    if (position.has(e.fromNodeId) && position.has(e.toNodeId)) {
      expect(
        position.get(e.fromNodeId)! < position.get(e.toNodeId)!,
        `${e.fromNodeId} must come before ${e.toNodeId}`,
      ).toBe(true);
    }
  }
}

describe('pathToTarget on the seeded math roadmap', () => {
  it('iwasawa theory path includes its full prerequisite chain in valid order', () => {
    const path = pathToTarget('iwasawa-theory', nodes, edges);
    const slugs = path.map((n) => n.slug);
    // Direct prerequisites from the spec:
    for (const req of ['intro-proofs', 'abstract-algebra', 'group-theory', 'ring-theory', 'field-theory', 'galois-theory', 'commutative-algebra', 'algebraic-number-theory']) {
      expect(slugs).toContain(req);
    }
    // Transitive foundations:
    expect(slugs).toContain('algebra-1');
    expect(slugs).toContain('linear-algebra');
    // Target is last-reachable and present:
    expect(slugs[slugs.length - 1]).toBe('iwasawa-theory');
    assertTopological(path);
  });

  it('quantitative finance path pulls in stochastic processes and its measure-theory chain', () => {
    const slugs = pathToTarget('quantitative-finance', nodes, edges).map((n) => n.slug);
    expect(slugs).toContain('stochastic-processes');
    expect(slugs).toContain('probability-theory');
    expect(slugs).toContain('measure-theory');
    expect(slugs).toContain('real-analysis');
  });

  it('excludes unrelated branches from a target path', () => {
    const slugs = pathToTarget('iwasawa-theory', nodes, edges).map((n) => n.slug);
    expect(slugs).not.toContain('stochastic-processes');
    expect(slugs).not.toContain('riemannian-geometry');
  });

  it('ignores APPLICATION edges when computing prerequisites', () => {
    // galois-theory ⤍ cryptography is an APPLICATION edge; cryptography's
    // prerequisite path must not include galois-theory's chain via it.
    const slugs = pathToTarget('cryptography', nodes, edges).map((n) => n.slug);
    expect(slugs).toContain('abstract-algebra');
    expect(slugs).not.toContain('galois-theory');
  });

  it('every prerequisite edge is topologically respected for QFT', () => {
    assertTopological(pathToTarget('quantum-field-theory', nodes, edges));
  });

  it('pathProgress counts completions', () => {
    const done = nodes.map((n) => (n.slug === 'algebra-1' ? { ...n, status: 'COMPLETED' } : n));
    const progress = pathProgress('iwasawa-theory', done, edges);
    expect(progress.done).toBe(1);
    expect(progress.total).toBeGreaterThan(10);
    expect(progress.pct).toBeGreaterThan(0);
  });
});
