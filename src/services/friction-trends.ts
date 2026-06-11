import { listFriction, type FrictionLayer, type FrictionNote } from './friction-store';

/**
 * friction_trends — recurrence rollup over the friction store (read-only).
 *
 * `list_friction` returns the raw notes newest-first; it does NOT answer the
 * question the steward actually has: "what keeps going wrong?" This tool groups
 * the recent friction by LAYER (orchestration vs domain) with counts, and within
 * each layer by `retryReason`, so a problem that recurs (e.g. the tmux pane
 * accumulation showing up as repeated orchestration friction) surfaces as a
 * high-count reason instead of being buried in a flat list.
 *
 * The core (`summarizeFrictionTrends`) is a PURE function over an already-fetched
 * note array so it is trivially unit-testable; `frictionTrends` is the thin
 * store-backed wrapper the MCP tool calls.
 */

/** One recurring reason within a layer. */
export interface FrictionReasonGroup {
  retryReason: string;
  count: number;
  /** Distinct sessions that hit this reason (null-session notes excluded). */
  sessions: string[];
  /** Most-recent createdAt across this reason's notes (ISO). */
  lastAt: string;
}

/** All friction for one layer, with its reasons ranked by count. */
export interface FrictionLayerGroup {
  layer: FrictionLayer;
  count: number;
  reasons: FrictionReasonGroup[];
}

export interface FrictionTrends {
  /** Number of notes considered (after the recency window). */
  total: number;
  /** How many most-recent notes were rolled up (the cap applied). */
  considered: number;
  byLayer: FrictionLayerGroup[];
  /** Cross-layer view of reasons seen more than once, most-recurring first —
   *  the "what keeps going wrong" shortlist. */
  recurring: Array<{ layer: FrictionLayer; retryReason: string; count: number }>;
}

/** Pure rollup: group notes by layer → retryReason with counts. Input is assumed
 *  newest-first (as listFriction returns); `lastAt` is the max createdAt seen. */
export function summarizeFrictionTrends(notes: FrictionNote[]): FrictionTrends {
  const byLayerMap = new Map<FrictionLayer, Map<string, FrictionReasonGroup>>();

  for (const note of notes) {
    let reasons = byLayerMap.get(note.layer);
    if (!reasons) { reasons = new Map(); byLayerMap.set(note.layer, reasons); }
    let group = reasons.get(note.retryReason);
    if (!group) {
      group = { retryReason: note.retryReason, count: 0, sessions: [], lastAt: note.createdAt };
      reasons.set(note.retryReason, group);
    }
    group.count++;
    if (note.session && !group.sessions.includes(note.session)) group.sessions.push(note.session);
    if (note.createdAt > group.lastAt) group.lastAt = note.createdAt;
  }

  const byLayer: FrictionLayerGroup[] = [];
  for (const [layer, reasons] of byLayerMap) {
    const reasonGroups = [...reasons.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
    const count = reasonGroups.reduce((sum, r) => sum + r.count, 0);
    byLayer.push({ layer, count, reasons: reasonGroups });
  }
  byLayer.sort((a, b) => b.count - a.count);

  const recurring = byLayer
    .flatMap((l) => l.reasons.filter((r) => r.count > 1).map((r) => ({ layer: l.layer, retryReason: r.retryReason, count: r.count })))
    .sort((a, b) => b.count - a.count);

  return { total: notes.length, considered: notes.length, byLayer, recurring };
}

/** Store-backed wrapper: take the most-recent `limit` notes (optionally filtered
 *  to one layer) and roll them up. Default limit 100, capped 1000. */
export function frictionTrends(
  project: string,
  opts: { layer?: FrictionLayer; limit?: number } = {},
): FrictionTrends {
  const cap = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  // listFriction returns newest-first; slice to the recency window.
  const notes = listFriction(project, { layer: opts.layer }).slice(0, cap);
  return summarizeFrictionTrends(notes);
}
