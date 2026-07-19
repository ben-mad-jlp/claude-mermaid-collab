import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { frictionTrends, type FrictionTrends } from './friction-trends.ts';
import {
  type FrictionLayer,
  isClusterIntakeActioned,
  markClusterIntakeActioned,
  getClusterIntakeProvenance,
  type IntakeProvenance,
} from './friction-store.ts';
import { listMissions, type MissionSummary } from './mission-store.ts';
import { listTodos, type Todo } from './todo-store.ts';
import { isEpic } from './todo-kind.ts';
import { getConfig } from './config-service.ts';
import { getIntakeEnabled } from './supervisor-store.ts';
import { forgeMissionFromDoc, type ForgeFromDocResult } from '../mcp/tools/mission-forge.ts';

/**
 * MISSION A — friction → forge intake pipeline.
 *
 * A periodic, DETERMINISTIC (no-LLM) detector that reads the friction-trends recurrence rollup and,
 * when a cluster clears a high bar, synthesizes a brief and escalates it into an UNAPPROVED forged
 * mission via the EXISTING forgeMissionFromDoc path (the forge NODE is the only LLM spend; the
 * DETECTOR has none). The drafted mission is inactive with PROPOSED constraints — it sits in the
 * list until a human runs approve_mission, so the pass can NEVER self-drive its own work.
 *
 * A mission is expensive (an overnight of tokens + a human approval), so the bar is deliberately far
 * above triage's `planned`-todo threshold, gated three ways against spam:
 *   - THRESHOLD (default 8) ≫ triage's 3, AND ≥ MIN_SESSIONS distinct sessions (one thrashing
 *     session can't inflate a cluster into a mission), AND layer ∈ {domain, orchestration}
 *     (operational friction — stale worktrees, tmux leaks — is NEVER mission-eligible; it stays a
 *     triage `planned` todo);
 *   - a permanent per-cluster actioned marker (friction-store, a namespace DISJOINT from triage's)
 *     so a double-tick drafts exactly one;
 *   - a per-project ceiling (MAX_PENDING_INTAKE unapproved drafts) + a 3-surface dedup
 *     (missionCoversCluster: an open triage bug todo, an open epic, or a prior forged mission).
 *
 * One cluster per tick (highest count first). Every draft carries queryable provenance
 * (sourceClusterSig + N occ / M sessions), stored in the friction store — NOT a mission column —
 * so approve_mission is an informed decision.
 */

const DEFAULT_THRESHOLD = 8;
const DEFAULT_MIN_SESSIONS = 2;
const DEFAULT_MAX_PENDING = 3;

/** Operational-layer friction is NEVER mission-eligible (locked constraint, enforced here in code). */
export const INTAKE_ELIGIBLE_LAYERS: readonly FrictionLayer[] = ['domain', 'orchestration'];

/** Synthetic owner session for intake-forged missions (mirrors triage's __steward_friction_triage__). */
export const INTAKE_SESSION = '__steward_mission_intake__';

/** Canonical, order-independent signature for a friction cluster. `reasons` is sorted so the same
 *  set of reasons always yields the same signature regardless of trend ordering. */
export function clusterSignature(layer: FrictionLayer, reasons: string[]): string {
  return `${layer}:${[...reasons].sort().join('+')}`;
}

/** One candidate cluster distilled from the trends rollup. In the MVP each recurring reason within
 *  an eligible layer is its own single-reason cluster. */
export interface IntakeCandidate {
  layer: FrictionLayer;
  reasons: string[];
  /** Convenience: reasons[0] (the single reason in the MVP). */
  retryReason: string;
  count: number;
  distinctSessions: number;
  sig: string;
}

export interface MissionCoversDeps {
  listTodos?: (project: string) => Todo[];
  listMissions?: (project: string) => MissionSummary[];
  getProvenance?: (project: string, sig: string) => IntakeProvenance | null;
}

