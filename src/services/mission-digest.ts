/**
 * Mission-scoped digest store — `.collab/mission-digests/<missionId>.md`.
 *
 * `forgeMission`'s orientation digest used to clobber the ONE project-global
 * `.collab/project-digest.md` file that the land-time generator (`project-digest.ts`) also owns.
 * Digests are per-mission storage; `project-digest.md` stays as the fallback for when no mission
 * digest is available.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listMissions, isMissionTerminal } from './mission-store.ts';
import { readProjectDigest } from './project-digest.ts';

function missionDigestPath(project: string, missionId: string): string {
  return join(project, '.collab', 'mission-digests', `${missionId}.md`);
}

export function writeMissionDigest(project: string, missionId: string, text: string): void {
  const dir = join(project, '.collab', 'mission-digests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(missionDigestPath(project, missionId), text.endsWith('\n') ? text : text + '\n');
}

export function readMissionDigest(project: string, missionId: string): string | null {
  try {
    return readFileSync(missionDigestPath(project, missionId), 'utf-8');
  } catch {
    return null;
  }
}

export function deleteMissionDigest(project: string, missionId: string): void {
  try {
    rmSync(missionDigestPath(project, missionId), { force: true });
  } catch {
    // best-effort cleanup — never throw
  }
}

/**
 * Resolve the digest for the single live active mission, falling back to the project-global
 * digest when there is no unambiguous active mission or it has no digest of its own.
 */
export function resolveActiveMissionDigest(project: string): string | null {
  let missionId: string | null = null;
  try {
    const live = listMissions(project).filter(
      (m) => m.mission.active && !isMissionTerminal(m.mission) &&
             m.node.status !== 'done' && m.node.status !== 'dropped',
    );
    if (live.length === 1) missionId = live[0]!.node.id;
  } catch {
    missionId = null;
  }

  if (missionId) {
    const digest = readMissionDigest(project, missionId);
    if (digest != null) return digest;
  }

  return readProjectDigest(project);
}
