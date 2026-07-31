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
  conductorPass: null; // TODO(sibling leaf: mission-diagnostic conductorPass field) — stub null
  baseHealth: { tsc: 'unknown'; suite: 'unknown'; repairLeafInflight: null };
  // TODO(sibling leaf: mission-diagnostic baseHealth field) — stub above
}

function toLandedInGit(status: GitLandStatus): boolean | null {
  if (status === 'landed') return true;
  if (status === 'not-landed') return false;
  return null;
}

/**
 * Classify a leaf's terminal state from its persisted todo status/acceptance and its latest
 * durable ledger run. Order matters: `blocked` must be checked before the in-flight fallback,
 * since a blocked leaf also has no settled run and would otherwise be mis-caught there.
 */
export function classifyLeafTerminal(
  todo: Pick<Todo, 'acceptanceStatus' | 'status'>,
  run: LeafRunSummary | null,
): LeafTerminalClass {
  if (todo.acceptanceStatus === 'accepted') return 'accepted';
  if (todo.acceptanceStatus === 'rejected') {
    const cause = classifyInfraRejection(run?.reason ?? null);
    if (cause === 'epic-base-red') return 'epic-base-red';
    if (cause === 'epic-base-gate-could-not-run' || cause === 'mis-homed-target') return 'parked-other';
    return 'gate-rejected';
  }
  if (todo.status === 'blocked') return 'blocked-dependency';
  if (
    todo.status === 'in_progress' ||
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
  deps?: { isEpicLandedInGit?: typeof isEpicLandedInGit },
): Promise<MissionDiagnostic> {
  const probe = deps?.isEpicLandedInGit ?? isEpicLandedInGit;

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
      return {
        id: leaf.id,
        epicId: leaf.parentId as string,
        derivedStatus: derivedStatus(leaf, byId),
        terminalReason: run?.reason ?? null,
        terminalClass: classifyLeafTerminal(leaf, run),
      };
    });
  } catch {
    leaves = [];
  }

  return {
    status,
    rollup,
    criteria,
    leaves,
    conductorPass: null,
    baseHealth: { tsc: 'unknown', suite: 'unknown', repairLeafInflight: null },
  };
}
