/**
 * Land Authority — ONE LAND PROOF, THREE ACTORS
 *
 * The actor determines AUTHORITY; the proof determines SAFETY.
 * Never trade one for the other. Every actor — human click, conductor call, daemon
 * auto-land — calls `landReadiness()`. `landAuthority()` additionally gates the
 * conductor on OWNERSHIP.
 *
 * This module is read-only: it decides, it never merges.
 */

import type { Todo } from './todo-store';
import { listTodos } from './todo-store';
import type { LandReadinessReport } from './epic-land-readiness';
import { getEpicLandReadiness } from './epic-land-readiness';
import type { EpicLandGateResult, EpicLandGateOpts } from './epic-land-gate';
import { runEpicLandGate, landGateTrailer, landGateSummary } from './epic-land-gate';
import { isEpicTodo, isLandTodo } from './invariant-check';
import { epicBranchName } from './epic-branch-status';
import { isMission } from './todo-kind.ts';
import { getMission, isMissionTerminal } from './mission-store';
import { realRunners } from './steward-proof';

/** Actor types for land authority checking */
export type LandActor =
  | { kind: 'human' }
  | { kind: 'conductor'; session: string }
  | { kind: 'daemon'; level: 'auto' };

/** Reason codes for blocking a land operation */
export type LandBlockCode =
  | 'not-an-epic'
  | 'bucket-epic'
  | 'no-active-mission'
  | 'foreign-mission'
  | 'land-deps-unsatisfied'
  | 'presence-findings'
  | 'gate-regression'
  | 'gate-error'
  | 'tsc-failed'
  | 'merge-conflict';

/** A single blocker with code, message, and optional detail */
export interface LandBlocker {
  code: LandBlockCode;
  message: string;
  detail?: string;
}

/** The land readiness verdict — safety proof (actor-independent) */
export interface LandReadinessVerdict {
  project: string;
  epicId: string;
  epicBranch: string;
  green: boolean;
  blockers: LandBlocker[];
  presence: LandReadinessReport;
  gate: EpicLandGateResult | null;
  inheritedRed: boolean;
  summary: string;
}

/** Land authority verdict — adds actor and authorization check */
export interface LandAuthorityVerdict extends LandReadinessVerdict {
  actor: LandActor;
  authorized: boolean;
  ownership: 'n/a' | 'owned' | 'foreign' | 'bucket' | 'unowned';
  trailer: string;
}

/** Injected probes for testing */
export interface LandProbes {
  presence?: (project: string, epicId: string) => LandReadinessReport;
  gate?: (opts: EpicLandGateOpts) => Promise<EpicLandGateResult>;
  merge?: (project: string, epicBranch: string, epicWorktreeCwd: string) => {
    tscClean: boolean;
    mergeClean: boolean;
  };
  todos?: (project: string) => Todo[];
  /** Resolves the epic accumulation worktree cwd; tsc + merge run HERE, not the repo root. */
  worktreeCwd?: (project: string, epicId: string) => Promise<string> | string;
}

/**
 * Check if a todo is a bucket epic.
 *
 * Bucket-ness is the `isBucket` column (the single marker), read fail-CLOSED-by-construction —
 * a bucket row is `isBucket=1` regardless of title suffix, so the fail-open is closed by data,
 * not by regex. The buckets (Inbox, Bugfix inbox) are curated and backfilled by id at stage C.
 */
export function isBucketEpic(t: Todo): boolean {
  return isEpicTodo(t) && t.isBucket;
}

/**
 * Walk up from epicId to find the owning mission.
 * Returns { mission: Todo | null; chain: string[] } where chain is the path taken.
 * Cycle-guarded with a hard cap of ~64 hops.
 */
export function findOwningMission(todos: Todo[], epicId: string): { mission: Todo | null; chain: string[] } {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const chain: string[] = [];
  const MAX_HOPS = 64;

  let cur = byId.get(epicId);
  while (cur && chain.length < MAX_HOPS) {
    chain.push(cur.id);
    if (seen.has(cur.id)) break; // cycle detected
    seen.add(cur.id);

    if (isMission(cur)) {
      return { mission: cur, chain };
    }

    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
  }

  return { mission: null, chain };
}

/**
 * Check ownership for a conductor actor.
 * Returns { ok: boolean; ownership; blocker? }
 *
 * For human/daemon actors, returns { ok: true, ownership: 'n/a' } immediately.
 */
