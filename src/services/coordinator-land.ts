/**
 * Landing subsystem — extracted (MOVE ONLY, no logic changes) from coordinator-live.ts
 * to shrink that file. Owns: epic gating-children derivation, the land mutex, the land
 * proof wrapper, the auto-land arming sweeps (mission + non-mission), the convergent /
 * observed-merge land-leaf stamping, the epic-ready-to-land surface, stale-epic
 * revalidation, the post-land digest refresh, and the human/daemon land click (landEpic)
 * itself. `epicAutoLandAuthority` / `isMissionEpic` / `MISSION_AUTOLAND_ARMED` /
 * `todoIsMissionScoped` stay in coordinator-live.ts (shared with accept-time code that
 * is NOT part of this extraction — see the "shared with coordinator-land" markers there)
 * and are imported back here.
 */
import * as path from 'node:path';
import type { Todo } from './todo-store';
import { listTodos, getTodo, completeTodo, stampEpicLandedAt } from './todo-store';
import { isEpic } from './todo-kind.ts';
import { STUCK_AUTOLAND_THRESHOLD } from './harness-caps';
import { createEscalation, resolveEscalation, getEscalation, recordSupervisorAudit, getProjectDigestEnabled } from './supervisor-store';
import { regenerateProjectDigest, type DigestLlm } from './project-digest';
import { makeDigestLlm } from './digest-llm';
import { type ForwardIntegrateResult } from '../agent/worktree-manager';
import { runRegistryGate, type GateSubject, type GateExec } from './gate-runner';
import { validateStewardProof } from './steward-proof';
import { landGateTrailer, landGateSummary, type EpicLandGateResult } from './epic-land-gate';
import { landReadiness, checkLandDeps, type LandReadinessVerdict } from './land-authority';
import type { GateVerdict } from './coordinator-daemon';
import { loadProjectManifest, type ProjectManifest } from '../config/project-manifest';
import { recordFriction, recordFrictionOnce, getWatchState, setWatchState } from './friction-store';
import { recordEpicLand } from './epic-land-record-store.js';
import { guardPostLandTree } from './tree-integrity';
import { recordSelfLand, isSelfProject } from './deploy-service';
// shared with coordinator-live: kept there because accept-time code (acceptTimeAncestorGate,
// bp1FilterStrandedFoundations) ALSO consumes epicAutoLandAuthority — see the "shared with
// coordinator-land" markers in coordinator-live.ts.
import { getWorktreeManager, resolveEpicId, execAsync, epicAutoLandAuthority, isMissionEpic, MISSION_AUTOLAND_ARMED } from './coordinator-live';

// --- FBPE P5: cross-repo epics --------------------------------------------------
// An epic whose children span repos gets ONE accumulation branch PER target repo
// (git can't merge across repos), so the land surface raises one card per repo and
// each repo lands independently. Partition the epic's children by their resolved
// target repo. A child with NO targetProject is assigned to the tracking project,
// UNLESS the epic is genuinely cross-repo (≥1 child targets a foreign repo) — then
// that orphan can't be confidently placed and is reported `ambiguous` so the caller
// escalates a decision rather than guessing which repo's branch it should land on.
export interface EpicRepoPartition {
  /** target repo root → ids of the epic's children that land in that repo. */
  byRepo: Map<string, string[]>;
  /** child ids with no targetProject in a cross-repo epic — unplaceable. */
  ambiguous: string[];
}

/** Partition an epic's direct children by the repo their branch lands in. Exported
 *  for unit testing. */
export function partitionEpicChildrenByRepo(
  children: Todo[],
  trackingProject: string,
): EpicRepoPartition {
  const explicitRepos = new Set<string>();
  for (const c of children) if (c.targetProject) explicitRepos.add(c.targetProject);
  // Genuinely cross-repo iff some child targets a repo other than the tracking one.
  const hasForeignRepo = [...explicitRepos].some((p) => p !== trackingProject);
  const byRepo = new Map<string, string[]>();
  const ambiguous: string[] = [];
  const push = (repo: string, id: string) => {
    const arr = byRepo.get(repo);
    if (arr) arr.push(id);
    else byRepo.set(repo, [id]);
  };
  for (const c of children) {
    if (c.targetProject) {
      push(c.targetProject, c.id);
    } else if (hasForeignRepo) {
      ambiguous.push(c.id); // can't place a repo-less child once repos diverge.
    } else {
      push(trackingProject, c.id);
    }
  }
  return { byRepo, ambiguous };
}

// --- FBPE P3: the single source of epic gating children ----------------------
export interface EpicGatingChildren {
  /** Non-dropped direct children of the epic — the required-done set. Land leaves are
   *  never minted, so no `[LAND]` split is needed here anymore. */
  buildChildren: Todo[];
  /** Always empty — land leaves are never minted; `landedAt` is the source of truth.
   *  Kept so the return shape and call sites keep compiling unchanged. */
  landLeaves: Todo[];
  /** buildChildren partitioned by their resolved target repo (see partitionEpicChildrenByRepo). */
  byRepo: Map<string, string[]>;
  /** repo-less buildChildren in a genuinely cross-repo epic — unplaceable. */
  ambiguous: string[];
}

/** THE single source of an epic's gating children. Every land/promotion path derives its
 *  child set from here so the `parentId === epicId` filter lives in ONE place.
 *  The inline filter below is the ONE production copy (see the source-guard test).
 *  Exported for unit testing. */
export function epicGatingChildren(
  allTodos: Todo[],
  epicId: string,
  trackingProject: string,
): EpicGatingChildren {
  const buildChildren = allTodos.filter(
    (t) => t.parentId === epicId && t.status !== 'dropped',
  );
  const landLeaves: Todo[] = []; // land leaves are never minted; landedAt is the source of truth
  const { byRepo, ambiguous } = partitionEpicChildrenByRepo(buildChildren, trackingProject);
  return { buildChildren, landLeaves, byRepo, ambiguous };
}

// --- FBPE P4: the land click — human-gated epic→master land ---------------------
// Per-project land mutex: concurrent LAND clicks for the same target repo must not
// race two merges into master. Each land chains onto the previous one for that
// project so they serialise; the chain is fault-tolerant (a failed/throwing land
// does not wedge the next click).
const landChains = new Map<string, Promise<unknown>>();
function withLandMutex<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const prev = landChains.get(project) ?? Promise.resolve();
  // Run fn whether the previous land resolved or rejected (serialise, don't wedge).
  const next = prev.then(fn, fn);
  landChains.set(project, next.then(() => {}, () => {}));
  return next;
}

export interface LandEpicOutcome {
  ok: boolean;
  landed: boolean;
  conflict?: boolean;
  reason: string;
  epicId?: string;
  epicBranch?: string;
  masterSha?: string;
  /**
   * True when the landed epic's targetProject IS a checkout of this app's own
   * source repo (by package name, see isSelfProject) — i.e. the running :9002
   * binary is now stale against
   * master and a self-deploy is the relevant next step. The UI uses this to
   * surface the (separate, human-gated) Deploy affordance. Only meaningful on
   * a successful land.
   */
  selfLand?: boolean;
  /** Dirty paths in the main checkout when the land was refused (clean-tree guard). */
  dirtyPaths?: string[];
  /** True when a corrupted post-land tree was detected and repaired via reset --hard <landSha>. */
  treeRestored?: boolean;
}

