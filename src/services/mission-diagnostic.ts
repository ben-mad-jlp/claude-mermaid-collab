// Read-only aggregate view over a mission: status, rollup, criteria (with git-verified
// serving-epic landedness), plus stubbed fields owned by sibling leaves. Every source read
// is independently try/catch'd so a throwing reader degrades that field, not the whole call.
import { getMission, getMissionRollup, listCriteriaWithActions } from './mission-store.js';
import type { MissionStatus, MissionRollup, CriterionAction } from './mission-store.js';
import { isEpicLandedInGit } from './epic-landedness.js';
import type { GitLandStatus } from './epic-landedness.js';
import { listTodos, type Todo } from './todo-store.js';
import { isEpic, isLeaf } from './todo-kind.js';
import { listLeafRuns, type LeafRunSummary } from './ledger-stats.js';
import { classifyInfraRejection } from './conductor-infra-arm.js';
import { derivedStatus } from './claimability.js';
import { listConductorPasses, type ConductorPassArm } from './conductor-pass-journal.js';
import { getEpicBaseGate } from './worker-ledger.js';

export type LeafTerminalClass =
  | 'accepted'
  | 'epic-base-red'
  | 'gate-rejected'
  | 'blocked-dependency'
  | 'inflight'
  | 'parked-other';

export interface MissionDiagnosticLeaf {
  id: string;
  epicId: string;
  derivedStatus: string;
  terminalReason: string | null;
  terminalClass: LeafTerminalClass;
}

/** Latest conductor-pass telemetry for a mission, derived from the durable conductor_pass
 *  journal (newest-first). Degrades to the all-null/zero shape below on any read failure. */
export interface MissionDiagnosticConductorPass {
  /** startedAt of the most recent FINALIZED pass (endedAt != null), or null. */
  lastPassAt: number | null;
  /** arm of that finalized pass, or null. */
  lastArm: ConductorPassArm | null;
  /** outcome of that finalized pass, or null. */
  lastOutcome: string | null;
  /** ran flag of that finalized pass, or null. */
  ran: boolean | null;
  /** true when the newest row is still open (endedAt == null) — a pass is mid-flight. */
  isInflight: boolean;
  /** contiguous count of newest FINALIZED passes with outcome === 'debounced'. */
  debouncedStreak: number;
  /** seconds since lastPassAt (now() - lastPassAt)/1000, or null when no finalized pass. */
  staleSeconds: number | null;
}

/** Base-health snapshot for a mission: the trunk lanes' green/red as memoized at the epic
 *  base gate, plus any in-flight base-repair leaf. Degrades to all-unknown/null on failure. */
export interface MissionDiagnosticBaseHealth {
  tsc: 'green' | 'red' | 'unknown';
  suite: 'green' | 'red' | 'unknown';
  repairLeafInflight: { id: string; title: string } | null;
}

export interface MissionDiagnostic {
  status: MissionStatus | null;
  rollup: MissionRollup | null;
  criteria: Array<{
    id: string;
    action: CriterionAction;
    met: boolean;
    servingEpics: Array<{ id: string; title: string; open: boolean; landedInGit: boolean | null }>;
  }>;
  leaves: MissionDiagnosticLeaf[];
  conductorPass: MissionDiagnosticConductorPass;
  baseHealth: MissionDiagnosticBaseHealth;
}

function toLandedInGit(status: GitLandStatus): boolean | null {
  if (status === 'landed') return true;
  if (status === 'not-landed') return false;
  return null;
}

/**
 * Classify a leaf's terminal state from its acceptance, its CANONICAL derived status
 * (from claimability.derivedStatus — never the untrusted shadow enum), and its latest
 * durable ledger run. Order matters: `blocked` must be checked before the in-flight
 * fallback, since a blocked leaf also has no settled run and would otherwise be
 * mis-caught there. `derived` is passed in (the caller already computes it) so this
 * stays a pure classifier and the single-source read lives in claimability.
 */