export function checkOwnership(
  project: string,
  epicId: string,
  actor: LandActor,
  todos?: Todo[],
): { ok: boolean; ownership: 'n/a' | 'owned' | 'foreign' | 'bucket' | 'unowned'; blocker?: LandBlocker } {
  const allTodos = todos || listTodos(project, { includeCompleted: true });
  const byId = new Map(allTodos.map((t) => [t.id, t]));

  // For human and daemon, skip ownership checks
  if (actor.kind === 'human' || actor.kind === 'daemon') {
    return { ok: true, ownership: 'n/a' };
  }

  const epic = byId.get(epicId);

  // Rule 1: Epic must exist and be an epic
  if (!epic || !isEpicTodo(epic)) {
    return {
      ok: false,
      ownership: 'unowned',
      blocker: {
        code: 'not-an-epic',
        message: `Todo ${epicId} is not an [EPIC]`,
      },
    };
  }

  // Rule 2: Bucket epics are never conductor-landable
  if (isBucketEpic(epic)) {
    return {
      ok: false,
      ownership: 'bucket',
      blocker: {
        code: 'bucket-epic',
        message: `${epic.title} is a bucket root: it has no mission and no owner, and is never conductor-landable. Re-home the work under a mission epic first.`,
      },
    };
  }

  // Rule 3: Must have an owning mission
  const { mission } = findOwningMission(allTodos, epicId);
  if (!mission) {
    return {
      ok: false,
      ownership: 'unowned',
      blocker: {
        code: 'no-active-mission',
        message: `Epic ${epic.title} has no owning mission`,
      },
    };
  }

  // Rule 4: Mission must be active and not terminal
  const missionRow = getMission(project, mission.id);
  if (!missionRow?.active || isMissionTerminal(missionRow)) {
    const status = missionRow?.status ?? 'unknown';
    return {
      ok: false,
      ownership: 'unowned',
      blocker: {
        code: 'no-active-mission',
        message: `Mission ${mission.title} is not active (status: ${status})`,
      },
    };
  }

  // Rule 5: Mission must be owned by this conductor session
  if (missionRow && actor.kind === 'conductor' && mission.ownerSession !== actor.session) {
    return {
      ok: false,
      ownership: 'foreign',
      blocker: {
        code: 'foreign-mission',
        message: `Epic ${epic.title} belongs to mission ${mission.title} owned by session ${mission.ownerSession}; you are ${actor.session}. Ask that conductor to land it, or escalate to the human.`,
      },
    };
  }

  return { ok: true, ownership: 'owned' };
}

/**
 * Check that the epic's [LAND] leaf dependencies are satisfied.
 * Returns null if all checks pass, or a LandBlocker if any fail.
 */
export function checkLandDeps(todos: Todo[], epicId: string): LandBlocker | null {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const epic = byId.get(epicId);

  if (!epic) {
    return null;
  }

  // Find the [LAND] child (direct child of epic)
  const landLeaf = todos.find((t) => t.parentId === epicId && isLandTodo(t));

  if (!landLeaf) {
    return {
      code: 'land-deps-unsatisfied',
      message: `Epic ${epic.title} has no [LAND] leaf (constraint a383bc2c): it will strand on its branch looking done.`,
    };
  }

  // Check all dependencies of the land leaf are done and not rejected
  const unsatisfied: string[] = [];
  for (const depId of landLeaf.dependsOn) {
    const dep = byId.get(depId);
    if (!dep || dep.status !== 'done' || dep.acceptanceStatus === 'rejected') {
      unsatisfied.push(depId.slice(0, 8));
      if (unsatisfied.length >= 3) break; // Collect first 3 offenders
    }
  }

  if (unsatisfied.length > 0) {
    return {
      code: 'land-deps-unsatisfied',
      message: `[LAND] leaf dependencies unsatisfied: ${unsatisfied.join(', ')}`,
    };
  }

  return null;
}

/** Sanitize a value for use in a git trailer (no CR/LF, trimmed) */
function sanitizeTrailerValue(value: string): string {
  return value.replace(/[\r\n]/g, '').trim();
}

/**
 * Tri-mode merge probe: tsc + merge-dry-run.
 * Delegates to the shared, memoized runners in steward-proof.
 */
function defaultMergeProbe(
  project: string,
  epicBranch: string,
  epicWorktreeCwd: string,
): { tscClean: boolean; mergeClean: boolean } {
  return {
    tscClean: realRunners.tscClean(epicWorktreeCwd),
    mergeClean: realRunners.epicMergeClean(project, epicBranch),
  };
}

/**
 * Default epic-worktree-cwd resolver — mirrors deriveEpicLandProof's callers
 * (coordinator-live.ts:1635-1638). Falls back to the project root when the epic worktree
 * can't be ensured (non-git / error).
 */
async function resolveEpicWorktreeCwd(project: string, epicId: string): Promise<string> {
  const { getWorktreeManager } = await import('./coordinator-live');
  const wt = await getWorktreeManager(project).ensureEpic(epicId).catch(() => null);
  return wt?.path ?? project;
}

/**
 * The single land readiness proof.
 * Collects ALL blockers before returning, never early-exits except for branch-missing.
 */
