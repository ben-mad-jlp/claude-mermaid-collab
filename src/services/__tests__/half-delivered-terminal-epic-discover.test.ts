// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, completeTodo, updateTodo, _closeProject, stampEpicLandedAt,
} from '../todo-store';
import {
  upsertMission, addCriterion, listCriteriaWithActions, _resetMissionDbCache,
} from '../mission-store';

describe('half-delivered terminal epic criterion action', () => {
  const withProj = async (fn: (proj: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'half-delivered-'));
    const prevEnv = process.env.MERMAID_SUPERVISOR_DIR;
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    const proj = join(dir, 'p');
    try { await fn(proj); }
    finally {
      _closeProject(proj);
      _resetMissionDbCache(proj);
      if (prevEnv === undefined) delete process.env.MERMAID_SUPERVISOR_DIR; else process.env.MERMAID_SUPERVISOR_DIR = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('a landed serving epic with one done and one dropped tagged leaf derives discover', async () => {
    await withProj(async (proj) => {
      // Create mission + criterion
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] Half-delivered', kind: 'mission' });
      upsertMission(proj, m.id);
      const c = addCriterion(proj, m.id, 'criterion proven by two leaves');

      // Create serving epic
      const epic = await createTodo(proj, {
        ownerSession: 's1',
        title: '[EPIC] serve',
        kind: 'epic',
        parentId: m.id,
        servesCriterionIds: [c.id],
      });

      // Create two tagged leaves
      const leafA = await createTodo(proj, {
        ownerSession: 's1',
        title: 'leaf A',
        kind: 'leaf',
        parentId: epic.id,
        servesCriterionIds: [c.id],
      });
      const leafB = await createTodo(proj, {
        ownerSession: 's1',
        title: 'leaf B',
        kind: 'leaf',
        parentId: epic.id,
        servesCriterionIds: [c.id],
      });

      // Complete leaf A (delivered), drop leaf B (undelivered)
      await completeTodo(proj, leafA.id, 'accepted');
      await updateTodo(proj, leafB.id, { status: 'dropped' });

      // Land the epic
      stampEpicLandedAt(proj, epic.id, new Date(0).toISOString());

      // Assert: half-delivered criterion re-derives discover (NOT verify)
      const action = listCriteriaWithActions(proj, m.id).find((x) => x.id === c.id)!.action;
      expect(action).toBe('discover');
    });
  });

  test('a landed serving epic with both tagged leaves done derives verify', async () => {
    await withProj(async (proj) => {
      // Create mission + criterion
      const m = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] Fully-delivered', kind: 'mission' });
      upsertMission(proj, m.id);
      const c = addCriterion(proj, m.id, 'criterion proven by two leaves');

      // Create serving epic
      const epic = await createTodo(proj, {
        ownerSession: 's1',
        title: '[EPIC] serve',
        kind: 'epic',
        parentId: m.id,
        servesCriterionIds: [c.id],
      });

      // Create two tagged leaves
      const leafA = await createTodo(proj, {
        ownerSession: 's1',
        title: 'leaf A',
        kind: 'leaf',
        parentId: epic.id,
        servesCriterionIds: [c.id],
      });
      const leafB = await createTodo(proj, {
        ownerSession: 's1',
        title: 'leaf B',
        kind: 'leaf',
        parentId: epic.id,
        servesCriterionIds: [c.id],
      });

      // Complete both leaves (both delivered)
      await completeTodo(proj, leafA.id, 'accepted');
      await completeTodo(proj, leafB.id, 'accepted');

      // Land the epic
      stampEpicLandedAt(proj, epic.id, new Date(0).toISOString());

      // Assert: fully-delivered criterion derives verify (normal case)
      const action = listCriteriaWithActions(proj, m.id).find((x) => x.id === c.id)!.action;
      expect(action).toBe('verify');
    });
  });
});
