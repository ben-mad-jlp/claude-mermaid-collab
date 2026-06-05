/**
 * FleetGraph layout (BR-3 + Bridge-polish-v1, design §3/§8).
 *
 * Columns are SEEDED from computeWaveMap so each work-graph wave becomes a
 * horizontal column (dependency depth reads left→right). dagre (rankdir LR)
 * supplies a stable, dependency-aware vertical ORDER within the graph; we then
 * pack each wave's nodes into that column top→bottom, WRAPPING a tall wave into
 * adjacent sub-columns so a wave with many same-rank siblings spreads across the
 * width instead of collapsing into a single ~40px strip. Node x-positions are
 * therefore guaranteed to differ per wave.
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

const ROW_GAP = 20;
const SUBCOL_GAP = 28;
const WAVE_GAP = 80;
/** A column taller than this wraps into another sub-column (keeps the graph wide, not a strip). */
const MAX_COL_HEIGHT = 680;

export type LayoutDirection = 'LR' | 'TB';

/** A row of waves taller than this wraps (mirror of MAX_COL_HEIGHT for TB). */
const MAX_ROW_WIDTH = 1100;

export function layoutFleet(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  rankOf?: (id: string) => number | undefined,
  direction: LayoutDirection = 'LR',
): Map<string, Positioned> {
  const out = new Map<string, Positioned>();
  if (nodes.length === 0) return out;

  // dagre gives a stable, dependency-aware order within each wave. rankdir mirrors
  // the deck orientation (LR side-by-side / TB stacked); we read the cross-axis
  // coordinate as the intra-wave order (y for LR, x for TB).
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: ROW_GAP, ranksep: WAVE_GAP, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const orderOf = (id: string): number =>
    (direction === 'TB' ? g.node(id)?.x : g.node(id)?.y) ?? 0;

  // Bucket nodes by wave (dependency depth).
  const byWave = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const w = rankOf?.(n.id) ?? 0;
    const arr = byWave.get(w) ?? [];
    arr.push(n);
    byWave.set(w, arr);
  }
  const waves = Array.from(byWave.keys()).sort((a, b) => a - b);

  // LR: waves advance along x, siblings stack down y (wrap into sub-columns).
  // TB: waves advance along y, siblings stack along x (wrap into sub-rows).
  let cursor = 0;
  for (const w of waves) {
    const items = byWave.get(w)!.slice().sort((a, b) => orderOf(a.id) - orderOf(b.id));
    const rowH = Math.max(...items.map((n) => n.height)) + ROW_GAP;
    const colW = Math.max(...items.map((n) => n.width)) + SUBCOL_GAP;

    if (direction === 'TB') {
      const perRow = Math.max(1, Math.floor(MAX_ROW_WIDTH / colW));
      const subRows = Math.max(1, Math.ceil(items.length / perRow));
      items.forEach((n, i) => {
        const sub = Math.floor(i / perRow);
        const col = i % perRow;
        out.set(n.id, { x: col * colW, y: cursor + sub * rowH });
      });
      cursor += subRows * rowH + WAVE_GAP;
    } else {
      const perCol = Math.max(1, Math.floor(MAX_COL_HEIGHT / rowH));
      const subCols = Math.max(1, Math.ceil(items.length / perCol));
      items.forEach((n, i) => {
        const sub = Math.floor(i / perCol);
        const row = i % perCol;
        out.set(n.id, { x: cursor + sub * colW, y: row * rowH });
      });
      cursor += subCols * colW + WAVE_GAP;
    }
  }

  return out;
}
