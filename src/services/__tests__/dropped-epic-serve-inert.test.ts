/**
 * Regression test: dropped epics are serve-inert at the two read sites.
 * Dropped status excludes an epic from being reported as a serving epic
 * both in the conductor journal (criteriaActed) and in the reachability guard.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, updateTodo, _closeProject, listTodos } from '../todo-store';
import { _resetMissionDbCache, addCriterion, upsertMission, listCriteriaWithActions } from '../mission-store';
import { addWatchedProject, setConductorEnabled, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { runConductorPass } from '../conductor-pass';
import { listConductorPasses, _closeConductorJournalDb } from '../conductor-pass-journal';
import { assertServingEpicModulesReachable } from '../module-reachability';
import { recordEpicLand } from '../epic-land-record-store';
import { forgeMission } from '../../mcp/tools/mission-forge';

let supervisorDir: string;

beforeEach(() => {
  supervisorDir = mkdtempSync(join(tmpdir(), 'dropped-serve-'));
  process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
  _closeConductorJournalDb();
  _closeSupervisorDb();
});

afterEach(() => {
  _closeConductorJournalDb();
  _closeSupervisorDb();
  _resetMissionDbCache(supervisorDir);
  if (supervisorDir) rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('dropped-epic-serve-inert', () => {
  test('a dropped serving epic is serve-inert in the derived criterion action while the conductor journal still names it', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'dropped-serve-journal-'));
    try {
      _resetMissionDbCache(proj);
      addWatchedProject(proj);
      setConductorEnabled(proj, true);

      // Forge a mission with one criterion
      const forged = await forgeMission(proj, { session: 's1', title: 'Test Mission', criteria: ['a criterion'] });
      const criterionId = listCriteriaWithActions(proj, forged.missionId)[0].id;

      // Create a live epic serving the criterion
      const liveEpic = await createTodo(proj, {
        ownerSession: 's1',
        title: '[EPIC] serving epic',
        kind: 'epic',
        parentId: forged.missionId,
        servesCriterionIds: [criterionId],
      });

      // Run a conductor pass with a stub invoke that does nothing
      const invokeStub = async () => ({ ok: true, rateLimited: false, text: '' } as any);
      const passResult = await runConductorPass(proj, { invoke: invokeStub });

      // Drop the epic
      await updateTodo(proj, liveEpic.id, { status: 'dropped' });

      // Run another conductor pass
      _closeConductorJournalDb();
      const passResult2 = await runConductorPass(proj, { invoke: invokeStub });

      // Assert derived layer: dropped epic is serve-inert in criterion action
      const derivedCrit = listCriteriaWithActions(proj, forged.missionId)[0];
      expect(derivedCrit.servingEpics).toHaveLength(0);
      expect(derivedCrit.servingEpicLive).toBe(false);
      expect(derivedCrit.action).not.toBe('building');

      // Assert journal layer: conductor journal still names the dropped epic
      const passesAfterDrop = listConductorPasses(proj);
      expect(passesAfterDrop.length).toBeGreaterThanOrEqual(1);
      const droppedPass = passesAfterDrop[0]; // newest first
      expect(droppedPass.criteriaActed).toBeDefined();
      const droppedActed = (droppedPass.criteriaActed as any[]).find((a: any) => a.criterionId === criterionId);
      expect(droppedActed).toBeDefined();
      expect(droppedActed!.servedEpicId).toBe(liveEpic.id);
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      rmSync(proj, { recursive: true, force: true });
    }
  });

  test('assertServingEpicModulesReachable throws for a live serving epic with an unreachable module and resolves once it is dropped', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'dropped-serve-reachability-'));
    try {
      _resetMissionDbCache(proj);
      addWatchedProject(proj);

      // Initialize git repo
      execFileSync('git', ['init'], { cwd: proj });
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/master'], { cwd: proj });

      // Initial commit on master
      writeFileSync(join(proj, 'initial.txt'), 'initial\n');
      execFileSync('git', ['add', 'initial.txt'], { cwd: proj });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: proj });

      // Create src/ directory
      mkdirSync(join(proj, 'src'), { recursive: true });

      // Create a branch and add unreachable module
      execFileSync('git', ['checkout', '-b', 'scratch'], { cwd: proj });
      mkdirSync(join(proj, 'src', '__tests__'), { recursive: true });
      writeFileSync(join(proj, 'src', 'unreachable.ts'), 'export function unreachable() { return 1; }\n');
      writeFileSync(
        join(proj, 'src', '__tests__', 'unreachable.test.ts'),
        "import { unreachable } from '../unreachable';\ntest('unreachable', () => { expect(unreachable()).toBe(1); });\n"
      );

      execFileSync('git', ['add', 'src/unreachable.ts', 'src/__tests__/unreachable.test.ts'], { cwd: proj });
      execFileSync('git', ['commit', '-m', 'add unreachable'], { cwd: proj });

      // Back to master and merge
      execFileSync('git', ['checkout', 'master'], { cwd: proj });
      execFileSync('git', ['merge', '--no-ff', 'scratch', '-m', 'merge unreachable'], { cwd: proj });
      const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: proj }).toString('utf8').trim();

      // Forge mission with one criterion
      const forged = await forgeMission(proj, { session: 's1', title: 'Test Reachability', criteria: ['a criterion'] });
      const criterionId = listCriteriaWithActions(proj, forged.missionId)[0].id;

      // Create an epic serving the criterion
      const epic = await createTodo(proj, {
        ownerSession: 's1',
        title: '[EPIC] serving unreachable',
        kind: 'epic',
        parentId: forged.missionId,
        servesCriterionIds: [criterionId],
      });

      // Record the land so the guard can read land shas
      recordEpicLand(proj, {
        epicId: epic.id,
        epicTipSha: mergeSha,
        landedMergeSha: mergeSha,
        landedAt: Date.now(),
      });

      // Assert the guard throws because the serving epic has unreachable modules
      let thrown = false;
      try {
        await assertServingEpicModulesReachable(proj, criterionId);
      } catch (e) {
        thrown = true;
      }
      expect(thrown).toBe(true);

      // Drop the epic
      await updateTodo(proj, epic.id, { status: 'dropped' });

      // Assert the guard resolves because no serving epics remain (fail-open)
      let resolvedOk = false;
      try {
        await assertServingEpicModulesReachable(proj, criterionId);
        resolvedOk = true;
      } catch (e) {
        // Should not throw
      }
      expect(resolvedOk).toBe(true);
    } finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
