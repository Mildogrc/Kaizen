// Roadmap graph utilities: prerequisite closure and study-order computation.

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  status: string;
  branch?: string | null;
}

export interface GraphEdge {
  fromNodeId: string;
  toNodeId: string;
  kind: string;
}

/**
 * Returns every prerequisite ancestor of `targetId` (via PREREQUISITE edges
 * only), plus the target itself, in a valid topological study order.
 */
export function pathToTarget(
  targetId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prereqEdges = edges.filter((e) => e.kind === 'PREREQUISITE');
  const parents = new Map<string, string[]>(); // node -> its prerequisites
  for (const e of prereqEdges) {
    if (!parents.has(e.toNodeId)) parents.set(e.toNodeId, []);
    parents.get(e.toNodeId)!.push(e.fromNodeId);
  }

  // Collect the ancestor closure of the target.
  const inPath = new Set<string>();
  const stack = [targetId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inPath.has(id)) continue;
    inPath.add(id);
    for (const p of parents.get(id) ?? []) stack.push(p);
  }

  // Kahn's algorithm restricted to the closure subgraph.
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const id of inPath) indegree.set(id, 0);
  for (const e of prereqEdges) {
    if (!inPath.has(e.fromNodeId) || !inPath.has(e.toNodeId)) continue;
    indegree.set(e.toNodeId, (indegree.get(e.toNodeId) ?? 0) + 1);
    if (!children.has(e.fromNodeId)) children.set(e.fromNodeId, []);
    children.get(e.fromNodeId)!.push(e.toNodeId);
  }

  // Stable order: process ready nodes in original node-array order.
  const originalOrder = new Map(nodes.map((n, i) => [n.id, i]));
  const ready = [...inPath].filter((id) => (indegree.get(id) ?? 0) === 0);
  const sortReady = () => ready.sort((a, b) => (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0));
  sortReady();

  const order: GraphNode[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    const node = byId.get(id);
    if (node) order.push(node);
    for (const child of children.get(id) ?? []) {
      const d = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, d);
      if (d === 0) {
        ready.push(child);
        sortReady();
      }
    }
  }
  return order;
}

/** Percentage of nodes in the target's prerequisite path marked COMPLETED. */
export function pathProgress(targetId: string, nodes: GraphNode[], edges: GraphEdge[]) {
  const path = pathToTarget(targetId, nodes, edges);
  const done = path.filter((n) => n.status === 'COMPLETED').length;
  return { total: path.length, done, pct: path.length === 0 ? 0 : Math.round((done / path.length) * 100) };
}