export interface LandProof {
  ok: boolean;
  reason: string;
  detail?: string;
  gate: EpicLandGateResult;
}

/** ONE PROOF: delegates entirely to the SAME `landReadiness()` the human click and the
 *  conductor call use (src/services/land-authority.ts — "ONE LAND PROOF, THREE ACTORS").
 *  Used by BOTH surfaceEpicLand's armed-mission auto-land and landEpic's land-time
 *  re-derivation, so the identical proof gates both paths. Kept as a named wrapper (rather
 *  than inlining `landReadiness` at every call site) so `landEpic`'s land-time re-check
 *  stays textually obvious (see land-proof-single-path.test.ts's "proof precedes merge"
 *  topology check) and so callers keep the `{ok,reason,detail,gate}` shape they already
 *  expect. `epicWorktreeCwd` is pinned via the `worktreeCwd` probe so this never re-derives
 *  the worktree the caller already resolved. */
async function deriveEpicLandProof(a: {
  project: string;
  repo: string;
  epicId: string;
  epicBranch: string;
  todos: Todo[];
  epicWorktreeCwd: string;
}): Promise<LandProof> {
  const notRun: EpicLandGateResult = {
    status: 'error',
    declared: false,
    manifestPath: '',
    units: [],
    regressions: [],
    inherited: [],
    incidents: [],
    reasons: ['gate not run — land readiness failed first'],
    specFiles: [],
    epicTipSha: null,
    baseSha: null,
  };

  const readiness = await landReadiness(a.repo, a.epicId, {
    todos: a.todos,
    probes: { worktreeCwd: () => a.epicWorktreeCwd },
  });
  const gate = readiness.gate ?? notRun;

  if (!readiness.green) {
    const reason = readiness.blockers[0]?.code ?? 'land-not-ready';
    return { ok: false, reason, detail: readiness.summary, gate };
  }
  return { ok: true, reason: 'ok', gate };
}

/**
 * Surface an operator-visible warning when an AUTO-LAND was refused because the main
 * checkout is dirty (landEpic clean-tree guard, :1798). The audit row alone is invisible
 * on the auto path — no one reads it live. questionText is built from STABLE facts only
 * (epicId, epicBranch, sorted dirtyPaths) with NO per-run token, so createEscalation's
 * (project,session,questionText) dedup collapses repeats to ONE card (mirrors the F4
 * stable-dedup discipline). Pure add of a visible signal — no land/landEpic behaviour
 * changes. Returns null when the outcome is not a dirty-tree refusal (nothing to surface).
 */
export function surfaceDirtyLandBlocker(
  project: string,
  session: string,
  outcome: LandEpicOutcome,
  ctx: { epicId: string; epicBranch: string; todoId?: string | null },
): ReturnType<typeof createEscalation> | null {
  if (outcome.landed !== false || outcome.reason !== 'dirty-tree') return null;
  const dirty = [...(outcome.dirtyPaths ?? [])].sort();          // STABLE: sorted, dedup-safe
  const paths = dirty.length > 0 ? dirty.join(', ') : '(unknown)';
  const questionText =
    `⚠️ Auto-land of epic ${ctx.epicBranch} (${ctx.epicId.slice(0, 8)}) was blocked: `
    + `the main checkout has ${dirty.length} uncommitted path(s) — ${paths}. `
    + `Commit or stash them, then re-land. (master untouched)`;
  return createEscalation({
    project,
    session,
    todoId: ctx.todoId ?? null,
    kind: 'blocker',
    questionText,
  });
}

/** PURE transition for the consecutive-red counter. Given the prior counter entry (or
 *  undefined/null) and the new derivation, returns the next entry plus the actions the impure
 *  driver must take: `surface` (file the stuck card now) and `resolvePrevious` (close the
 *  previously-open card because the reason changed or the epic went green). No DB, no git. */
export function deriveStuckAutoLandAction(
  prev: { reason: string; count: number; escalationId?: string } | null | undefined,
  derivation: { green: true } | { green: false; reason: string },
): {
  next: { reason: string; count: number; escalationId?: string } | null;
  surface: boolean;
  resolvePrevious: boolean;
} {
  if (derivation.green) {
    // GREEN: clear the counter, resolve any open card.
    return { next: null, surface: false, resolvePrevious: !!prev?.escalationId };
  }
  if (prev && prev.reason === derivation.reason) {
    // SAME red reason recurs: increment; surface EXACTLY at the threshold tick.
    const count = prev.count + 1;
    return {
      next: { reason: derivation.reason, count, escalationId: prev.escalationId },
      surface: count === STUCK_AUTOLAND_THRESHOLD,
      resolvePrevious: false,
    };
  }
  // DIFFERING red reason (or first-ever red): reset to count 1, resolve the prior card.
  return {
    next: { reason: derivation.reason, count: 1 },
    surface: false,
    resolvePrevious: !!prev?.escalationId,
  };
}

/** Operator-visible card raised when the daemon auto-land has been stuck on the SAME red
 *  land-proof reason for STUCK_AUTOLAND_THRESHOLD consecutive reconcile ticks. Mirrors
 *  surfaceDirtyLandBlocker's stable-dedup discipline: questionText is composed ONLY from
 *  epicId.slice(0,8), epicBranch, and reason — NO tick count, NO timestamp, NO per-run
 *  token — so createEscalation's (project,session,questionText) dedup collapses repeats to
 *  ONE card. Pure add of a visible signal — no land/proof behaviour changes. */
export function surfaceStuckAutoLand(
  project: string,
  session: string,
  ctx: { epicId: string; epicBranch: string; reason: string },
): ReturnType<typeof createEscalation> {
  const questionText =
    `⚠️ Auto-land of epic ${ctx.epicBranch} (${ctx.epicId.slice(0, 8)}) is STUCK: `
    + `its land proof has stayed red on the same reason — ${ctx.reason}. `
    + `The daemon has retried ${STUCK_AUTOLAND_THRESHOLD}× without progress; a human should look.`;
  return createEscalation({
    project,
    session,
    todoId: null,
    kind: 'blocker',
    questionText,
  });
}

/**
 * The daemon's auto-land safety proof. There is ONE land proof (`landReadiness`) shared by
 * the human click, the conductor call, and this daemon auto-land. The ACTOR decides
 * AUTHORITY; the PROOF decides SAFETY. `auto` is a user preference about who is asked —
 * it is never a licence to land on a weaker proof.
 *
 * `repo` is the target repo for this slice of a (possibly cross-repo) epic; `todos` are the
 * TRACKING project's todos, passed through so landReadiness resolves the work-graph from
 * the tracking DB while probing git in `repo`.
 */
export async function autoLandReadiness(
  repo: string,
  epicId: string,
  todos: Todo[],
): Promise<LandReadinessVerdict> {
  return landReadiness(repo, epicId, { todos });
}