export async function landReadiness(
  project: string,
  epicId: string,
  opts?: { probes?: LandProbes; todos?: Todo[] },
): Promise<LandReadinessVerdict> {
  const probes = opts?.probes ?? {};
  const allTodos = opts?.todos ?? (probes.todos ? probes.todos(project) : listTodos(project, { includeCompleted: true }));

  const epicBranch = epicBranchName(epicId);
  const blockers: LandBlocker[] = [];
  let inheritedRed = false;
  let gate: EpicLandGateResult | null = null;
  let presence: LandReadinessReport = { project, epicId, epicBranch, blocking: false, findings: [], exemptions: [], duplicateCommits: [], checked: 0 };

  // Step 1: Check [LAND] leaf dependencies
  const depBlocker = checkLandDeps(allTodos, epicId);
  if (depBlocker) {
    blockers.push(depBlocker);
  }

  // Resolve the epic worktree cwd for merge and tsc probes
  const cwdProbe = probes.worktreeCwd ?? resolveEpicWorktreeCwd;
  const epicWorktreeCwd = await cwdProbe(project, epicId);

  // Step 2: Check merge and tsc
  const mergeProbe = probes.merge || ((p, b, w) => defaultMergeProbe(p, b, w));
  const mergeResult = mergeProbe(project, epicBranch, epicWorktreeCwd);

  if (!mergeResult.tscClean) {
    blockers.push({
      code: 'tsc-failed',
      message: `tsc compilation failed in epic branch ${epicBranch}`,
    });
  }

  if (!mergeResult.mergeClean) {
    blockers.push({
      code: 'merge-conflict',
      message: `Dry merge of ${epicBranch} into master encounters conflicts`,
    });
  }

  // Step 3: Check presence (G9)
  const presenceProbe = probes.presence || ((p, e) => getEpicLandReadiness(p, e));
  presence = presenceProbe(project, epicId);

  if (presence.blocking) {
    blockers.push({
      code: 'presence-findings',
      message: `Accepted CODE leaves have no commits reachable from epic branch`,
      detail: presence.findings.map((f) => `${f.todoId.slice(0, 8)} ${f.kind}: ${f.title}`).join('; '),
    });
  }

  // Step 4: Check gate (G10)
  // Only run gate if previous checks didn't fail (short-circuit on merge/branch missing)
  const gateProbe = probes.gate || runEpicLandGate;
  const gateOpts: EpicLandGateOpts = {
    project,
    repo: project,
    epicId,
    epicBranch,
    epicWorktreeCwd,
  };

  gate = await gateProbe(gateOpts);

  // Gate produces regressions (branch-red, master-green) — blocking
  if (gate.regressions.length > 0) {
    blockers.push({
      code: 'gate-regression',
      message: `Land gate found ${gate.regressions.length} regressions (branch fails, master passes)`,
    });
  }

  // Gate errors or incidents — blocking
  if (gate.status === 'error' || gate.incidents.length > 0) {
    blockers.push({
      code: 'gate-error',
      message: `Land gate encountered errors: ${gate.reasons[0] ?? 'unknown'}`,
    });
  }

  // Inherited red (branch-red and master-red) — reported, not blocking
  if (gate.inherited.length > 0) {
    inheritedRed = true;
  }

  // Build summary
  let summary = '';
  if (gate.declared) {
    summary = landGateSummary(gate);
  } else {
    summary = 'no gate declared';
  }

  if (presence.findings.length > 0) {
    summary += `; ${presence.findings.length} presence finding(s)`;
  }

  if (depBlocker) {
    summary = `[LAND] leaf deps unsatisfied; ${summary}`;
  }

  const green = blockers.length === 0;

  return {
    project,
    epicId,
    epicBranch,
    green,
    blockers,
    presence,
    gate,
    inheritedRed,
    summary,
  };
}

/**
 * Build the Landed-By trailer for a commit.
 */
export function landedByTrailer(actor: LandActor): string {
  if (actor.kind === 'human') {
    return 'Landed-By: human';
  }
  if (actor.kind === 'conductor') {
    return `Landed-By: conductor:${sanitizeTrailerValue(actor.session)}`;
  }
  return 'Landed-By: daemon:auto';
}

/**
 * The complete land authority check.
 * Returns both ownership and readiness verdicts so the caller has full context.
 */
export async function landAuthority(
  project: string,
  epicId: string,
  actor: LandActor,
  opts?: { probes?: LandProbes; todos?: Todo[] },
): Promise<LandAuthorityVerdict> {
  const allTodos = opts?.todos ?? (opts?.probes?.todos ? opts.probes.todos(project) : listTodos(project, { includeCompleted: true }));

  // Check ownership (only gates conductors; others get 'n/a')
  const ownershipResult = checkOwnership(project, epicId, actor, allTodos);

  // Always compute readiness regardless of ownership
  const readinessResult = await landReadiness(project, epicId, opts);

  // Build the full verdict
  const blockers: LandBlocker[] = [];

  // Ownership blockers come first if present
  if (!ownershipResult.ok && ownershipResult.blocker) {
    blockers.push(ownershipResult.blocker);
  }

  // Then readiness blockers
  blockers.push(...readinessResult.blockers);

  const authorized = ownershipResult.ok && readinessResult.green;
  const trailer = landedByTrailer(actor);

  return {
    ...readinessResult,
    actor,
    authorized,
    ownership: ownershipResult.ownership,
    blockers,
    trailer,
  };
}