export function classifyLeafTerminal(
  todo: Pick<Todo, 'acceptanceStatus'>,
  run: LeafRunSummary | null,
  derived: string,
): LeafTerminalClass {
  if (todo.acceptanceStatus === 'accepted') return 'accepted';
  if (todo.acceptanceStatus === 'rejected') {
    const cause = classifyInfraRejection(run?.reason ?? null);
    if (cause === 'epic-base-red') return 'epic-base-red';
    if (cause === 'epic-base-gate-could-not-run' || cause === 'mis-homed-target') return 'parked-other';
    return 'gate-rejected';
  }
  if (derived === 'blocked') return 'blocked-dependency';
  if (
    derived === 'in_progress' ||
    !run ||
    run.finalOutcome == null ||
    run.finalOutcome === 'pending' ||
    run.finalOutcome === 'paused'
  ) {
    return 'inflight';
  }
  return 'parked-other';
}

export async function buildMissionDiagnostic(
  project: string,
  missionId: string,
  deps?: {
    isEpicLandedInGit?: typeof isEpicLandedInGit;
    now?: () => number;
    epicHeadSha?: (project: string, epicId: string) => Promise<string | null>;
  },
): Promise<MissionDiagnostic> {
  const probe = deps?.isEpicLandedInGit ?? isEpicLandedInGit;
  const now = deps?.now ?? Date.now;
  const epicHeadSha =
    deps?.epicHeadSha ??
    (async (proj: string, epicId: string): Promise<string | null> => {
      try {
        const { getWorktreeManager } = await import('./coordinator-live.js');
        return await getWorktreeManager(proj).epicHeadSha(epicId);
      } catch {
        return null;
      }
    });

  let status: MissionStatus | null = null;
  try {
    const mission = getMission(project, missionId);
    status = mission?.status ?? null;
  } catch {
    status = null;
  }

  let rollup: MissionRollup | null = null;
  try {
    rollup = getMissionRollup(project, missionId);
  } catch {
    rollup = null;
  }

  let rawCriteria: ReturnType<typeof listCriteriaWithActions> = [];
  try {
    rawCriteria = listCriteriaWithActions(project, missionId);
  } catch {
    rawCriteria = [];
  }

  const probes = new Map<string, Promise<GitLandStatus>>();
  for (const c of rawCriteria) {
    for (const e of c.servingEpics) {
      if (!probes.has(e.id)) {
        probes.set(
          e.id,
          (async () => {
            try {
              return await probe(project, e.id);
            } catch {
              return 'indeterminate' as GitLandStatus;
            }
          })(),
        );
      }
    }
  }

  const resolved = new Map<string, GitLandStatus>();
  for (const [id, p] of probes) {
    resolved.set(id, await p);
  }

  const criteria = rawCriteria.map((c) => ({
    id: c.id,
    action: c.action,
    met: c.met,
    servingEpics: c.servingEpics.map((e) => ({
      id: e.id,
      title: e.title,
      open: !e.landed,
      landedInGit: toLandedInGit(resolved.get(e.id) ?? 'indeterminate'),
    })),
  }));

  let leaves: MissionDiagnosticLeaf[] = [];
  try {
    const allTodos = listTodos(project, { includeCompleted: true });
    const byId = new Map(allTodos.map((t) => [t.id, t]));
    const epics = allTodos.filter((t) => t.parentId === missionId && isEpic(t));
    const epicIds = new Set(epics.map((e) => e.id));
    const missionLeaves = allTodos.filter((t) => isLeaf(t) && t.parentId != null && epicIds.has(t.parentId));

    const runsByLeaf = new Map<string, LeafRunSummary>();
    for (const epic of epics) {
      try {
        const runs = listLeafRuns({ project, epicId: epic.id });
        for (const run of runs) {
          runsByLeaf.set(run.leafId, run);
        }
      } catch {
        // fail-open: a ledger hiccup for one epic must not break the others
      }
    }

    leaves = missionLeaves.map((leaf) => {
      const run = runsByLeaf.get(leaf.id) ?? null;
      const derived = derivedStatus(leaf, byId);
      return {
        id: leaf.id,
        epicId: leaf.parentId as string,
        derivedStatus: derived,
        terminalReason: run?.reason ?? null,
        terminalClass: classifyLeafTerminal(leaf, run, derived),
      };
    });
  } catch {
    leaves = [];
  }

  // conductorPass — latest pass telemetry from the durable journal (newest-first). Any throw
  // degrades to the all-null/zero shape; empty rows also read that shape (never "inflight").
  let conductorPass: MissionDiagnosticConductorPass = {
    lastPassAt: null,
    lastArm: null,
    lastOutcome: null,
    ran: null,
    isInflight: false,
    debouncedStreak: 0,
    staleSeconds: null,
  };
  try {
    const rows = listConductorPasses(project, { missionId, limit: 20 });
    // The newest row, if unfinalized, is the mission's in-flight pass and is EXCLUDED from
    // the streak/last-X reads (which describe SETTLED history).
    const isInflight = rows.length > 0 && rows[0].endedAt == null;
    const finalized = rows.filter((r) => r.endedAt != null);
    const lastPassAt = finalized[0]?.startedAt ?? null;
    let debouncedStreak = 0;
    for (const r of finalized) {
      if (r.outcome === 'debounced') debouncedStreak++;
      else break;
    }
    conductorPass = {
      lastPassAt,
      lastArm: finalized[0]?.arm ?? null,
      lastOutcome: finalized[0]?.outcome ?? null,
      ran: finalized[0]?.ran ?? null,
      isInflight,
      debouncedStreak,
      staleSeconds: lastPassAt == null ? null : (now() - lastPassAt) / 1000,
    };
  } catch {
    conductorPass = {
      lastPassAt: null,
      lastArm: null,
      lastOutcome: null,
      ran: null,
      isInflight: false,
      debouncedStreak: 0,
      staleSeconds: null,
    };
  }

  // baseHealth — trunk-lane green/red as memoized at the epic base gate, plus any in-flight
  // base-repair leaf. Own try/catch (independent of the leaves block): the first mission epic
  // that yields a non-null base-gate row for its current head sha wins. Base-repair epics are
  // homed with home:null (NOT under missionId), so the repair-leaf scan walks the FULL list.
  let baseHealth: MissionDiagnosticBaseHealth = { tsc: 'unknown', suite: 'unknown', repairLeafInflight: null };
  try {
    const allTodos = listTodos(project, { includeCompleted: true });
    const byId = new Map(allTodos.map((t) => [t.id, t]));
    const missionEpics = allTodos.filter((t) => t.parentId === missionId && isEpic(t));

    let tsc: 'green' | 'red' | 'unknown' = 'unknown';
    let suite: 'green' | 'red' | 'unknown' = 'unknown';
    for (const epic of missionEpics) {
      let sha: string | null = null;
      try {
        sha = await epicHeadSha(project, epic.id);
      } catch {
        sha = null;
      }
      const row = getEpicBaseGate(epic.id, sha);
      if (row == null) continue; // MISS (no row / stale sha) — try the next epic
      if (row.status === 'pass') {
        tsc = 'green';
        suite = 'green';
      } else if (row.status === 'error') {
        tsc = 'unknown';
        suite = 'unknown';
      } else {
        tsc = (row.baselineFailures?.typecheck?.length ?? 0) > 0 ? 'red' : 'green';
        suite = (row.baselineFailures?.baseTest?.length ?? 0) > 0 ? 'red' : 'green';
      }
      break; // first non-null row wins
    }

    // Base-repair epics (baseRepair === 1) live anywhere in the graph — scan the full list.
    let repairLeafInflight: { id: string; title: string } | null = null;
    const repairEpics = allTodos.filter((t) => isEpic(t) && t.baseRepair === 1);
    for (const re of repairEpics) {
      const child = allTodos.find(
        (t) => t.parentId === re.id && isLeaf(t) && derivedStatus(t, byId) === 'in_progress',
      );
      if (child) {
        repairLeafInflight = { id: child.id, title: child.title };
        break;
      }
    }

    baseHealth = { tsc, suite, repairLeafInflight };
  } catch {
    baseHealth = { tsc: 'unknown', suite: 'unknown', repairLeafInflight: null };
  }

  return {
    status,
    rollup,
    criteria,
    leaves,
    conductorPass,
    baseHealth,
  };
}