/** Consecutive same-reason red-derivation counter for the auto-land path (H4).
 *  Keyed by epicId. Tracks the last red `reason`, how many ticks in a row it has
 *  recurred, and the id of the stuck-auto-land card once surfaced (so a green /
 *  reason-change can resolve it). Module scope so it survives across reconcile ticks. */
const stuckAutoLandCounters = new Map<string, { reason: string; count: number; escalationId?: string }>();

/** Store-truth decision: should the daemon settle this epic's [LAND] leaf so the
 *  MISSION_AUTOLAND_ARMED path can land it? PURE — structural checks only (no DB,
 *  no git). The mission/active gate and the real tsc/merge/gate proof are applied
 *  by the impure driver below; this only encodes the work-graph shape. */
export function missionLandLeafPromotion(
  allTodos: Todo[],
  epicId: string,
): { promote: boolean; reason: string; landLeafId?: string; buildChildIds: string[] } {
  const epic = allTodos.find((t) => t.id === epicId);
  if (!epic || epic.status === 'done' || epic.status === 'dropped' || epic.heldAt != null) {
    return { promote: false, reason: 'epic-terminal-or-held', buildChildIds: [] };
  }
  if (epic.landedAt != null) {
    return { promote: false, reason: 'epic-already-landed', buildChildIds: [] };
  }
  const { buildChildren, landLeaves } = epicGatingChildren(allTodos, epicId, '');
  const landLeafId = landLeaves[0]?.id;
  const buildChildIds = buildChildren.map((c) => c.id);
  if (buildChildren.length === 0) return { promote: false, reason: 'no-build-children', buildChildIds };
  const allGreen = buildChildren.every(
    (c) => c.status === 'done' && c.acceptanceStatus === 'accepted',
  );
  if (!allGreen) return { promote: false, reason: 'build-not-green', landLeafId, buildChildIds };
  const depBlocker = checkLandDeps(allTodos, epicId);
  if (depBlocker) return { promote: false, reason: 'land-deps-unsatisfied', landLeafId, buildChildIds };
  return { promote: true, reason: 'ok', landLeafId, buildChildIds };
}

/** MISSION_AUTOLAND_ARMED reachability fix: rollup can never fire for a mission
 *  epic whose [LAND] leaf is still unapproved (the land leaf is a non-done child),
 *  so surfaceEpicLand is never reached. This sweep evaluates build-green mission
 *  epics DIRECTLY every reconcile tick: on a GREEN build proof (land leaf EXCLUDED
 *  from the child set) it completes the land leaf (accepted, daemon:auto) so the
 *  epic rolls up and the existing surfaceEpicLand → landEpic armed path lands it.
 *  Best-effort; never throws. */
export async function autoLandArmedMissionEpics(project: string): Promise<void> {
  if (!MISSION_AUTOLAND_ARMED) return;
  const allTodos = listTodos(project, { includeCompleted: true });
  const missionEpics = allTodos.filter(
    (t) => isEpic(t) && t.status !== 'done' && t.status !== 'dropped'
      && t.heldAt == null && isMissionEpic(project, t.id, allTodos),
  );
  for (const epic of missionEpics) {
    try {
      const decision = missionLandLeafPromotion(allTodos, epic.id);
      if (!decision.promote) continue;

      const buildChildren = allTodos.filter((t) => decision.buildChildIds.includes(t.id));
      const { byRepo } = partitionEpicChildrenByRepo(buildChildren, project);
      if (byRepo.size !== 1) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
          detail: JSON.stringify({ epicId: epic.id, missionAutoLand: 'skip', reason: 'multi-repo-mission' }) });
        continue;
      }
      const [[repo, buildIds]] = [...byRepo];
      const wm = getWorktreeManager(repo);
      const epicBranch = wm.epicBranchName(epic.id);
      // CONVERGENT STAMP (F1 leaf B): close the crash-between-merge-and-stamp window.
      // If the epic branch already merged (ahead==0) while the land leaf is still pending,
      // a crash killed us between landEpic's merge and completeTodo — converge it here.
      const converged = await convergeObservedMerge(
        project, epic.id, decision.landLeafId, () => wm.epicAheadOfMaster(epic.id),
      );
      if (converged.stamped) continue; // land converged from git ground truth; done this epic
      const epicWt = await wm.ensureEpic(epic.id).catch(() => null);
      const proof = await deriveEpicLandProof({
        project, repo, epicId: epic.id, epicBranch,
        todos: allTodos, epicWorktreeCwd: epicWt?.path ?? repo,
      });
      const proofGreen = proof.ok && proof.gate.status === 'pass';
      if (!proofGreen) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
          detail: JSON.stringify({ epicId: epic.id, missionAutoLand: 'skip', reason: `build-proof-red:${proof.reason}` }) });
        const reason = `build-proof-red:${proof.reason}`;
        const prev = stuckAutoLandCounters.get(epic.id);
        const action = deriveStuckAutoLandAction(prev, { green: false, reason });
        if (action.resolvePrevious && prev?.escalationId) resolveEscalation(prev.escalationId, 'resolved', 'ai');
        if (action.surface) {
          const card = surfaceStuckAutoLand(project, 'coordinator', { epicId: epic.id, epicBranch, reason });
          if (action.next) action.next.escalationId = card.escalation.id;
        }
        if (action.next) stuckAutoLandCounters.set(epic.id, action.next);
        else stuckAutoLandCounters.delete(epic.id);
        continue;
      }
      recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
        detail: JSON.stringify({ epicId: epic.id, missionAutoLand: 'land-leaf-land-decided', landLeafId: decision.landLeafId, stamped: false, armed: true }) });
      {
        const prev = stuckAutoLandCounters.get(epic.id);
        const action = deriveStuckAutoLandAction(prev, { green: true });
        if (action.resolvePrevious && prev?.escalationId) resolveEscalation(prev.escalationId, 'resolved', 'ai');
        stuckAutoLandCounters.delete(epic.id);
      }
      await surfaceEpicLand(project, epic.id, { sessionHint: 'coordinator', preferLinkTodoId: buildIds[0], landLeafId: decision.landLeafId });
    } catch (e) {
      recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
        detail: JSON.stringify({ epicId: epic.id, missionAutoLand: 'error', reason: e instanceof Error ? e.message : String(e) }) });
    }
  }
}

/** D1 fix (friction 9312cb98): the armed sweep above only evaluates MISSION epics
 *  (autoLandArmedMissionEpics filters on isMissionEpic), so a build-green NON-mission
 *  epic whose [LAND] leaf is still open never rolls up (land leaf is a non-done child)
 *  and is invisible to every existing sweep — it deadlocks forever. This sweep raises
 *  the SAME human 'epic-ready-to-land' card via surfaceEpicLand for such epics. It never
 *  promotes/completes the land leaf and never auto-lands: surfaceEpicLand's own
 *  landAuthorized gate (epicAutoLandAuthority — MISSION_AUTOLAND_ARMED && isMissionEpic)
 *  already refuses auto-land for a non-mission epic, so this sweep is surface-only by
 *  construction — the auto-land authority boundary (constraint 55ee9d79) is enforced by
 *  the callee, not duplicated here. Best-effort; never throws. */