const isOpenTodo = (t: Todo): boolean => t.status !== 'done' && t.status !== 'dropped';

/**
 * 3-SURFACE DEDUP — refuse a cluster when EXISTING work already covers its signature:
 *   1. an open triage BUG todo (triageTag === layer AND the reason appears in title/description);
 *   2. an open EPIC whose title/description references the reason or the cluster signature;
 *   3. a prior forged intake mission for this signature that still exists (provenance ∩ listMissions).
 * Any one surface is sufficient to skip — the mission would duplicate work already in flight.
 */
export function missionCoversCluster(
  project: string,
  candidate: IntakeCandidate,
  deps: MissionCoversDeps = {},
): boolean {
  const listTodosFn = deps.listTodos ?? ((p: string) => listTodos(p));
  const listMissionsFn = deps.listMissions ?? ((p: string) => listMissions(p));
  const getProvenanceFn = deps.getProvenance ?? ((p: string, s: string) => getClusterIntakeProvenance(p, s));

  const todos = listTodosFn(project);
  const reasonHit = (t: Todo): boolean => {
    const hay = `${t.title ?? ''}\n${t.description ?? ''}`;
    return candidate.reasons.some((r) => hay.includes(r));
  };

  // Surface 1: an open triage bug todo already tracks one of the cluster's reasons.
  const bugCovered = todos.some(
    (t) => isOpenTodo(t) && t.triageTag === candidate.layer && reasonHit(t),
  );
  if (bugCovered) return true;

  // Surface 2: an open epic references the reason or the exact cluster signature.
  const epicCovered = todos.some((t) => {
    if (!isOpenTodo(t) || !isEpic(t)) return false;
    const hay = `${t.title ?? ''}\n${t.description ?? ''}`;
    return hay.includes(candidate.sig) || reasonHit(t);
  });
  if (epicCovered) return true;

  // Surface 3: a prior forged intake mission for this signature still exists in the graph.
  const prov = getProvenanceFn(project, candidate.sig);
  if (prov) {
    const stillPresent = listMissionsFn(project).some((m) => m.node.id === prov.missionId);
    if (stillPresent) return true;
  }

  return false;
}

/** Build the candidate list from a trends rollup: eligible layers only, each recurring reason a
 *  single-reason cluster carrying its count + distinct-session tally. Not yet gated by
 *  threshold/dedup (the pass applies those) — pure and unit-testable. */
export function candidatesFromTrends(trends: FrictionTrends): IntakeCandidate[] {
  const out: IntakeCandidate[] = [];
  for (const layerGroup of trends.byLayer) {
    if (!INTAKE_ELIGIBLE_LAYERS.includes(layerGroup.layer)) continue; // operational is never eligible
    for (const r of layerGroup.reasons) {
      const reasons = [r.retryReason];
      out.push({
        layer: layerGroup.layer,
        reasons,
        retryReason: r.retryReason,
        count: r.count,
        distinctSessions: r.sessions.length,
        sig: clusterSignature(layerGroup.layer, reasons),
      });
    }
  }
  return out;
}

/** Synthesize the markdown brief the forge NODE reads. The forge node turns this into falsifiable
 *  mission criteria; the brief is deliberately factual (the recurring reason + its evidence) and
 *  carries the provenance line so it survives into the mission's handoff. */
