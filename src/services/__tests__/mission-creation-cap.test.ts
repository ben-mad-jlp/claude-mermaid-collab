import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertMissionCreationAllowed,
  MAX_MISSIONS_PER_PROJECT,
  MAX_MISSIONS_PER_WINDOW,
  MISSION_CREATE_RATE_WINDOW_MS,
  _resetMissionCreateThrottle,
  _resetMissionDbCache,
  setMissionAbandoned,
  listMissions,
} from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { handleMissionTool } from '../../mcp/mission-tools';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-cap-'));
  delete process.env.MERMAID_SKIP_MISSION_CEILING;
  _resetMissionDbCache(project);
  _resetMissionCreateThrottle();
});

/** Create MAX_MISSIONS_PER_PROJECT real missions via forgeMission, resetting the burst
 *  throttle after each creation so only the COUNT ceiling is exercised. Returns the ids. */
async function fillToCeiling(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < MAX_MISSIONS_PER_PROJECT; i++) {
    const forged = await forgeMission(project, { session: 's1', title: `M ${i}`, criteria: ['x'] });
    ids.push(forged.missionId);
    _resetMissionCreateThrottle(project);
  }
  return ids;
}

describe('assertMissionCreationAllowed — count ceiling', () => {
  test(`creating ${MAX_MISSIONS_PER_PROJECT} missions succeeds; the next forgeMission rejects`, async () => {
    await fillToCeiling();
    expect(listMissions(project).length).toBe(MAX_MISSIONS_PER_PROJECT);
    await expect(
      forgeMission(project, { session: 's1', title: 'overflow', criteria: ['x'] }),
    ).rejects.toThrow(/ceiling/);
  });
});

describe('assertMissionCreationAllowed — burst/window throttle', () => {
  test('allows MAX_MISSIONS_PER_WINDOW calls within the window, rejects the next, then allows after rollover', () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_MISSIONS_PER_WINDOW; i++) {
      expect(() => assertMissionCreationAllowed(project, now + i)).not.toThrow();
    }
    expect(() => assertMissionCreationAllowed(project, now + MAX_MISSIONS_PER_WINDOW)).toThrow(
      /ceiling.*per window/,
    );
    expect(() =>
      assertMissionCreationAllowed(project, now + MISSION_CREATE_RATE_WINDOW_MS + 1),
    ).not.toThrow();
  });
});

describe('mission-creation ceiling — call sites', () => {
  test('handleMissionTool(create_mission) rejects at the ceiling; no new mission created', async () => {
    await fillToCeiling();
    const before = listMissions(project).length;
    await expect(
      handleMissionTool('create_mission', { project, session: 's1', title: 'overflow', criteria: ['x'] }),
    ).rejects.toThrow(/ceiling/);
    expect(listMissions(project).length).toBe(before);
  });

  test('forgeMission rejects at the ceiling; no new mission created', async () => {
    await fillToCeiling();
    const before = listMissions(project).length;
    await expect(
      forgeMission(project, { session: 's1', title: 'overflow', criteria: ['x'] }),
    ).rejects.toThrow(/ceiling/);
    expect(listMissions(project).length).toBe(before);
  });
});

describe('mission-creation ceiling — terminal exclusion', () => {
  test('abandoning one mission at the ceiling frees a slot for a subsequent forgeMission', async () => {
    const ids = await fillToCeiling();
    setMissionAbandoned(project, ids[0], Date.now());
    _resetMissionCreateThrottle(project);
    await expect(
      forgeMission(project, { session: 's1', title: 'freed slot', criteria: ['x'] }),
    ).resolves.toBeDefined();
  });
});