export async function surfaceBuildGreenNonMissionEpics(project: string): Promise<void> {
  const allTodos = listTodos(project, { includeCompleted: true });
  const nonMissionEpics = allTodos.filter(
    (t) => isEpic(t) && t.status !== 'done' && t.status !== 'dropped'
      && t.heldAt == null && !isMissionEpic(project, t.id, allTodos),
  );
  for (const epic of nonMissionEpics) {
    try {
      const decision = missionLandLeafPromotion(allTodos, epic.id);
      if (!decision.promote) continue;
      recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
        detail: JSON.stringify({ epicId: epic.id, nonMissionLandSurface: 'build-green', landLeafId: decision.landLeafId }) });
      await surfaceEpicLand(project, epic.id, {
        sessionHint: 'coordinator',
        preferLinkTodoId: decision.buildChildIds[0],
        landLeafId: decision.landLeafId,
      });
    } catch (e) {
      recordSupervisorAudit({ kind: 'reconcile', project, session: 'coordinator',
        detail: JSON.stringify({ epicId: epic.id, nonMissionLandSurface: 'error', reason: e instanceof Error ? e.message : String(e) }) });
    }
  }
}

/** Stamp the epic's [LAND] leaf done ONLY on an observed merge. Guarded: a missing
 *  landLeafId or a non-landed outcome is a no-op — the leaf stays not-done and the
 *  next reconcile tick retries. Best-effort; the caller already wraps in try/catch. */
export async function stampLandLeafOnMerge(
  project: string, epicId: string, landLeafId: string | undefined, landed: boolean,
): Promise<boolean> {
  if (!landed) return false;
  stampEpicLandedAt(project, epicId, new Date().toISOString());
  if (!landLeafId) return true;
  await completeTodo(project, landLeafId, 'accepted', 'daemon:auto');
  return true;
}

/** Convergent (crash-window) land-leaf stamp — the inverse-direction sibling of
 *  stampLandLeafOnMerge. A process killed AFTER landEpic merges the epic branch but
 *  BEFORE completeTodo runs leaves the land leaf pending while git already carries the
 *  merge. Git is ground truth: if the epic branch is already merged (ahead==0, tip IS an
 *  ancestor of base) AND the land leaf is still pending, stamp it done with reason
 *  'observed-merged'. GUARDED to ahead==0 only — never stamps while ahead>0 (that is the
 *  inverse of the Finding-2 corrupt case, so the check is git-derived, not stamp-derived).
 *  A probe error is treated as "unknown", NOT as merged — we never stamp on doubt.
 *  Re-run on an already-done leaf is a no-op (not an error). Best-effort; never throws
 *  beyond the injected probe. */
export async function convergeObservedMerge(
  project: string,
  epicId: string,
  landLeafId: string | undefined,
  probeAhead: () => Promise<number>,
): Promise<{ stamped: boolean; reason: string; ahead?: number }> {
  if (!landLeafId) return { stamped: false, reason: 'no-land-leaf' };
  const leaf = getTodo(project, landLeafId);
  if (!leaf) return { stamped: false, reason: 'land-leaf-missing' };
  if (leaf.status === 'done') return { stamped: false, reason: 'land-leaf-already-done' };
  const ahead = await probeAhead().catch(() => -1);
  // GUARD: stamp ONLY when git confirms ahead==0 (tip is an ancestor of base). ahead>0
  // (unlanded work) and ahead<0 (probe error/unknown) both refuse — git-derived, not
  // stamp-derived.
  if (ahead !== 0) {
    return { stamped: false, reason: ahead > 0 ? 'epic-ahead' : 'ahead-unknown', ahead };
  }
  await completeTodo(project, landLeafId, 'accepted', 'daemon:auto');
  stampEpicLandedAt(project, epicId, new Date().toISOString());
  recordSupervisorAudit({
    kind: 'reconcile', project, session: 'coordinator',
    detail: JSON.stringify({ epicId, landLeafId, convergentStamp: 'observed-merged', ahead: 0 }),
  });
  return { stamped: true, reason: 'observed-merged', ahead: 0 };
}

/**
 * Surface (and, at level>=drive, AUTO-LAND) the epic-ready-to-land card(s) for a
 * rolled-up epic. Extracted from completeTodo so the reconcile-pass sweep can call
 * the IDENTICAL logic every tick — making the land surface SELF-HEALING (it catches
 * epics that rolled up out-of-band, the exact stranded-work incident). Best-effort;
 * never throws. createEscalation dedups on (project,session,questionText,open) so a
 * stable card is not re-raised every tick.
 *
 * AUTO-LAND (design-epic-landing P2): on a GREEN proof at level>=drive it calls the
 * existing landEpic — which re-derives the proof, lands behind the per-project mutex,
 * and on conflict leaves master UNTOUCHED + re-surfaces a rebase card. Dormant at the
 * default 'build' level: landing only happens automatically once a human sets the
 * project to 'drive'. Red proof or level<drive → the card just surfaces (human lands).
 */
