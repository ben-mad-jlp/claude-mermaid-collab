import { describe, it, expect } from 'bun:test';
import type { GateDeclaration, GateSpawn } from '../leaf-gate';
import type { FloorPlan } from '../impacted-tests';
import { runEpicLandGate } from '../epic-land-gate';

const FLOOR_CMD = 'bun run scripts/test-backend.ts --baseline=scripts/backend-test-baseline.json --lane=fast';

const decl: GateDeclaration = {
  kind: 'declared',
  cfg: {
    typecheck: 'npx tsc --noEmit',
    tests: [{ match: new RegExp('^src/'), command: 'bun test {file}', mode: 'per-file' }],
    floors: [{ match: new RegExp('^src/'), command: FLOOR_CMD }],
  },
  manifestPath: '.collab/project.json',
};

const mockGit = (cwd: string, args: string[]) => {
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { code: 0, stdout: 'abcdef12\n' };
  if (args[0] === 'rev-parse' && args[1] === 'master') return { code: 0, stdout: 'c88912ae\n' };
  if (args[0] === 'merge-base') return { code: 0, stdout: 'c88912ae\n' };
  if (args[0] === 'diff') return { code: 0, stdout: 'src/services/foo.ts\n' };
  if (args[0] === 'worktree') return { code: 0, stdout: '' };
  return { code: 1, stdout: '' };
};

function passingSpawn(spawnCalls: string[]): GateSpawn {
  return async (_cwd, command) => {
    spawnCalls.push(command);
    return { ran: true, code: 0, output: 'OK' };
  };
}

const baseOpts = {
  project: 'test',
  repo: '/repo',
  epicId: 'impacted1',
  epicBranch: 'collab/epic/impacted1',
  epicWorktreeCwd: '/epic',
  decl,
  git: mockGit,
  fs: { exists: () => true, symlink: () => {} },
  skipCache: true,
  quarantineLookup: () => [],
};

describe('land-gate impacted floor', () => {
  it('impacted mode narrows the floor command to the impacted files and records floorMode', async () => {
    const spawnCalls: string[] = [];
    const planner = (): FloorPlan => ({
      mode: 'impacted',
      tests: ['src/x.test.ts', 'src/y.test.ts'],
      candidateCount: 10,
      trigger: null,
    });

    const result = await runEpicLandGate({ ...baseOpts, spawn: passingSpawn(spawnCalls), floorPlanner: planner });

    expect(spawnCalls).toContain(`${FLOOR_CMD} --files=src/x.test.ts,src/y.test.ts`);
    expect(spawnCalls).not.toContain(FLOOR_CMD);
    expect(result.status).toBe('pass');
    expect(result.floorMode).toBe('impacted');
    expect(result.floorImpactedCount).toBe(2);
    expect(result.reasons).toContain('impacted floor: ran 2 of 10 test files (fallback triggers: none)');
  });

  it('a fallback trigger runs the full declared command and names the trigger', async () => {
    const spawnCalls: string[] = [];
    const planner = (): FloorPlan => ({
      mode: 'full',
      candidateCount: 10,
      trigger: 'infra path changed: package.json',
    });

    const result = await runEpicLandGate({ ...baseOpts, spawn: passingSpawn(spawnCalls), floorPlanner: planner });

    expect(spawnCalls).toContain(FLOOR_CMD);
    expect(spawnCalls.some((c) => c.includes('--files='))).toBe(false);
    expect(result.status).toBe('pass');
    expect(result.floorMode).toBe('full');
    expect(result.floorImpactedCount).toBeUndefined();
    expect(result.reasons).toContain('impacted floor: full suite (fallback trigger: infra path changed: package.json)');
  });

  it('an impacted-mode floor failure carries the --files list in the gate record', async () => {
    const spawnCalls: string[] = [];
    const spawn: GateSpawn = async (_cwd, command) => {
      spawnCalls.push(command);
      if (command.includes('test-backend')) {
        return {
          ran: true,
          code: 1,
          output: `1 new file(s) FAILED:\n\n──────── src/x.test.ts ────────\n × broke 12ms\n`,
        };
      }
      return { ran: true, code: 0, output: 'OK' };
    };
    const planner = (): FloorPlan => ({
      mode: 'impacted',
      tests: ['src/x.test.ts'],
      candidateCount: 10,
      trigger: null,
    });

    const result = await runEpicLandGate({ ...baseOpts, spawn, floorPlanner: planner });

    expect(result.status).toBe('fail');
    expect(result.floorMode).toBe('impacted');
    expect(result.floor?.command).toBe(`${FLOOR_CMD} --files=src/x.test.ts`);
    expect(result.reasons.some((r) => r.includes('REGRESSION FLOOR FAILED') && r.includes('--files=src/x.test.ts'))).toBe(true);
  });

  it('a planner that throws falls back to the full command', async () => {
    const spawnCalls: string[] = [];
    const planner = (): FloorPlan => {
      throw new Error('walk exploded');
    };

    const result = await runEpicLandGate({ ...baseOpts, spawn: passingSpawn(spawnCalls), floorPlanner: planner });

    expect(spawnCalls).toContain(FLOOR_CMD);
    expect(result.floorMode).toBe('full');
    expect(result.reasons.some((r) => r.includes('planner threw'))).toBe(true);
  });
});
