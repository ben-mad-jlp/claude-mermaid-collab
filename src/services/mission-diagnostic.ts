// Read-only aggregate view over a mission: status, rollup, criteria (with git-verified
// serving-epic landedness), plus stubbed fields owned by sibling leaves. Every source read
// is independently try/catch'd so a throwing reader degrades that field, not the whole call.
import { getMission, getMissionRollup, listCriteriaWithActions } from './mission-store.js';
import type { MissionStatus, MissionRollup, CriterionAction } from './mission-store.js';
import { isEpicLandedInGit } from './epic-landedness.js';
import type { GitLandStatus } from './epic-landedness.js';

export interface MissionDiagnostic {
  status: MissionStatus | null;
  rollup: MissionRollup | null;
  criteria: Array<{
    id: string;
    action: CriterionAction;
    met: boolean;
    servingEpics: Array<{ id: string; title: string; open: boolean; landedInGit: boolean | null }>;
  }>;
  leaves: unknown[]; // TODO(sibling leaf: mission-diagnostic leaves field) — stub []
  conductorPass: null; // TODO(sibling leaf: mission-diagnostic conductorPass field) — stub null
  baseHealth: { tsc: 'unknown'; suite: 'unknown'; repairLeafInflight: null };
  // TODO(sibling leaf: mission-diagnostic baseHealth field) — stub above
}

function toLandedInGit(status: GitLandStatus): boolean | null {
  if (status === 'landed') return true;
  if (status === 'not-landed') return false;
  return null;
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

  return {
    status,
    rollup,
    criteria,
    leaves: [],
    conductorPass: null,
    baseHealth: { tsc: 'unknown', suite: 'unknown', repairLeafInflight: null },
  };
}
