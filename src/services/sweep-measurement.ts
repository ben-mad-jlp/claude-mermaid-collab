/**
 * Composed convergence+land sweep measurement primitive: a read-mostly (GC is the
 * only mutation) pass that force-runs, in dependency order, the mission-queue
 * promotion, landed-at divergence check, epic-branch GC, a post-GC re-probe, and a
 * queue-starvation check — returning one structured snapshot a caller can diff
 * across two consecutive runs to test idempotence.
 *
 * Everything is injectable (`probe`, `runner`, `baseRef`) mirroring
 * landed-epic-sweep.ts's seam pattern, so this is hermetically unit-testable.
 */
import { listTodos } from './todo-store.js';
import {
  type GitProbe,
  buildEpicBranchStatus,
  makeGitProbe,
  epicBranchName,
} from './epic-branch-status.js';
import { findLandedAtDivergence, type AheadLookup } from './invariant-check.js';
import {
  gcEpicBranches,
  makeBranchGcRunner,
  type BranchGcRunner,
  type GcEpicBranchesResult,
} from './landed-epic-sweep.js';
import {
  promoteQueuedMissions,
  listMissions,
  sessionHasActiveMission,
  isMissionTerminal,
  type MissionSummary,
} from './mission-store.js';

export interface SweepMeasurement {
  project: string;
  promoted: string[];
  landedAtDivergence: { count: number; ids: string[] };
  gcDeleted: string[];
  gcFlagged: string[];
  fullyOnMasterBranchesRemaining: string[];
  sessionsZeroActiveWithQueuedApproved: string[];
}

export interface RunSweepMeasurementOpts {
  probe?: GitProbe;
  runner?: BranchGcRunner;
  baseRef?: string;
}

/**
 * Force-runs the composed sweep in dependency order: mission-queue promotion must
 * happen before the queue-starvation check (step 5) is computed, since promotion
 * changes which missions are active. GC (step 3) must happen before the post-GC
 * re-probe (step 4), since GC may delete branches that change ahead/exists.
 */
export function runSweepMeasurement(
  project: string,
  opts: RunSweepMeasurementOpts = {},
): SweepMeasurement {
  const probe = opts.probe ?? makeGitProbe(project);
  const runner = opts.runner ?? makeBranchGcRunner(project);
  const baseRef = opts.baseRef ?? 'master';
  // Prefilter (crit-5): with the REAL probe, enumerate collab/epic/* once per report so
  // probing is bounded by existing branches, not epic-todo count. Injected-probe tests
  // keep their exact old semantics (no prefilter).
  const listBranches = opts.probe ? undefined : () => runner.listEpicBranches();

  // 1. mission queue promotion — fail-open
  let promoted: string[] = [];
  try {
    promoted = promoteQueuedMissions(project);
  } catch {
    promoted = [];
  }

  // 2. landed-at divergence, using the same AheadLookup recipe as
  //    invariant-check.ts's checkInvariants (todos -> buildEpicBranchStatus -> Map).
  let landedAtDivergence: { count: number; ids: string[] } = { count: 0, ids: [] };
  try {
    const todosBefore = listTodos(project, { includeCompleted: true });
    const branchReportBefore = buildEpicBranchStatus(todosBefore, probe, baseRef, project, listBranches);
    const aheadById = new Map(branchReportBefore.epics.map((e) => [e.epicId, e.ahead]));
    const aheadOf: AheadLookup = (epicId) => aheadById.get(epicId);
    const violations = findLandedAtDivergence(todosBefore, aheadOf);
    landedAtDivergence = { count: violations.length, ids: violations.map((v) => v.todoId) };
  } catch {
    landedAtDivergence = { count: 0, ids: [] };
  }

  // 3. branch GC — fail-open
  let gcResult: GcEpicBranchesResult = { deleted: [], flagged: [], skipped: 0 };
  try {
    gcResult = gcEpicBranches(project, { probe, runner, baseRef, listBranches });
  } catch {
    gcResult = { deleted: [], flagged: [], skipped: 0 };
  }

  // 4. post-GC re-probe for fullyOnMasterBranchesRemaining — a genuinely separate
  //    listTodos + buildEpicBranchStatus call, since GC may have changed exists/ahead.
  let fullyOnMasterBranchesRemaining: string[] = [];
  try {
    const todosAfter = listTodos(project, { includeCompleted: true });
    const branchReportAfter = buildEpicBranchStatus(todosAfter, probe, baseRef, project, listBranches);
    fullyOnMasterBranchesRemaining = branchReportAfter.epics
      .filter((e) => e.exists && (e.ahead ?? -1) === 0)
      .map((e) => epicBranchName(e.epicId));
  } catch {
    fullyOnMasterBranchesRemaining = [];
  }

  // 5. sessions with an approved queued candidate but no active non-terminal mission
  let sessionsZeroActiveWithQueuedApproved: string[] = [];
  try {
    const missions = listMissions(project);
    const bySession = new Map<string, MissionSummary[]>();
    for (const m of missions) {
      const session = m.ownerSession;
      if (!session) continue;
      const arr = bySession.get(session) ?? [];
      arr.push(m);
      bySession.set(session, arr);
    }
    const flagged: string[] = [];
    for (const [session, sessionMissions] of bySession) {
      const hasApprovedQueuedCandidate = sessionMissions.some(
        (m) =>
          !m.mission.active &&
          m.mission.awaitingApprovalSince == null &&
          m.mission.queuePos != null &&
          !isMissionTerminal(m.mission),
      );
      if (hasApprovedQueuedCandidate && !sessionHasActiveMission(project, session)) {
        flagged.push(session);
      }
    }
    sessionsZeroActiveWithQueuedApproved = flagged;
  } catch {
    sessionsZeroActiveWithQueuedApproved = [];
  }

  return {
    project,
    promoted,
    landedAtDivergence,
    gcDeleted: gcResult.deleted,
    gcFlagged: gcResult.flagged,
    fullyOnMasterBranchesRemaining,
    sessionsZeroActiveWithQueuedApproved,
  };
}