export async function surfaceEpicLand(
  project: string,
  epicId: string,
  opts: { sessionHint?: string; preferLinkTodoId?: string; landLeafId?: string } = {},
): Promise<void> {
  const session = opts.sessionHint || 'coordinator';
  const id = opts.preferLinkTodoId;
  try {
    const allTodos = listTodos(project, { includeCompleted: true });
    const missionEpic = isMissionEpic(project, epicId, allTodos);
    const { byRepo, ambiguous } = epicGatingChildren(allTodos, epicId, project);

    // Can't cleanly partition (cross-repo epic with repo-less children) → escalate a
    // decision instead of guessing which repo's branch to land. Never auto-landed.
    if (ambiguous.length > 0) {
      const repos = [...byRepo.keys()];
      createEscalation({
        project,
        session,
        todoId: id ?? null,
        kind: 'decision',
        questionText: `Epic ${epicId.slice(0, 8)} spans repos ${repos.map((p) => path.basename(p)).join(', ')}, but ${ambiguous.length} child todo(s) have no targetProject so they can't be assigned to a repo to land. Assign a targetProject to each, then re-land.`,
        options: [
          { id: 'tracking', label: `Treat as ${path.basename(project)}`, detail: `Land the orphan child(ren) with the tracking repo ${project}.` },
          { id: 'fix', label: 'Assign targetProject manually', detail: 'Set each orphan child\'s targetProject, then re-trigger the land surface.' },
        ],
        recommended: 'fix',
      });
      recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: id, epicId, landSurface: 'ambiguous-partition', ambiguous: ambiguous.length, repos }) });
      return;
    }

    const multiRepo = byRepo.size > 1;
    for (const [repo, repoChildIds] of byRepo) {
      const wm = getWorktreeManager(repo);
      const epicBranch = wm.epicBranchName(epicId);
      const epic = await wm.ensureEpic(epicId).catch(() => null);
      // ONE PROOF: the same landReadiness() the human click and the conductor call use
      // (src/services/land-authority.ts — "ONE LAND PROOF, THREE ACTORS") both drives the
      // card text below AND gates the auto-land further down — computed exactly once, so
      // there is no second, weaker derivation that could disagree with what the card says.
      const readiness = await landReadiness(repo, epicId, {
        todos: allTodos,
        probes: { worktreeCwd: () => epic?.path ?? repo },
      });
      const proofGreen = readiness.green;
      const missionLandAuthority = epicAutoLandAuthority(project, epicId, allTodos) && proofGreen;
      const landAuthorized = missionLandAuthority;
      // Staleness FLAG (never auto-rebase): how far behind master the epic base drifted.
      const behind = await wm.epicBehindBase(epicId).catch(() => 0);
      const staleFlag = behind > 0 ? ` ⚠️ ${behind} commit(s) behind master (flag only — no auto-rebase)` : '';
      const repoTag = multiRepo ? ` [repo ${path.basename(repo)}]` : '';
      const proofSummary = proofGreen
        ? `✅ epic-landable: ${repoChildIds.length} children done+accepted, tsc clean, dry-merge into master clean, ${readiness.gate ? landGateSummary(readiness.gate) : 'no gate declared'}`
        : `❌ blocked (${readiness.blockers.map((b) => b.code).join(', ') || 'not-ready'}): epic ${epicBranch} is NOT ready to land`;
      // Link a child IN THIS REPO so the land click resolves the right repo
      // (landEpic keys the WorktreeManager off the linked todo's targetProject).
      const linkTodoId = epicId;
      const { escalation } = createEscalation({
        project,
        session,
        todoId: linkTodoId,
        kind: 'epic-ready-to-land',
        questionText: `Epic ${epicBranch} (${epicId.slice(0, 8)})${repoTag} rolled up. ${proofSummary}${staleFlag}. Land onto master? (read-only surface — master untouched)`,
      });
      recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ todoId: linkTodoId, epicId, epicBranch, repo, landable: proofGreen, reason: readiness.blockers.map((b) => b.code).join(',') || 'ok', landGate: readiness.gate?.status ?? 'unknown', children: repoChildIds.length, behindMaster: behind, multiRepo, missionEpic, missionLandAuthority, armed: MISSION_AUTOLAND_ARMED }) });

      // AUTO-LAND at level>=drive on a green proof — reuse the safe landEpic path
      // (re-derives the proof, lands behind the mutex, conflict→rebase card). The
      // dedup above ensures we don't re-fire on an already-open card.
      if (proofGreen && landAuthorized && escalation?.id) {
        const outcome = await landEpic(project, escalation.id);
        const stamped = await stampLandLeafOnMerge(project, epicId, opts.landLeafId, outcome.landed);
        recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ epicId, epicBranch, autoLand: true, landed: outcome.landed, conflict: outcome.conflict ?? false, reason: outcome.reason, landLeafId: opts.landLeafId ?? null, stamped }) });
        // Dirty-tree auto-land refusals are otherwise audit-only + invisible on the auto
        // path — surface an operator-visible blocker naming the uncommitted path(s).
        surfaceDirtyLandBlocker(project, session, outcome, { epicId, epicBranch, todoId: linkTodoId });
      } else {
        recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({
          epicId, epicBranch, landSurface: 'land-skipped',
          proofGreen, landAuthorized, escalationId: escalation?.id ?? null,
          failedConjunct: !proofGreen ? 'proof-red'
            : !landAuthorized ? 'land-unauthorized'
            : 'escalation-id-missing',
        }) });
      }
    }
  } catch (e) {
    recordSupervisorAudit({ kind: 'reconcile', project, session, detail: JSON.stringify({ epicId, landSurface: 'failed', reason: e instanceof Error ? e.message : String(e), preferLinkTodoId: id }) });
  }
}

/** Machine-checkable verdict for the land path (L3): an epic L1 flagged stale was
 *  forward-integrated and re-gated in its accumulation worktree. */
export type RevalidateResult =
  | { ok: true; note?: 'no-gate' }                                  // gate green (or no gate applies)
  | { ok: false; reason: 'forward-integrate-conflict'; conflictedPaths: string[] }
  | { ok: false; reason: 'revalidation-gate-failed'; output: string }
  | { ok: false; reason: 'non-git' | 'epic-missing' };             // could not provision/integrate

/** Seam for testing: stub forwardIntegrate + the gate without real git. Defaults
 *  bind to the live WorktreeManager + runRegistryGate for `project`. */
export interface RevalidateDeps {
  forwardIntegrate(epicId: string, baseRef: string): Promise<ForwardIntegrateResult>;
  ensureEpicPath(epicId: string): Promise<string | null>;
  runGate(subject: GateSubject): Promise<GateVerdict | null>;
  manifest: ProjectManifest | null;
  getEpicTodo(epicId: string): Todo | null;
  exec: GateExec;
}

/**
 * Forward-integrate trunk into an epic's accumulation worktree and re-run the
 * project's acceptance gate *inside* that epic worktree. Cross-project aware:
 * `project` is the target project (child.targetProject ?? project as resolved by
 * the L3 caller, matching landEpic's targetProject resolution).
 */
export async function revalidateStaleEpic(
  project: string,
  epicId: string,
  baseRef: string = 'master',
  deps?: Partial<RevalidateDeps>,
): Promise<RevalidateResult> {
  const wm = getWorktreeManager(project);
  const d: RevalidateDeps = {
    forwardIntegrate: (e, b) => wm.forwardIntegrateEpic(e, b),
    ensureEpicPath: async (e) => (await wm.ensureEpic(e).catch(() => null))?.path ?? null,
    runGate: runRegistryGate,
    manifest: loadProjectManifest(project),
    getEpicTodo: (e) => getTodo(project, e),
    exec: execAsync,
    ...deps,
  };

  // 1. Forward-integrate trunk INTO the epic branch.
  const fi = await d.forwardIntegrate(epicId, baseRef);
  if (fi.conflict) {
    return { ok: false, reason: 'forward-integrate-conflict', conflictedPaths: fi.conflictedPaths ?? [] };
  }
  // skippedReason (non-git / trunk-missing / dirty) is NOT a conflict — proceed to gate
  // on the current epic tip (no worse than today; matches forwardIntegrate's own contract).

  // 2. Resolve the epic worktree (where deps resolve) + re-run the gate THERE.
  const epicPath = await d.ensureEpicPath(epicId);
  if (!epicPath) return { ok: false, reason: 'epic-missing' };

  const verdict = await d.runGate({
    project,
    gateProject: project,
    todoId: epicId,
    todo: d.getEpicTodo(epicId),
    manifest: d.manifest,
    exec: d.exec,
    laneCwd: epicPath,        // ← runs the manifest gateCommand IN the epic worktree (f27d5e91 rule)
    // integrationBase intentionally omitted: re-validate the FULL epic, not a change-set.
  });

  // 3. Verdict → machine-checkable result.
  if (verdict === null) return { ok: true, note: 'no-gate' };   // no applicable gate — honor self-report
  if (verdict.passed) return { ok: true };
  return { ok: false, reason: 'revalidation-gate-failed', output: (verdict.reasons ?? []).join('\n') };
}

/**
 * Advisory project-digest refresh, invoked on a successful epic land.
 * Gated behind the per-project projectDigestEnabled flag. Deterministic
 * digest sections always regenerate; the LLM map is reused unless the
 * skeleton hash changed (handled inside regenerateProjectDigest). A refresh
 * failure is swallowed — it must NEVER fail a completed land.
 * deps are injectable purely so this is unit-testable without a real land.
 */
