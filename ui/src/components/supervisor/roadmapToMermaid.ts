import type { PlanItem } from '@/types/planItem';

/**
 * Plan dependency-graph helpers.
 *
 * Bridge P6 retired the mermaid plan visualization (the `roadmapToMermaid`
 * graph/waves render path is gone — the Plan surface is now the flex/grid
 * PlanKanban). What remains here are the two pure helpers that survive that
 * change because other surfaces depend on them:
 *  - `computeWaveMap` — dependency-depth → wave number; used by the PlanKanban
 *    columns AND the FleetGraph layout.
 *  - `sanitizeId` — id → mermaid/DOM-safe token; kept for any remaining
 *    id-normalization callers.
 */

export function sanitizeId(id: string): string {
  let s = id.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s;
}

/**
 * Wave number per item = longest dependency chain depth (roots = 0). Cycles are
 * naturally bounded by the pass limit (at most `items.length` passes).
 */
export function computeWaveMap(items: PlanItem[]): Map<string, number> {
  const idSet = new Set(items.map((i) => i.id));
  const waveMap = new Map<string, number>();
  for (const item of items) waveMap.set(item.id, 0);
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const item of items) {
      const deps = (item.dependsOn ?? []).filter((d) => idSet.has(d) && d !== item.id);
      if (deps.length === 0) continue;
      const maxDepWave = Math.max(...deps.map((d) => waveMap.get(d) ?? 0));
      const desired = maxDepWave + 1;
      if ((waveMap.get(item.id) ?? 0) < desired) {
        waveMap.set(item.id, desired);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return waveMap;
}
