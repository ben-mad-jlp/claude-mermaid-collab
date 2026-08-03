import type { MissionSummary } from '@/stores/supervisorStore';

// Reads rollup.capability ONLY — never rollup.gaps/rollup.awaitingVerify/rollup.status,
// because listMissions(withFacts:false) fakes those three (MissionRollup.factsOmitted)
// but computes capability from the real criterion rows identically to the facts-backed path.
export function selectActiveMissionProgress(
  missions: MissionSummary[],
): { met: number; total: number } | null {
  const activeMission = missions.find((m) => m.mission.active === true);
  if (!activeMission) return null;

  const capability = activeMission.rollup?.capability;
  if (!capability) return null;

  const total = capability.total;
  if (total === 0) return null;

  return { met: capability.met, total };
}