export async function refreshProjectDigestOnLand(
  project: string,
  deps?: {
    refreshDigest?: (project: string) => void | Promise<void>;
    digestEnabled?: (project: string) => boolean;
    digestLlm?: DigestLlm;
  },
): Promise<void> {
  try {
    const enabled = deps?.digestEnabled ?? getProjectDigestEnabled;
    if (!enabled(project)) return;
    const refresh =
      deps?.refreshDigest ??
      ((p: string) =>
        regenerateProjectDigest(p, { llm: deps?.digestLlm ?? makeDigestLlm(p) }).then(() => {}));
    await refresh(project);
  } catch {
    /* advisory — a digest refresh must never fail a completed land */
  }
}

/**
 * The land click (FBPE P4). Given an open 'epic-ready-to-land' escalation, RE-DERIVE
 * land-readiness server-side at click time (never trust the summary baked into the
 * card at roll-up) and, on a green proof, perform ONE --no-ff epic→master merge behind
 * the per-project land mutex, then remove the epic branch/worktree and resolve the
 * card. A conflict leaves master UNTOUCHED and re-surfaces a 'needs human rebase, then
 * re-land' escalation (the original card stays open).
 */
export async function landEpic(
  project: string,
  escalationId: string,
  opts?: { allowDirty?: boolean },
): Promise<LandEpicOutcome> {
  const esc = getEscalation(escalationId);
  if (!esc) return { ok: false, landed: false, reason: 'escalation-not-found' };
  if (esc.kind !== 'epic-ready-to-land') return { ok: false, landed: false, reason: 'not-a-land-escalation' };
  const todoId = esc.todoId;
  if (!todoId) return { ok: false, landed: false, reason: 'no-todo-link' };
  const child = getTodo(project, todoId);
  if (!child) return { ok: false, landed: false, reason: 'todo-not-found' };
  const targetProject = child.targetProject ?? project;
  const epicId = resolveEpicId(child, project);
  const wm = getWorktreeManager(targetProject);
  const epicBranch = wm.epicBranchName(epicId);

  return withLandMutex(targetProject, async (): Promise<LandEpicOutcome> => {
    try {
      // Clean-tree guard: refuse a land when the main checkout has uncommitted/untracked
      // changes unless the caller explicitly passes allowDirty (operator override).
      const dirty = await wm.dirtyPaths().catch(() => [] as string[]);
      if (dirty.length > 0) {
        if (!opts?.allowDirty) {
          recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'refused', reason: 'dirty-tree', dirtyPaths: dirty }) });
          return {
            ok: false, landed: false, reason: 'dirty-tree', epicId, epicBranch, dirtyPaths: dirty,
          };
        }
        // allowDirty: proceed, but make the override loud + durable.
        console.warn(`[land] allowDirty override — main checkout dirty:\n${dirty.map((p) => `  ${p}`).join('\n')}`);
        try {
          await recordFriction(targetProject, {
            layer: 'orchestration',
            retryReason: 'land-allow-dirty',
            todoId: epicId,
            detail: `land of epic ${epicBranch} proceeded over a dirty main checkout (allowDirty). paths: ${dirty.join(', ')}`,
          });
        } catch { /* best-effort */ }
      }

      // Fail-fast: RE-DERIVE steward predicates (cheap check, fail immediately on storev
      // truth failure). Skip deriveEpicLandProof here; we'll run it after forward-integration.
      // Exclude the epic's own [LAND] leaf: it is stamped done AFTER the merge lands
      // (stampLandLeafOnMerge), so counting it as a required-done child would deadlock every
      // auto-land (epic-children-incomplete). Mirrors surfaceEpicLand's pre-check filter.
      const todosAtProofTime = listTodos(project, { includeCompleted: true });
      const { buildChildren, byRepo } = epicGatingChildren(todosAtProofTime, epicId, project);
      const epicChildIds = byRepo.get(targetProject) ?? buildChildren.map((t) => t.id);
      const epic = await wm.ensureEpic(epicId).catch(() => null);
      const verdict = validateStewardProof(
        'land_epic',
        { kind: 'epic-landable', epicId, epicBranch },
        {
          project,
          dependsOn: [],
          getDep: (cid) => {
            const d = getTodo(project, cid);
            return d ? { id: d.id, status: d.status, acceptanceStatus: d.acceptanceStatus } : null;
          },
          epicChildIds,
          epicWorktreeCwd: epic?.path ?? targetProject,
          masterCwd: targetProject,
        },
      );
      if (!verdict.ok) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'rejected', reason: verdict.reason }) });
        return { ok: false, landed: false, reason: verdict.reason, epicId, epicBranch };
      }

      // L3 — LAND-TIME FRESHNESS GUARD. Before advancing trunk, check whether the epic's
      // build-base drifted from CURRENT trunk (L1 `epicBuildBaseStaleness`). If stale,
      // forward-integrate trunk + re-run the gate INSIDE the epic worktree (L2
      // `revalidateStaleEpic`, where deps resolve) so we never advance trunk on a tree that
      // was only ever gated against an OLDER trunk tip — the semantic-drift / build123d
      // importorskip false-green class. FRESH → fall straight through to the merge (the fast,
      // common path; no behaviour change). STALE + revalidation-fail → master UNTOUCHED, raise
      // one escalation, refuse. Both land routes inherit this: the human land_epic MCP path AND
      // the daemon auto-land (reconcile-pass surfaceEpicLand → landEpic at level>=drive) call
      // THIS function. (The OI-1 reachability reconcile's landEpicToMaster lands a leaf onto the
      // INTEGRATION ref during acceptance — not trunk at epic-completion — so it is intentionally
      // NOT guarded here.)
      const staleness = await wm.epicBuildBaseStaleness(epicId).catch(() => null);
      if (staleness?.stale) {
        const rev = await revalidateStaleEpic(targetProject, epicId);
        if (!rev.ok) {
          const failReason = `stale-build-base:${rev.reason}`;
          const detail =
            rev.reason === 'forward-integrate-conflict'
              ? `re-integration hit a merge conflict (${rev.conflictedPaths.join(', ') || 'unknown'})`
              : rev.reason === 'revalidation-gate-failed'
                ? `the re-run gate FAILED:\n${rev.output}`
                : rev.reason;
          createEscalation({
            project,
            session: esc.session,
            todoId,
            kind: 'assumption-invalidated',
            questionText:
              `Land blocked — epic ${epicBranch} was built against a stale trunk base ` +
              `(${staleness.commitsAhead} trunk commit(s) ahead; ${staleness.reason}` +
              `${staleness.overlap.length ? `; overlapping files: ${staleness.overlap.join(', ')}` : ''}). ` +
              `${detail}. Master is UNTOUCHED — merge master into ${epicBranch}, resolve/fix, re-gate, then re-land.`,
          });
          recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'refused', reason: failReason, commitsAhead: staleness.commitsAhead, overlap: staleness.overlap }) });
          return { ok: false, landed: false, reason: failReason, epicId, epicBranch };
        }
        // rev.ok → epic now carries trunk + re-gated green → fall through to the real merge.
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'revalidated', commitsAhead: staleness.commitsAhead, reason: staleness.reason }) });
      }

      // Run the land proof (ONE PROOF — landReadiness: deps + tsc + dry-merge + G9 presence +
      // G10 gate) — re-derives after any forward-integration so it is authoritative against
      // the current epic tip. Tighten the auto-land path: never bypass a check, never
      // auto-land if the gate is misconfigured or missing.
      const proof = await deriveEpicLandProof({
        project,
        repo: targetProject,
        epicId,
        epicBranch,
        todos: todosAtProofTime,
        epicWorktreeCwd: epic?.path ?? targetProject,
      });
      if (!proof.ok) {
        createEscalation({
          project,
          session: esc.session,
          todoId,
          kind: 'assumption-invalidated',
          questionText: `Land blocked — ${proof.reason} (tip ${epicBranch.slice(0, 8)}). Master is UNTOUCHED.\n${proof.detail}`,
        });
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'refused', reason: proof.reason, regressions: proof.gate.regressions.map(u => u.files).flat(), inherited: proof.gate.inherited.length }) });
        await recordFriction(targetProject, { layer: 'orchestration', retryReason: 'land-gate-failed', todoId: epicId, detail: proof.detail ?? proof.reason }).catch(() => {});
        return { ok: false, landed: false, reason: proof.reason, epicId, epicBranch };
      }

      // L4 — LAND-TIME OPEN-CHILDREN HOLD (friction c31ef24f): re-check the epic's
      // children against LIVE store state, not the epicChildIds snapshot taken
      // above (line ~2101) or any earlier promotion-time snapshot — a sibling
      // leaf dropped-and-replaced (or any newly-filed child) between that
      // snapshot and this point must not slip through. checkLandDeps already
      // excludes the [LAND] leaf itself and treats a dropped child as
      // non-gating while still requiring every OTHER open child closed. A
      // blocker here HOLDS (defer, re-evaluated next tick) — it never parks a
      // new escalation; the existing epic-ready-to-land card stays open.
      const freshTodosAtLandTime = listTodos(project, { includeCompleted: true });
      const openChildBlocker = checkLandDeps(freshTodosAtLandTime, epicId);
      if (openChildBlocker) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'held', reason: 'open-children-at-land-time', detail: openChildBlocker.message }) });
        return { ok: false, landed: false, reason: 'open-children-at-land-time', epicId, epicBranch };
      }

      // Green proof → perform the real single --no-ff epic→master merge.
      const land = await wm.landEpicToMaster(epicId, {
        ...(dirty.length > 0 && opts?.allowDirty ? { allowDirtyPaths: dirty } : {}),
        extraTrailers: landGateTrailer(proof.gate),
      });
      if (land.conflict) {
        // Master untouched. Re-surface as a human-rebase request; the ready-to-land
        // card stays open so the human can re-land after resolving.
        createEscalation({
          project,
          session: esc.session,
          todoId,
          kind: 'assumption-invalidated',
          questionText: `Land conflict: epic ${epicBranch} did not merge cleanly into master (master untouched). Rebase ${epicBranch} onto master, resolve conflicts, then re-land.`,
        });
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'conflict' }) });
        // DF2: silently capture the land-merge conflict as operational friction (deduped
        // per-epic edge — record once until a later land of this epic succeeds).
        try {
          const fkey = `watch:land-conflict:${epicId.slice(0, 8)}`;
          if (getWatchState(targetProject, fkey) !== 'conflict') {
            await recordFriction(targetProject, {
              layer: 'operational',
              retryReason: 'land-merge-conflict',
              detail: `epic ${epicBranch} did not merge cleanly into master (master untouched). reason=${land.reason ?? 'epic-merge-conflict'}`,
            });
            await setWatchState(targetProject, fkey, 'conflict');
          }
        } catch { /* best-effort */ }
        return { ok: false, landed: false, conflict: true, reason: 'epic-merge-conflict', epicId, epicBranch };
      }
      if (!land.landed) {
        recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'failed', reason: land.reason }) });
        return { ok: false, landed: false, reason: land.reason ?? 'land-failed', epicId, epicBranch };
      }

      // Landed — persist the durable land-record BEFORE teardown removes the branch
      // (epicHeadSha reads refs/heads/<epicBranch>, which removeEpic deletes).
      const epicTipSha = await wm.epicHeadSha(epicId).catch(() => null);
      if (epicTipSha) {
        try {
          recordEpicLand(targetProject, {
            epicId,
            epicTipSha,
            landedMergeSha: land.masterSha ?? '',
            landedAt: Date.now(),
          });
        } catch { /* advisory — must never fail a completed land */ }
      }

      // Remove the epic branch + worktree (gated on land success), resolve the card.
      try {
        await wm.removeEpic(epicId, targetProject);
      } catch (err) {
        await recordFrictionOnce(targetProject, {
          layer: 'operational',
          retryReason: 'landed-epic-teardown-failed',
          todoId: epicId,
          detail: `removeEpic(${epicId}) failed after a successful land of ${epicBranch}: ${err instanceof Error ? err.message : String(err)}`,
        }).catch(() => {});
      }
      try { await setWatchState(targetProject, `watch:land-conflict:${epicId.slice(0, 8)}`, 'landed'); } catch { /* best-effort */ }

      let treeRestored = false;
      const trackedDirty = await wm.trackedDirtyPaths().catch(() => dirty);
      const guard = guardPostLandTree(targetProject, {
        masterSha: land.masterSha,
        baseRef: land.baseRef,
        trackedDirty,
      });

      if (guard.mismatch && guard.skippedUnsafe) {
        // Tree mismatch but unsafe to restore: either tracked-dirty work or checkout on non-base branch.
        // Do NOT auto-restore; surface for manual reconciliation.
        createEscalation({
          project, session: esc.session, todoId,
          kind: 'blocker',
          questionText:
            `⚠️ Post-land tree drift detected on ${targetProject} but NOT auto-restored: ` +
            `after landing ${epicBranch} at ${land.masterSha}, the checkout's index tree ` +
            `(${guard.before.workTree}) did not match HEAD^{tree} (${guard.before.headTree}). ` +
            (guard.trackedDirtyCount > 0
              ? `${guard.trackedDirtyCount} tracked path(s) have uncommitted changes. `
              : '') +
            (guard.trackedDirtyCount > 0 && !guard.onBaseRef
              ? `Checkout is on branch other than ${land.baseRef ?? 'master'}. `
              : !guard.onBaseRef
              ? `Checkout is on branch other than ${land.baseRef ?? 'master'}, not on base ref. `
              : '') +
            `Commit or stash dirty work and switch to the base branch, then manually sync the checkout. ` +
            (guard.divergentFiles.length > 0 ? `Divergent tracked files: ${guard.divergentFiles.join(', ')}.` : ''),
        });
        recordSupervisorAudit({
          kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({
            escalationId, epicId, epicBranch, land: 'tree-drift-unsafe-skip',
            landSha: land.masterSha, workTree: guard.before.workTree, headTree: guard.before.headTree,
            onBaseRef: guard.onBaseRef, trackedDirtyCount: guard.trackedDirtyCount,
            ...(guard.divergentFiles.length > 0 ? { divergentFiles: guard.divergentFiles } : {}),
          })
        });
        await recordFriction(targetProject, {
          layer: 'orchestration', retryReason: 'post-land-tree-drift-skipped', todoId: epicId,
          detail: `landSha=${land.masterSha} onBaseRef=${guard.onBaseRef} trackedDirty=${guard.trackedDirtyCount}` +
            (guard.divergentFiles.length > 0 ? ` divergentFiles=${guard.divergentFiles.join(',')}` : '')
        }).catch(() => {});
      } else if (guard.mismatch && !guard.skippedUnsafe) {
        // Tree mismatch and safe to restore (no tracked dirty, on base ref).
        treeRestored = guard.restored;
        createEscalation({
          project, session: esc.session, todoId,
          kind: 'assumption-invalidated',
          operatorGated: true,
          questionText:
            `Post-land tree corruption on ${targetProject}: after landing ${epicBranch} at ` +
            `${land.masterSha}, the checkout's index tree (${guard.before.workTree}) did not match ` +
            `HEAD^{tree} (${guard.before.headTree}). Corrupted index snapshotted at ` +
            `${guard.snapshotRef ?? '(snapshot FAILED)'}. Restore ${guard.restored ? 'succeeded' : 'FAILED'}.`
            + (guard.divergentFiles.length > 0 ? ` Divergent tracked files: ${guard.divergentFiles.join(', ')}.` : ''),
        });
        recordSupervisorAudit({
          kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({
            escalationId, epicId, epicBranch, land: 'tree-corrupt',
            landSha: land.masterSha, workTree: guard.before.workTree, headTree: guard.before.headTree,
            snapshotRef: guard.snapshotRef, restored: guard.restored,
            ...(guard.divergentFiles.length > 0 ? { divergentFiles: guard.divergentFiles } : {}),
          })
        });
        await recordFriction(targetProject, {
          layer: 'orchestration', retryReason: 'post-land-tree-corrupt', todoId: epicId,
          detail: `landSha=${land.masterSha} snapshot=${guard.snapshotRef}` +
            (guard.divergentFiles.length > 0 ? ` divergentFiles=${guard.divergentFiles.join(',')}` : '')
        }).catch(() => {});
        if (!guard.restored) {
          return { ok: false, landed: true, reason: 'post-land-tree-corrupt', epicId, epicBranch, masterSha: land.masterSha, treeRestored: false };
        }
      }

      resolveEscalation(escalationId, 'resolved', 'ai');
      try {
        const { unverifyCriteriaForLandedPaths } = await import('./mission-store.ts');
        const affected = unverifyCriteriaForLandedPaths(project, land.landedPaths ?? [], { landedSha: land.masterSha });
        if (affected.length > 0) {
          recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, unverified: affected.length, criteria: affected.map((a) => a.criterionId) }) });
        }
      } catch { /* best-effort — never fail a completed land on the un-verify */ }
      const selfLand = isSelfProject(targetProject);
      // Stamp the self-land so the deploy-status surface can flag the running
      // binary as stale even when the version string didn't change.
      if (selfLand) recordSelfLand(Date.now());
      recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'landed', masterSha: land.masterSha, selfLand }) });
      // Advisory: refresh the landed project's digest (gated on the flag, never
      // fails the land). See refreshProjectDigestOnLand.
      await refreshProjectDigestOnLand(targetProject);
      return { ok: true, landed: true, reason: 'ok', epicId, epicBranch, masterSha: land.masterSha, selfLand, treeRestored };
    } catch (e) {
      recordSupervisorAudit({ kind: 'reconcile', project, session: esc.session, detail: JSON.stringify({ escalationId, epicId, epicBranch, land: 'error', reason: e instanceof Error ? e.message : String(e) }) });
      return { ok: false, landed: false, reason: e instanceof Error ? e.message : String(e), epicId, epicBranch };
    }
  });
}

