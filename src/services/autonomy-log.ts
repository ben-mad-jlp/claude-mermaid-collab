/**
 * autonomy-log.ts — Mission B/B6: a unified, bounded, in-memory observability log of
 * AUTONOMOUS MUTATIONS the system makes without a human in the loop.
 *
 * Three self-driving mutation sites feed this one ring so a steward can see, in ONE
 * place (surfaced via orchestrator_status), what the machinery did on its own:
 *   - 'reserve-leaf'        — reserve-leaf.ts re-cut a poisoned leaf to a fresh id, or
 *                             hit the cap and escalated.
 *   - 'deploy-refusal'      — deploy-service.deploySafetyGate refused a self-deploy
 *                             (leaves-in-flight / tree-does-not-match-head / epic-mid-land).
 *   - 'terminal-deactivate' — mission-store.deactivateIfTerminal self-healed a stale
 *                             active flag on a terminal mission.
 *
 * DESIGN (locked constraints):
 *   - The ring is BOUNDED (RING_CAP) — recording evicts the oldest, never grows unbounded.
 *   - `actor` and `reason` are REQUIRED on every entry (an entry that can't say WHO and
 *     WHY is not an observation). A malformed entry is dropped, never stored partial.
 *   - Recording is FAIL-SAFE: recordAutonomousMutation NEVER throws into its caller. It is
 *     called from the mutation path itself, so a bug in the recorder must not break the
 *     mutation. Every internal step is wrapped; the worst case is a lost log line.
 *
 * This mirrors the in-memory `recentSpawns` shape surfaced by orchestrator_status, but
 * lives in-process (not the durable supervisor-audit DB) because these are cheap,
 * high-churn advisory observations, not an auditable ledger.
 */

/** The kinds of autonomous mutation B6 observes. */
export type AutonomyMutationKind = 'reserve-leaf' | 'deploy-refusal' | 'terminal-deactivate';

/** One recorded autonomous mutation. `actor` + `reason` are required; the rest is context. */
export interface AutonomyMutation {
  kind: AutonomyMutationKind;
  /** WHO made the mutation (e.g. 'self-heal', 'deploy-gate', a conductor session id). Required. */
  actor: string;
  /** WHY — a machine-ish reason string (e.g. 'terminal', 'cap-exhausted:...'). Required. */
  reason: string;
  /** Optional project scope; entries with no project match every project filter. */
  project?: string;
  /** Optional free-form detail (e.g. `<oldId>→<newId>`, a todoId). */
  detail?: string;
  /** Epoch-ms the mutation happened. Defaults to Date.now() when omitted/invalid. */
  at: number;
}

/** Max entries retained. Recording past this evicts the oldest (FIFO). Keep it small —
 *  this is a rolling recent-activity window, not an audit trail. */
export const RING_CAP = 50;

/** The bounded ring, oldest-first (index 0 is the oldest still-retained entry). */
const ring: AutonomyMutation[] = [];

/**
 * Record one autonomous mutation into the bounded ring. FAIL-SAFE by contract: this is
 * invoked from inside the mutation path, so it swallows EVERYTHING — a malformed entry,
 * a serialization quirk, anything — and never throws into the caller. The worst outcome
 * is a dropped log line.
 *
 * Rejects (silently) any entry missing a non-empty `actor` or `reason`: an observation
 * that can't say who/why is noise, and the locked constraint requires both.
 */
export function recordAutonomousMutation(entry: {
  kind: AutonomyMutationKind;
  actor: string;
  reason: string;
  project?: string;
  detail?: string;
  at?: number;
}): void {
  try {
    // REQUIRED fields — drop rather than store a partial, useless entry.
    if (!entry || typeof entry.actor !== 'string' || entry.actor.length === 0) return;
    if (typeof entry.reason !== 'string' || entry.reason.length === 0) return;

    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : Date.now();
    const normalized: AutonomyMutation = {
      kind: entry.kind,
      actor: entry.actor,
      reason: entry.reason,
      at,
    };
    if (typeof entry.project === 'string' && entry.project.length > 0) normalized.project = entry.project;
    if (typeof entry.detail === 'string' && entry.detail.length > 0) normalized.detail = entry.detail;

    ring.push(normalized);
    // Bound the ring: evict oldest until at/under cap (a loop, not a single shift, so a
    // lowered cap or any drift self-corrects).
    while (ring.length > RING_CAP) ring.shift();
  } catch {
    /* fail-safe: a bad entry must never throw into the mutation path. */
  }
}

/**
 * The recent autonomous mutations, NEWEST-FIRST (freshest observation at index 0).
 * Optionally scoped to a project: an entry matches when it has no project (global) OR its
 * project equals the filter. Returns a fresh array (never the live ring).
 */
export function recentAutonomousMutations(opts: { project?: string } = {}): AutonomyMutation[] {
  const project = opts.project;
  const out = project
    ? ring.filter((e) => e.project == null || e.project === project)
    : ring.slice();
  return out.reverse();
}

/** Test-only: clear the ring so cases don't bleed retained entries into each other. */
export function _resetAutonomyLog(): void {
  ring.length = 0;
}
