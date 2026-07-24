/**
 * conductor-signature — pure key-building for the AUTONOMOUS CONDUCTOR's debounce. Extracted from
 * conductor-pass.ts so the fingerprint logic is testable in isolation and mission-scoped card
 * collection has one owner. No store/db/git imports — runtime-dependency-free.
 */
import type { Escalation } from './supervisor-store.js';

export interface ConductorActionRow {
  action: 'met' | 'building' | 'verify' | 'discover' | 'escalate';
  id: string;
  rejectedParked?: number;
}

/** Escalation kinds that represent a HARD block on conductor progress. The last two literals
 *  must equal CRITERION_SERVE_CAP_KIND (conductor-pass.ts) and INFRA_REJECTED_KIND
 *  (conductor-infra-arm.ts) — pinned by an identity test, not a runtime import (avoids a cycle). */
export const HARD_CARD_KINDS: readonly string[] = [
  'blocker',
  'assumption-invalidated',
  'criterion-serve-cap',
  'leaf-infra-rejected',
  'needs-design',
];

/** The kind counted today at conductor-pass.ts:298 as the land-readiness signal. */
export const LAND_CARD_KIND = 'epic-ready-to-land';

/** Partition a mission's live (open/acknowledged) escalations into hard-block ids and
 *  land-ready ids, scoped to one project and one mission's todo ids. Both outputs are sorted +
 *  de-duplicated so the result is order-independent w.r.t. the input array. */
export function collectMissionCardIds(
  escalations: readonly Pick<Escalation, 'id' | 'kind' | 'project' | 'status' | 'todoId'>[],
  project: string,
  missionTodoIds: ReadonlySet<string> | readonly string[]
): { hardCardIds: string[]; landCardIds: string[] } {
  const ids = missionTodoIds instanceof Set ? missionTodoIds : new Set(missionTodoIds);
  const hardCardIds = new Set<string>();
  const landCardIds = new Set<string>();
  for (const e of escalations) {
    if (e.project !== project) continue;
    if (e.status !== 'open' && e.status !== 'acknowledged') continue;
    if (e.todoId == null || !ids.has(e.todoId)) continue;
    if (HARD_CARD_KINDS.includes(e.kind)) hardCardIds.add(e.id);
    else if (e.kind === LAND_CARD_KIND) landCardIds.add(e.id);
  }
  return { hardCardIds: [...hardCardIds].sort(), landCardIds: [...landCardIds].sort() };
}

/** Debounce fingerprint: the derived mission status + the per-criterion actions, plus (when
 *  non-empty) the hard-block card ids. Back-compat contract (load-bearing): with hardCardIds
 *  empty/omitted the output is byte-identical to the pre-extraction conductorFingerprint, so
 *  live lastConductorKey values keep matching. */
export function buildServeSignature(input: {
  status: string;
  actions: ConductorActionRow[];
  hardCardIds?: readonly string[];
}): string {
  const parts = input.actions.map((a) => `${a.id}:${a.action}:${a.rejectedParked ?? 0}`).sort();
  let sig = `${input.status}|${parts.join(',')}`;
  if (input.hardCardIds && input.hardCardIds.length > 0) {
    sig += `|cards:${[...input.hardCardIds].sort().join(',')}`;
  }
  return sig;
}

/** Per-pass fingerprint: the serve signature plus the land-ready card ids (ids, not a count, so
 *  a resolved card is a real delta). */
export function buildPassSignature(serveSignature: string, landCardIds: readonly string[]): string {
  return `${serveSignature}|land:${[...landCardIds].sort().join(',')}`;
}

/** Debounce fingerprint: the derived mission status + the per-criterion actions. Unchanged ⇒ the
 *  conductor already saw this exact state and spent a node on it — do not spend another. */
export function conductorFingerprint(status: string, actions: ConductorActionRow[]): string {
  return buildServeSignature({ status, actions });
}