// --- Stranded-EPIC self-heal (accepted ⇒ landed, at the epic level) --------------
// sweepStrandedAccepted (above) SKIPS epics ("epics carry no commit of their own").
// But a done+accepted EPIC whose accumulation branch is still AHEAD of master is a
// real strand — surfaceEpicLand only runs for epics that roll up THIS reconcile pass
// (sweepEpicRollups.rolledUp), so an epic that rolled up OUT OF BAND (e.g. its land
// leaf was override-accepted), or whose land was refused-then-cleared (dirty-tree),
// never re-surfaces. It sits done-but-unlanded forever. This closes that hole:
// re-run surfaceEpicLand for each done+accepted epic still `epicAheadOfMaster > 0`.
// surfaceEpicLand is idempotent — it dedups the land card and, at level 'auto',
// re-derives the proof and lands via the safe landEpic path. Bounded + throttled
// (one `git rev-list --count` per candidate). Never throws.
export const STRANDED_EPIC_SWEEP_INTERVAL_MS = 90 * 1000; // ~3 ticks — prompt but not per-tick
export const STRANDED_EPIC_MAX_GIT_CHECKS = 30;
const lastStrandedEpicSweepAt = new Map<string, number>();

/** Pure: the done+accepted epics that are stranded-acceptance CANDIDATES. The git
 *  ahead-of-master filter (the impure part) is applied by the sweep. Exported for test. */
