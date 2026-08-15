import { describe, it, expect } from 'bun:test';
import { buildLandReadiness, type CommitProbe, type CommitProbeResult } from '../epic-land-readiness';
import type { Todo, TodoStatus } from '../todo-store';

describe('epic-land-readiness: unlanded classification', () => {
  // Helper to create test todos with all required fields
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

  // Injected probe for testing
  function makeTestProbe(cases: Map<string, CommitProbeResult>): CommitProbe {
    return async (todoId: string) => {
      const result = cases.get(todoId);
      if (!result) throw new Error(`No probe result for ${todoId}`);
      return result;
    };
  }

  it('classifies a leaf as unlanded when its trailer commit sits on the epic branch and not on main', async () => {
    const epicId = 'test1234';
    const leafId = 'leaf-123456789';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Unlanded Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: ['abc123def456'],
          onTrunk: undefined,
          anyRef: ['abc123def456'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      true // classifyUnlanded = true
    );

    // Should have exactly one finding (the unlanded leaf)
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.kind).toBe('unlanded');
    expect(finding.todoId).toBe(leafId);
    expect(finding.strayShas).toContain('abc123def456');
    expect(finding.reason).toContain('unlanded:');
    expect(finding.reason).toContain('master');
    expect(finding.reason).toContain('collab/epic/test1234');

    // Should be blocking
    expect(report.blocking).toBe(true);
  });

  it('reports blocking true while any leaf is unlanded', async () => {
    const epicId = 'abcdef12';
    const unlandedLeafId = 'leaf-unlanded1234';
    const landedLeafId = 'leaf-landed12345';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: unlandedLeafId, kind: 'leaf', title: 'Unlanded Leaf', status: 'done', parentId: epicId }),
      makeTodo({ id: landedLeafId, kind: 'leaf', title: 'Landed Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [unlandedLeafId, {
          onEpicTip: ['sha1sha1sha1'],
          onTrunk: undefined,
          anyRef: ['sha1sha1sha1'],
        }],
        [landedLeafId, {
          onEpicTip: ['sha2sha2sha2'],
          onTrunk: ['sha2sha2sha2'],
          anyRef: ['sha2sha2sha2'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      true // classifyUnlanded = true
    );

    // Should have one unlanded finding
    const unlandedFindings = report.findings.filter(f => f.kind === 'unlanded');
    expect(unlandedFindings).toHaveLength(1);

    // Blocking should be true because we have findings
    expect(report.blocking).toBe(true);
  });

  it('reports blocking false once every trailer commit is reachable from main', async () => {
    const epicId = 'xyz12345';
    const leafId = 'leaf-onmain1234567';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Landed Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: ['mastersha123456'],
          onTrunk: ['mastersha123456'],
          anyRef: ['mastersha123456'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      true // classifyUnlanded = true
    );

    // Should have no findings
    expect(report.findings).toHaveLength(0);

    // Blocking should be false
    expect(report.blocking).toBe(false);
  });

  it('respects classifyUnlanded=false and does not classify unlanded leaves', async () => {
    const epicId = 'noclass12';
    const leafId = 'leaf-noclassify123';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Unlanded Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: ['unlandedsha1234'],
          onTrunk: undefined,
          anyRef: ['unlandedsha1234'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      false // classifyUnlanded = false
    );

    // Should have no findings because classifyUnlanded is false
    expect(report.findings).toHaveLength(0);

    // Blocking should be false
    expect(report.blocking).toBe(false);
  });

  it('does not classify unlanded when trunkRef is missing', async () => {
    const epicId = 'notrunk1';
    const leafId = 'leaf-notrunkref123';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Unlanded Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: ['somesha1234567'],
          onTrunk: undefined,
          anyRef: ['somesha1234567'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      undefined, // trunkRef is undefined
      true // classifyUnlanded = true
    );

    // Should have no findings because trunkRef was not supplied
    expect(report.findings).toHaveLength(0);

    // Blocking should be false
    expect(report.blocking).toBe(false);
  });

  it('still counts duplicate commits for unlanded leaves', async () => {
    const epicId = 'dupunlan';
    const leafId = 'leaf-dupunland12345';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Unlanded Leaf with Dups', status: 'done', parentId: epicId }),
    ];

    const shas = ['dup1dup1dup1', 'dup2dup2dup2', 'dup3dup3dup3', 'dup4dup4dup4'];
    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: shas,
          onTrunk: undefined,
          anyRef: shas,
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      true // classifyUnlanded = true
    );

    // Should have one unlanded finding
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe('unlanded');

    // Should also count the duplicates (count > 2)
    expect(report.duplicateCommits).toHaveLength(1);
    expect(report.duplicateCommits[0].count).toBe(4);
    expect(report.duplicateCommits[0].shas).toEqual(shas);
  });

  it('still reports landed leaves with onTrunk normally', async () => {
    const epicId = 'landed12';
    const leafId = 'leaf-landed12345678';

    const todos: Todo[] = [
      makeTodo({ id: epicId, kind: 'epic', title: 'Test Epic', status: 'in_progress' }),
      makeTodo({ id: leafId, kind: 'leaf', title: 'Landed Leaf', status: 'done', parentId: epicId }),
    ];

    const probe = makeTestProbe(
      new Map([
        [leafId, {
          onEpicTip: ['landedsha123456'],
          onTrunk: ['landedsha123456'],
          anyRef: ['landedsha123456'],
        }],
      ])
    );

    const report = await buildLandReadiness(
      todos,
      epicId,
      probe,
      '/test/project',
      undefined,
      'master',
      true // classifyUnlanded = true
    );

    // Should have no findings for landed leaf
    expect(report.findings).toHaveLength(0);

    // Blocking should be false
    expect(report.blocking).toBe(false);
  });
});
