import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitProbe, CommitProbeResult } from '../epic-land-readiness';
import type { Todo, TodoStatus } from '../todo-store';

// Neutralise the childless-serve grace BEFORE mission-planner (and, transitively, harness-caps)
// is first evaluated. ESM `import` statements are evaluated depth-first BEFORE any statement in
// this module's own body runs — including a plain top-of-file `import { buildLandReadiness } from
// '../epic-land-readiness'`, which pulls in todo-store, which pulls in harness-caps and freezes
// CHILDLESS_SERVE_GRACE_MS at its 5-minute default. So every runtime (non-type-only) import used
// by either arm is pulled in via `await import(...)` below, AFTER this assignment runs. '0' is
// falsy in the harness-caps reader and would fall back to the 5-minute default, so use a truthy
// sub-default value instead.
process.env.MERMAID_CHILDLESS_SERVE_GRACE_MIN = '0.000001';

const { buildLandReadiness } = await import('../epic-land-readiness');

describe('epic-land-readiness: deleted branch (both arms)', () => {
  // --- Arm 1: readiness ---------------------------------------------------
  let todoSeq = 0;
  function makeTodo(partial: Partial<Todo> & { title: string; status?: TodoStatus; kind?: Todo['kind']; id?: string }): Todo {
    const status = partial.status ?? 'ready';
    return {
      id: partial.id ?? `todo-${++todoSeq}`,
      ownerSession: 's',
      assigneeSession: null,
      assigneeKind: 'agent',
      title: partial.title,
      description: partial.description ?? null,
      status,
      completed: status === 'done',
      priority: null,
      dueDate: null,
      parentId: partial.parentId ?? null,
      dependsOn: [],
      order: 0,
      link: null,
      createdAt: '',
      updatedAt: '',
      completedAt: null,
      asanaGid: null,
      sessionName: null,
      executedBySession: null,
      blueprintId: null,
      type: null,
      targetProject: null,
      kind: partial.kind ?? 'leaf',
      acceptanceStatus: null,
      claimedBy: null,
      claimToken: null,
      claimedAt: null,
      claimLeaseMs: null,
      claim: null,
      approvedAt: null,
      approvedBy: null,
      heldAt: null,
      heldReason: null,
      retryCount: 0,
      completedBy: null,
      objectRef: null,
      servesCriterionId: null,
      servesCriterionIds: [],
      decisionRef: null,
      claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      declaredFiles: [],
      isBucket: false,
      nickname: 'nick',
    };
  }

  function makeTestProbe(cases: Map<string, CommitProbeResult>): CommitProbe {
    return async (todoId: string) => {
      const result = cases.get(todoId);
      if (!result) throw new Error(`No probe result for ${todoId}`);
      return result;
    };
  }

  it('a landed epic whose branch was deleted reports blocking:false with zero stranded findings', async () => {
    const epicId = 'deadbeef';
    const leaf1Id = 'leaf-deleted-branch-1';
    const leaf2Id = 'leaf-deleted-branch-2';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Deleted Branch Epic', status: 'in_progress' }),
      makeTodo({ id: leaf1Id, kind: 'leaf', title: 'Leaf One', status: 'done', parentId: epicId }),
      makeTodo({ id: leaf2Id, kind: 'leaf', title: 'Leaf Two', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leaf1Id, { onEpicTip: [], onTrunk: ['sha1sha1sha1'], anyRef: ['sha1sha1sha1'] }],
        [leaf2Id, { onEpicTip: [], onTrunk: ['sha2sha2sha2'], anyRef: ['sha2sha2sha2'] }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'main',
      true,
    );

    expect(report.blocking).toBe(false);
    expect(report.findings.length).toBe(0);
    expect(report.findings.filter((f) => f.kind === 'stranded')).toHaveLength(0);
    expect(report.findings.filter((f) => f.kind === 'missing')).toHaveLength(0);
    expect(report.checked).toBe(2);
  });

  // --- Arm 2: planner -------------------------------------------------------
  it('plan_mission_criterion accepts a criterion served by a branch-deleted landed epic', async () => {
    const SUP_DIR = mkdtempSync(join(tmpdir(), 'epic-land-readiness-deleted-branch-sup-'));
    process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

    const { forgeMission } = await import('../../mcp/tools/mission-forge');
    const { planMissionCriterion, ServeIntegrityError } = await import('../../mcp/tools/mission-planner');
    const { listCriteria, _resetMissionDbCache } = await import('../mission-store');
    const { createTodo, _closeProject: closeTodos } = await import('../todo-store');
    const { _closeProject: closeDecisions } = await import('../decision-record-store');

    const project = mkdtempSync(join(tmpdir(), 'epic-land-readiness-deleted-branch-'));
    _resetMissionDbCache(project);
    try {
      const forged = await forgeMission(project, {
        session: 's1',
        title: 'Branch-deleted landed epic',
        criteria: ['the branch-deleted landed epic still lets a fresh plan through'],
      });
      const criterionId = listCriteria(project, forged.missionId)[0].id;

      const fixtureEpic = await createTodo(project, {
        ownerSession: 's1',
        kind: 'epic',
        title: 'Landed epic whose branch is gone',
        parentId: forged.missionId,
        status: 'done',
        servesCriterionIds: [criterionId],
      });

      // Let the fixture epic's createdAt fall outside the (now sub-millisecond) childless-serve
      // grace window before calling the planner, so a same-millisecond createdAt cannot tie.
      await new Promise((r) => setTimeout(r, 5));

      const EPIC_SPEC = {
        title: 'Re-plan the criterion after the branch was deleted',
        description: 'Fresh epic for the same criterion.',
        leaves: [
          { title: 'do the work', description: 'edit the relevant file', files: ['src/services/leaf-executor.ts'] },
        ],
      };
      const invoke = async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(EPIC_SPEC) + '\n```' } as any);

      let result: Awaited<ReturnType<typeof planMissionCriterion>> | undefined;
      let thrown: unknown;
      try {
        result = await planMissionCriterion(
          project,
          { session: 's1', missionId: forged.missionId, criterionIds: [criterionId] },
          {
            invoke,
            resolveActions: () => [{ id: criterionId, action: 'discover', servingEpicState: 'none' }] as any,
            unlandedArmDeps: {
              isEpicLandedInGit: async () => 'landed',
              detectTrunkBranch: async () => 'main',
            },
          },
        );
      } catch (e) {
        thrown = e;
      }

      if (thrown) {
        if (thrown instanceof ServeIntegrityError && (thrown as any).code === 'unlanded-done-epic') {
          throw thrown;
        }
        throw thrown;
      }

      expect(result).toBeDefined();
      expect(typeof result!.epicId).toBe('string');
      expect(result!.epicId.length).toBeGreaterThan(0);
      expect(result!.epicId).not.toBe(fixtureEpic.id);
    } finally {
      _resetMissionDbCache(project);
      closeTodos(project);
      closeDecisions(project);
      rmSync(project, { recursive: true, force: true });
      rmSync(SUP_DIR, { recursive: true, force: true });
    }
  });
});
