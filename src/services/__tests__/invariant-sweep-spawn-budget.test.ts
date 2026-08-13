// Regression test pinning the spawn budget of the invariant sweep by counting
// git spawns through the injected seams: checkInvariants -> findUnrecordedTrunkLands ->
// getTrunkLandIndex.
//
// Isolate the global supervisor.db BEFORE any store module is imported.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-spawn-budget-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import type { GitRunner } from '../epic-landedness';
import { checkInvariants } from '../invariant-check';
import { getTrunkLandIndex, resetTrunkLandIndex } from '../trunk-land-index';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

// Named constants for the spawn budget assertions.
// NOTE: detectTrunkRef (invariant-check.ts:379) shells out through its OWN runGit (not
// the injected one) and is deliberately NOT counted. These constants describe injected-seam
// spawns only (checkInvariants rev-parse + getTrunkLandIndex log).
export const EXPECTED_FIRST_PASS_SPAWNS = 2; // rev-parse + log
export const EXPECTED_CACHED_PASS_SPAWNS = 1; // rev-parse only (log cached)
export const LAND_COMMIT_FIXTURE_SIZE = 3;

// Fixture: 3 land commits in the format getTrunkLandIndex expects.
// Each record is \x1e-prefixed, with sha\t committedAtIso\t body.
function makeLandCommitFixture(epicId1: string, epicId2: string, epicId3: string): string {
  const records = [
    `\x1e${epicId1}\t2026-01-01T00:00:00Z\tCollab-Epic: ${epicId1}\nfeature 1 landed`,
    `\x1e${epicId2}\t2026-01-02T00:00:00Z\tCollab-Epic: ${epicId2}\nfeature 2 landed`,
    `\x1e${epicId3}\t2026-01-03T00:00:00Z\tCollab-Epic: ${epicId3}\nfeature 3 landed`,
  ];
  return records.join('');
}

// Counting stub GitRunner.
function makeCountingRunGit(fixture: string, mutableTipSha: { value: string }) {
  let spawnCount = 0;
  const stub: GitRunner = async (cwd: string, args: string[]) => {
    spawnCount++;
    const cmd = args[0];
    if (cmd === 'rev-parse') {
      return { code: 0, stdout: mutableTipSha.value + '\n' };
    }
    if (cmd === 'log') {
      return { code: 0, stdout: fixture };
    }
    return { code: 1, stdout: '' };
  };
  return { stub, getSpawnCount: () => spawnCount, resetSpawnCount: () => { spawnCount = 0; } };
}