export function renderIntakeBrief(candidate: IntakeCandidate): string {
  return [
    `# Recurring friction cluster → mission brief`,
    ``,
    `**Cluster signature:** \`${candidate.sig}\``,
    `**Layer:** ${candidate.layer}`,
    `**Reasons:** ${candidate.reasons.join(', ')}`,
    `**Occurrences:** ${candidate.count}`,
    `**Distinct sessions:** ${candidate.distinctSessions}`,
    ``,
    `## Problem`,
    ``,
    `The friction store shows the reason "${candidate.retryReason}" (${candidate.layer} layer) recurring`,
    `${candidate.count} time(s) across ${candidate.distinctSessions} distinct session(s). A recurrence this`,
    `persistent is not a one-off leaf failure — it is a systemic gap worth driving to convergence as a`,
    `mission with falsifiable acceptance criteria.`,
    ``,
    `## What to forge`,
    ``,
    `Survey the repo to ground the criteria in the real seam(s) this friction touches, then draft`,
    `3–7 falsifiable acceptance criteria that, once met, would make this recurring friction impossible`,
    `(or observably rarer). Sequence them by risk; make the last one a measured-outcome check.`,
    ``,
    `Locked constraint: fix the ROOT CAUSE of the recurrence, not the symptom of any single occurrence.`,
    ``,
    `_Auto-drafted by the deterministic mission-intake pass from cluster \`${candidate.sig}\`,`,
    `${candidate.count} occurrence(s) / ${candidate.distinctSessions} session(s)._`,
  ].join('\n');
}

export interface MissionIntakeResult {
  /** The drafted mission + provenance, or null when nothing was escalated this tick. */
  drafted: { missionId: string; sig: string; briefPath: string; provenance: IntakeProvenance } | null;
  /** Why the pass did (not) draft — for observability / tests. */
  reason:
    | 'drafted'
    | 'intake-disabled'
    | 'pending-ceiling'
    | 'no-eligible-cluster';
  /** How many unapproved drafts were pending at pass start (ceiling gauge). */
  pending: number;
}

export interface MissionIntakeDeps {
  trends?: (project: string) => FrictionTrends;
  listTodos?: (project: string) => Todo[];
  listMissions?: (project: string) => MissionSummary[];
  intakeEnabled?: (project: string) => boolean;
  isActioned?: (project: string, sig: string) => boolean;
  markActioned?: (project: string, prov: IntakeProvenance) => Promise<void>;
  getProvenance?: (project: string, sig: string) => IntakeProvenance | null;
  /** Escalate the selected cluster's brief into an UNAPPROVED forged mission. Default calls the
   *  EXISTING forgeMissionFromDoc (the forge NODE) with the brief as the source doc. */
  forge?: (project: string, candidate: IntakeCandidate, briefContent: string) => Promise<{ missionId: string }>;
  /** Persist the brief; returns its path. Default writes .collab/intake/<sig>.md. */
  writeBrief?: (project: string, sig: string, content: string) => string;
  threshold?: number;
  minSessions?: number;
  maxPending?: number;
  now?: () => Date;
}

function sanitizeSigForFilename(sig: string): string {
  return sig.replace(/[^A-Za-z0-9._+-]/g, '_');
}