export function strandedEpicCandidates(todos: Todo[]): Todo[] {
  return todos.filter((t) => t.kind === 'epic' && t.status === 'done' && t.acceptanceStatus === 'accepted');
}

export async function sweepStrandedEpics(
  project: string,
  opts?: { force?: boolean; now?: number },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  const last = lastStrandedEpicSweepAt.get(project) ?? 0;
  if (!opts?.force && now - last < STRANDED_EPIC_SWEEP_INTERVAL_MS) return [];
  lastStrandedEpicSweepAt.set(project, now);

  const resurfaced: string[] = [];
  const candidates = strandedEpicCandidates(listTodos(project, { includeCompleted: true }));
  let gitChecks = 0;
  for (const epic of candidates) {
    if (gitChecks >= STRANDED_EPIC_MAX_GIT_CHECKS) break;
    try {
      const wm = getWorktreeManager(epic.targetProject ?? project);
      if (!(await wm.isGitRepoPublic())) continue;
      gitChecks++;
      const ahead = await wm.epicAheadOfMaster(epic.id);
      if (ahead <= 0) continue; // landed / branch gone → nothing to do
      // Done+accepted but still ahead of master → re-surface. Idempotent (dedups the
      // card; auto-lands at level 'auto' via the same safe path the rollup uses).
      await surfaceEpicLand(project, epic.id, { sessionHint: 'coordinator' });
      resurfaced.push(epic.id);
    } catch { /* one bad epic never aborts the sweep */ }
  }
  if (resurfaced.length > 0) {
    recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: 'coordinator',
      detail: JSON.stringify({ source: 'reconcile-pass', strandedEpicResurface: resurfaced }),
    });
  }
  return resurfaced;
}