describe('invariant-sweep spawn budget', () => {
  const todoBase = mkdtempSync(join(tmpdir(), 'spawn-budget-test-'));
  let projectCounter = 0;

  function freshProject(): string {
    const p = join(todoBase, `proj-${++projectCounter}`);
    mkdirSync(join(p, '.collab'), { recursive: true });
    return p;
  }

  beforeEach(() => {
    resetTrunkLandIndex();
  });

  afterAll(() => {
    _closeSupervisorDb();
    rmSync(supervisorDir, { recursive: true, force: true });
    rmSync(todoBase, { recursive: true, force: true });
    delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  test('first sweep pass over the land-commit fixture spends exactly EXPECTED_FIRST_PASS_SPAWNS injected git spawns', async () => {
    const project = freshProject();

    try {
      // Create 3 fixture epics (no landedAt stamp, so selectAheadProbeCandidates returns [])
      const e1 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic1', kind: 'epic' });
      const e2 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic2', kind: 'epic' });
      const e3 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic3', kind: 'epic' });

      _closeProject(project);

      const mutableTipSha = { value: 'abc123def456' };
      const fixture = makeLandCommitFixture(e1.id, e2.id, e3.id);
      const { stub: runGit, getSpawnCount, resetSpawnCount } = makeCountingRunGit(fixture, mutableTipSha);

      const violations = await checkInvariants(project, { runGit, probe: async () => ({ exists: true, ahead: 0, behind: 0, mergeable: true }) });

      const count = getSpawnCount();
      console.log(`first pass spawn count: ${count}`);
      expect(count).toBe(EXPECTED_FIRST_PASS_SPAWNS);
    } finally {
      _closeProject(project);
    }
  });

  test('second sweep pass at the same trunk tip spends exactly EXPECTED_CACHED_PASS_SPAWNS injected git spawns', async () => {
    const project = freshProject();

    try {
      const e1 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic1', kind: 'epic' });
      const e2 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic2', kind: 'epic' });
      const e3 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic3', kind: 'epic' });

      _closeProject(project);

      const mutableTipSha = { value: 'abc123def456' };
      const fixture = makeLandCommitFixture(e1.id, e2.id, e3.id);
      const { stub: runGit, getSpawnCount, resetSpawnCount } = makeCountingRunGit(fixture, mutableTipSha);

      // First pass (prime the cache)
      await checkInvariants(project, { runGit, probe: async () => ({ exists: true, ahead: 0, behind: 0, mergeable: true }) });

      // Second pass at the same tip
      resetSpawnCount();
      const violations = await checkInvariants(project, { runGit, probe: async () => ({ exists: true, ahead: 0, behind: 0, mergeable: true }) });

      const count = getSpawnCount();
      console.log(`cached pass spawn count: ${count}`);
      expect(count).toBe(EXPECTED_CACHED_PASS_SPAWNS);
    } finally {
      _closeProject(project);
    }
  });

  test('mutation probe: a changed trunk tip sha restores the spawn count to EXPECTED_FIRST_PASS_SPAWNS', async () => {
    const project = freshProject();

    try {
      const e1 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic1', kind: 'epic' });
      const e2 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic2', kind: 'epic' });
      const e3 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic3', kind: 'epic' });

      _closeProject(project);

      const mutableTipSha = { value: 'abc123def456' };
      const fixture = makeLandCommitFixture(e1.id, e2.id, e3.id);
      const { stub: runGit, getSpawnCount, resetSpawnCount } = makeCountingRunGit(fixture, mutableTipSha);

      // First pass
      await checkInvariants(project, { runGit, probe: async () => ({ exists: true, ahead: 0, behind: 0, mergeable: true }) });

      // Flip the tip sha to bust the cache
      mutableTipSha.value = 'xyz789abc123';
      resetSpawnCount();

      // Third pass at a different tip — cache misses, re-walks
      const violations = await checkInvariants(project, { runGit, probe: async () => ({ exists: true, ahead: 0, behind: 0, mergeable: true }) });

      const count = getSpawnCount();
      console.log(`mutation probe spawn count: ${count}`);
      expect(count).toBe(EXPECTED_FIRST_PASS_SPAWNS);
    } finally {
      _closeProject(project);
    }
  });

  test('trunk land index contents are deep-equal across the uncached and cached passes', async () => {
    const project = freshProject();

    try {
      const e1 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic1', kind: 'epic' });
      const e2 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic2', kind: 'epic' });
      const e3 = await createTodo(project, { ownerSession: 'test', title: '[EPIC] epic3', kind: 'epic' });

      _closeProject(project);

      const mutableTipSha = { value: 'abc123def456' };
      const fixture = makeLandCommitFixture(e1.id, e2.id, e3.id);
      const { stub: runGit } = makeCountingRunGit(fixture, mutableTipSha);

      // Call getTrunkLandIndex cold (cache miss)
      const uncached = await getTrunkLandIndex(project, 'master', runGit, { tipSha: mutableTipSha.value });

      // Reset counter and call again at the same tip (cache hit)
      const cached = await getTrunkLandIndex(project, 'master', runGit, { tipSha: mutableTipSha.value });

      // Convert both Maps to objects for deep comparison
      const uncachedObj = uncached ? Object.fromEntries(uncached) : null;
      const cachedObj = cached ? Object.fromEntries(cached) : null;

      expect(cachedObj).toEqual(uncachedObj);
      // Verify the fixture was parsed correctly: 3 entries
      expect(uncachedObj).toBeDefined();
      if (uncachedObj) {
        expect(Object.keys(uncachedObj)).toHaveLength(3);
      }
    } finally {
      _closeProject(project);
    }
  });
});