function defaultWriteBrief(project: string, sig: string, content: string): string {
  const dir = join(project, '.collab', 'intake');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitizeSigForFilename(sig)}.md`);
  writeFileSync(path, content.endsWith('\n') ? content : content + '\n');
  return path;
}

/** Default escalation: reuse forgeMissionFromDoc VERBATIM (no second forge implementation). The brief
 *  is fed in via the readDoc dep, so the forge node reads OUR synthesized doc and emits a spec that
 *  forgeMission instantiates as UNAPPROVED (inactive, constraints proposed). */
async function defaultForge(
  project: string,
  candidate: IntakeCandidate,
  briefContent: string,
): Promise<{ missionId: string }> {
  const res: ForgeFromDocResult = await forgeMissionFromDoc(
    project,
    { session: INTAKE_SESSION, docId: `intake-${sanitizeSigForFilename(candidate.sig)}` },
    { readDoc: async () => briefContent },
  );
  return { missionId: res.missionId };
}

/**
 * Count unapproved drafts pending human approval — the per-project ceiling gauge. Counts ALL
 * unapproved missions (a conservative bound: intake never piles more than MAX_PENDING_INTAKE
 * unapproved drafts onto the human's approval queue, whatever their origin).
 */
function pendingUnapprovedCount(missions: MissionSummary[]): number {
  return missions.filter((m) => m.mission.status === 'unapproved').length;
}

/**
 * One deterministic intake tick. Escalates AT MOST ONE cluster (highest count) into an UNAPPROVED
 * forged mission when it clears every gate. No LLM in the detector; the forge NODE (in `forge`) is
 * the only spend, and it is reached only after the deterministic selection commits to one cluster.
 */
export async function runMissionIntakePass(
  project: string,
  deps: MissionIntakeDeps = {},
): Promise<MissionIntakeResult> {
  const trendsFn = deps.trends ?? ((p: string) => frictionTrends(p));
  const listMissionsFn = deps.listMissions ?? ((p: string) => listMissions(p));
  const intakeEnabledFn = deps.intakeEnabled ?? ((p: string) => getIntakeEnabled(p));
  const isActioned = deps.isActioned ?? ((p: string, s: string) => isClusterIntakeActioned(p, s));
  const markActioned = deps.markActioned ?? ((p: string, prov: IntakeProvenance) => markClusterIntakeActioned(p, prov));
  const forge = deps.forge ?? defaultForge;
  const writeBrief = deps.writeBrief ?? defaultWriteBrief;
  const now = deps.now ?? (() => new Date());
  const threshold = deps.threshold ?? (Number(getConfig('MISSION_INTAKE_THRESHOLD', '') || 0) || DEFAULT_THRESHOLD);
  const minSessions = deps.minSessions ?? (Number(getConfig('MISSION_INTAKE_MIN_SESSIONS', '') || 0) || DEFAULT_MIN_SESSIONS);
  const maxPending = deps.maxPending ?? (Number(getConfig('MAX_PENDING_INTAKE', '') || 0) || DEFAULT_MAX_PENDING);

  // Toggle-gated, DEFAULT OFF: only escalate for a project explicitly opted in.
  if (!intakeEnabledFn(project)) return { drafted: null, reason: 'intake-disabled', pending: 0 };

  // Per-project ceiling: never pile more than MAX_PENDING_INTAKE unapproved drafts on the human.
  const pending = pendingUnapprovedCount(listMissionsFn(project));
  if (pending >= maxPending) return { drafted: null, reason: 'pending-ceiling', pending };

  // Deterministic detector: eligible layer ∧ count≥threshold ∧ sessions≥min ∧ !actioned ∧ !covered.
  const coversDeps: MissionCoversDeps = {
    listTodos: deps.listTodos,
    listMissions: listMissionsFn,
    getProvenance: deps.getProvenance,
  };
  const eligible = candidatesFromTrends(trendsFn(project))
    .filter((c) => c.count >= threshold)
    .filter((c) => c.distinctSessions >= minSessions)
    .filter((c) => !isActioned(project, c.sig))
    .filter((c) => !missionCoversCluster(project, c, coversDeps))
    // Highest count first; ties broken by signature for total-order determinism.
    .sort((a, b) => b.count - a.count || a.sig.localeCompare(b.sig));

  if (eligible.length === 0) return { drafted: null, reason: 'no-eligible-cluster', pending };

  const chosen = eligible[0]; // ONE cluster per tick
  const briefContent = renderIntakeBrief(chosen);
  const briefPath = writeBrief(project, chosen.sig, briefContent);

  const { missionId } = await forge(project, chosen, briefContent);

  const provenance: IntakeProvenance = {
    clusterSig: chosen.sig,
    layer: chosen.layer,
    reasons: chosen.reasons,
    count: chosen.count,
    sessions: chosen.distinctSessions,
    missionId,
    briefPath,
    at: now().toISOString(),
  };
  // Permanent per-cluster marker (doubles as queryable provenance) — a double-tick drafts exactly one.
  await markActioned(project, provenance);

  return { drafted: { missionId, sig: chosen.sig, briefPath, provenance }, reason: 'drafted', pending };
}
