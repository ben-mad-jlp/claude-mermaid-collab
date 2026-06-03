/**
 * FleetGraph layout (BR-3, design §3/§8).
 *
 * dagre, rankdir LR. The horizontal rank (column) of every node is SEEDED from
 * computeWaveMap so the graph's columns line up with the work-graph waves — the
 * graph, the funnel, and the roadmap all agree on "what phase is this in".
 * dagre still does the vertical packing within each column; we only override x
 * by wave so columns can never drift off the wave boundaries.
 */

import dagre from 'dagre';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Positioned {
  x: number;
  y: number;
}

const COL_WIDTH = 240;

/**
 * Lay out the fleet. `rankOf` maps a node id → its wave (column index); nodes
 * without a wave fall back to dagre's own x. Returns a map of id → top-left
 * position for React Flow.
 */
export function layoutFleet(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  rankOf?: (id: string) => number | undefined,
): Map<string, Positioned> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 90, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const out = new Map<string, Positioned>();
  for (const n of nodes) {
    const dn = g.node(n.id);
    if (!dn) continue;
    const wave = rankOf?.(n.id);
    const x = typeof wave === 'number' ? wave * COL_WIDTH : dn.x - n.width / 2;
    out.set(n.id, { x, y: dn.y - n.height / 2 });
  }
  return out;
}
