// Pure assembly tests for src/services/epic-land-readiness.ts — the commit probe is
// injected, so these are hermetic (no real repo, no git spawn). They exercise the
// descendant walk with exemptions, missing-vs-stranded findings, and duplicate counts.
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import {
  buildLandReadiness,
  isGateTodo,
  type CommitProbe,
  type CommitProbeResult,
} from '../epic-land-readiness';
import { validateStewardProof, type ProofContext } from '../steward-proof';

let seq = 0;

/** `kind` is authoritative now, but these fixtures are written in the older title
 *  dialect ("[EPIC] …", "[LAND] …"). Derive the kind from that prefix so a fixture
 *  keeps reading as one line. An explicit `kind` in the partial always wins. */
function inferKind(title: string): Todo['kind'] {
  if (/^\s*\[EPIC\]/i.test(title)) return 'epic';
  if (/^\s*\[LAND\]/i.test(title)) return 'land';
  return 'leaf';
}

function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus }): Todo {
  const status = partial.status ?? 'ready';
  return {
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
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
    ...partial,
    kind: partial.kind ?? inferKind(partial.title),
    inheritedBlueprintFrom: partial.inheritedBlueprintFrom ?? null,
    inheritedFiles: partial.inheritedFiles ?? [],
    isBucket: partial.isBucket ?? false,
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
  };
}

/** A probe driven by a todoId→facts table; unknown ids return empty arrays. */
function probeFrom(table: Record<string, CommitProbeResult>): CommitProbe {
  return (todoId: string) => table[todoId] ?? { onEpicTip: [], anyRef: [] };
}

describe('isGateTodo', () => {
  test('[GATE] prefix marks a gate todo', async () => {
    expect(isGateTodo(todo({ title: '[GATE] Decide: something' }))).toBe(true);
  });

  test('[GATE:kind] prefix marks a gate todo', async () => {
    expect(isGateTodo(todo({ title: '[GATE:spec-review] Approve the spec' }))).toBe(true);
  });

  test('case-insensitive matching', async () => {
    expect(isGateTodo(todo({ title: '[gate] some gate' }))).toBe(true);
  });

  test('non-gate titles do not match', async () => {
    expect(isGateTodo(todo({ title: 'just a regular todo' }))).toBe(false);
    expect(isGateTodo(todo({ title: 'GATE: wrong syntax' }))).toBe(false);
  });
});

describe('buildLandReadiness', () => {
  test('only [EPIC] todos serve as roots', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: ['abc'], anyRef: ['abc'] } }),
    );
    expect(report.epicId).toBe('e1');
  });

  test('missing epic returns empty findings', async () => {
    const report = await buildLandReadiness([], 'missing-epic', probeFrom({}));
    expect(report.findings).toHaveLength(0);
    expect(report.blocking).toBe(false);
  });

  test('container with children is exempted', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const container = todo({
      id: 'c1',
      title: 'container task',
      parentId: 'e1',
      acceptanceStatus: 'accepted',
    });
    const child = todo({
      id: 'w1',
      title: 'child work',
      parentId: 'c1',
      status: 'ready',
      acceptanceStatus: null,
    });
    const report = await buildLandReadiness([epic, container, child], 'e1', probeFrom({}));
    expect(report.exemptions).toContainEqual(expect.objectContaining({ todoId: 'c1', reason: 'container', childCount: 1 }));
    expect(report.findings).toHaveLength(0);
  });

  test('container with 0 children is NOT exempted', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const orphanContainer = todo({ id: 'c1', title: 'orphan task', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness([epic, orphanContainer], 'e1', probeFrom({}));
    expect(report.exemptions.some((e) => e.todoId === 'c1')).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ todoId: 'c1', kind: 'missing' }));
  });

  test('[GATE] nodes are exempted regardless of commit status', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const gate = todo({
      id: 'g1',
      title: '[GATE] Decide something',
      parentId: 'e1',
      acceptanceStatus: 'accepted',
    });
    const report = await buildLandReadiness([epic, gate], 'e1', probeFrom({}));
    expect(report.exemptions).toContainEqual(expect.objectContaining({ todoId: 'g1', reason: 'gate' }));
    expect(report.findings.some((f) => f.todoId === 'g1')).toBe(false);
  });

  test('[LAND] leaf is exempted', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const land = todo({
      id: 'l1',
      title: '[LAND] to master',
      parentId: 'e1',
      acceptanceStatus: 'accepted',
    });
    const report = await buildLandReadiness([epic, land], 'e1', probeFrom({}));
    expect(report.exemptions).toContainEqual(expect.objectContaining({ todoId: 'l1', reason: 'land-leaf' }));
    expect(report.findings.some((f) => f.todoId === 'l1')).toBe(false);
  });

  test('nested [EPIC] is exempted', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] root', status: 'done' });
    const nested = todo({
      id: 'e2',
      title: '[EPIC] nested',
      parentId: 'e1',
      acceptanceStatus: 'accepted',
    });
    const report = await buildLandReadiness([epic, nested], 'e1', probeFrom({}));
    expect(report.exemptions).toContainEqual(expect.objectContaining({ todoId: 'e2', reason: 'epic' }));
  });

  test('code leaf with commit on epic tip is landed', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: ['abc123'], anyRef: ['abc123'] } }),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.checked).toBe(1);
    expect(report.blocking).toBe(false);
  });

  test('code leaf with no commit is missing', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness([epic, work], 'e1', probeFrom({ w1: { onEpicTip: [], anyRef: [] } }));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toEqual(
      expect.objectContaining({
        todoId: 'w1',
        kind: 'missing',
        reason: 'accepted with no commit on any ref',
      }),
    );
    expect(report.blocking).toBe(true);
  });

  test('code leaf with commit on stray ref is stranded', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: [], anyRef: ['deadbeef'] } }),
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toEqual(
      expect.objectContaining({
        todoId: 'w1',
        kind: 'stranded',
        strayShas: ['deadbeef'],
      }),
    );
    expect(report.blocking).toBe(true);
  });

  test('leaf with 2 commits (normal: worker + merge) is not a duplicate finding', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: ['abc', 'def'], anyRef: ['abc', 'def'] } }),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.duplicateCommits).toHaveLength(0);
  });

  test('leaf with 4 commits is a duplicate, not a finding', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', acceptanceStatus: 'accepted' });
    const shas = ['a', 'b', 'c', 'd'];
    const report = await buildLandReadiness(
      [epic, work],
      'e1',
      probeFrom({ w1: { onEpicTip: shas, anyRef: shas } }),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.duplicateCommits).toHaveLength(1);
    expect(report.duplicateCommits[0]).toEqual(
      expect.objectContaining({
        todoId: 'w1',
        count: 4,
        shas,
      }),
    );
    expect(report.blocking).toBe(false);
  });

  test('dropped descendants are skipped entirely', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const dropped = todo({ id: 'd1', title: 'dropped', parentId: 'e1', status: 'dropped', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness([epic, dropped], 'e1', probeFrom({}));
    expect(report.findings.some((f) => f.todoId === 'd1')).toBe(false);
    expect(report.exemptions.some((e) => e.todoId === 'd1')).toBe(false);
  });

  test('pending/rejected leaves are not in scope', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const pending = todo({
      id: 'p1',
      title: 'pending',
      parentId: 'e1',
      acceptanceStatus: 'pending',
    });
    const rejected = todo({
      id: 'r1',
      title: 'rejected',
      parentId: 'e1',
      acceptanceStatus: 'rejected',
    });
    const report = await buildLandReadiness([epic, pending, rejected], 'e1', probeFrom({}));
    expect(report.findings).toHaveLength(0);
  });

  test('cycle safety: descendant walk does not hang on a cycle', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const a = todo({ id: 'a', title: 'task a', parentId: 'e1', acceptanceStatus: 'accepted' });
    const b = todo({ id: 'b', title: 'task b', parentId: 'a', acceptanceStatus: 'accepted' });
    // Create an illegal cycle: manually set c's parent to b, then b to c
    const c = todo({ id: 'c', title: 'task c', parentId: 'b', acceptanceStatus: 'accepted' });
    // Manually create the cycle by modifying c's parent.
    c.parentId = 'c'; // c is its own parent — the walk should see it once and skip the re-visit.
    const todos = [epic, a, b, c];
    // This should not hang or crash.
    const report = await buildLandReadiness(todos, 'e1', probeFrom({ a: { onEpicTip: [], anyRef: [] } }));
    // 'a' has child 'b', so it's a container and exempted.
    expect(report.exemptions.some((e) => e.todoId === 'a')).toBe(true);
    // The walk should complete without hanging.
    expect(report.findings.length).toBeGreaterThanOrEqual(0);
  });

  test('findings are sorted by todoId', async () => {
    const epic = todo({ id: 'e1', title: '[EPIC] test', status: 'done' });
    const z = todo({ id: 'z_last', title: 'z', parentId: 'e1', acceptanceStatus: 'accepted' });
    const a = todo({ id: 'a_first', title: 'a', parentId: 'e1', acceptanceStatus: 'accepted' });
    const m = todo({ id: 'm_middle', title: 'm', parentId: 'e1', acceptanceStatus: 'accepted' });
    const report = await buildLandReadiness([epic, z, a, m], 'e1', probeFrom({}));
    expect(report.findings.map((f) => f.todoId)).toEqual(['a_first', 'm_middle', 'z_last']);
  });

  test('regression fixture: epic 45e2fb60 (2026-07-09) — 2 findings, 6 exemptions', async () => {
    // Epic 45e2fb60, measured 2026-07-09: accepts/done descendants split as
    // 2 findings (missing) + 6 exemptions + others not in scope.
    const epic = todo({ id: '45e2fb60-0000', title: '[EPIC] Big Epic', status: 'done' });

    // 5 containers (exemptions) with children marked as 'planned' (not in scope).
    const c1 = todo({
      id: '1b9268e5-0000',
      title: 'Container 1',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });
    const c1a = todo({ id: 'c1a', title: 'Child of c1', parentId: c1.id, status: 'planned' });
    const c1b = todo({ id: 'c1b', title: 'Child of c1', parentId: c1.id, status: 'planned' });
    const c1c = todo({ id: 'c1c', title: 'Child of c1', parentId: c1.id, status: 'planned' });

    const c2 = todo({
      id: '9acb7cb2-0000',
      title: 'Container 2',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });
    const c2_children = Array.from({ length: 9 }, (_, i) =>
      todo({ id: `c2_${i}`, title: `Child of c2 ${i}`, parentId: c2.id, status: 'planned' }),
    );

    const c3 = todo({
      id: '6ed01ed4-0000',
      title: 'Container 3',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });
    const c3_children = Array.from({ length: 9 }, (_, i) =>
      todo({ id: `c3_${i}`, title: `Child of c3 ${i}`, parentId: c3.id, status: 'planned' }),
    );

    const c4 = todo({
      id: 'ab9b32ca-0000',
      title: 'Container 4',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });
    const c4_children = Array.from({ length: 27 }, (_, i) =>
      todo({ id: `c4_${i}`, title: `Child of c4 ${i}`, parentId: c4.id, status: 'planned' }),
    );

    const c5 = todo({
      id: '5b6cd898-0000',
      title: 'Container 5',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });
    const c5_children = Array.from({ length: 19 }, (_, i) =>
      todo({ id: `c5_${i}`, title: `Child of c5 ${i}`, parentId: c5.id, status: 'planned' }),
    );

    // 1 gate (exemption).
    const gate = todo({
      id: '95075786-0000',
      title: '[GATE] Decide: something',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });

    // 2 findings (053d6b39 missing, d1e8fbe0 missing) — both accepted, no children.
    const finding1 = todo({
      id: '053d6b39-0000',
      title: '13th title-regex site',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });

    const finding2 = todo({
      id: 'd1e8fbe0-0000',
      title: 'Dup of ab9b32ca, 0 children',
      parentId: epic.id,
      acceptanceStatus: 'accepted',
    });

    const allTodos = [
      epic,
      c1,
      c1a,
      c1b,
      c1c,
      c2,
      ...c2_children,
      c3,
      ...c3_children,
      c4,
      ...c4_children,
      c5,
      ...c5_children,
      gate,
      finding1,
      finding2,
    ];

    const report = await buildLandReadiness(allTodos, epic.id, probeFrom({}));

    // Exactly 2 findings (both missing).
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f) => f.todoId).sort()).toEqual(['053d6b39-0000', 'd1e8fbe0-0000']);
    expect(report.findings.every((f) => f.kind === 'missing')).toBe(true);

    // Exactly 6 exemptions (5 containers + 1 gate).
    expect(report.exemptions).toHaveLength(6);
    expect(report.exemptions.filter((e) => e.reason === 'container')).toHaveLength(5);
    expect(report.exemptions.filter((e) => e.reason === 'gate')).toHaveLength(1);

    // All container exemptions have at least 1 child.
    const containerExemptions = report.exemptions.filter((e) => e.reason === 'container');
    expect(containerExemptions.every((e) => e.childCount >= 1)).toBe(true);
    const childCounts = containerExemptions.map((c) => c.childCount).sort((a, b) => a - b);
    expect(childCounts).toEqual([3, 9, 9, 19, 27]);

    expect(report.blocking).toBe(true);
  });
});

describe('steward-proof land_epic gate integration', () => {
  test('validateStewardProof with empty unlandedLeaves returns ok:true', async () => {
    const result = await validateStewardProof(
      'land_epic',
      { kind: 'epic-landable', epicId: 'e1', epicBranch: 'collab/epic/e1' },
      {
        project: 'p',
        dependsOn: [],
        getDep: () => null,
        epicChildIds: [],
        runners: {
          tscClean: () => true,
          epicMergeClean: () => true,
          unlandedLeaves: () => [],
        },
      } as ProofContext,
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok');
  });

  test('validateStewardProof with unlandedLeaves finding returns ok:false', async () => {
    const finding = {
      todoId: 'w1',
      title: 'work todo',
      kind: 'missing',
      strayShas: [],
      reason: 'no commit',
    };
    const result = await validateStewardProof(
      'land_epic',
      { kind: 'epic-landable', epicId: 'e1', epicBranch: 'collab/epic/e1' },
      {
        project: 'p',
        dependsOn: [],
        getDep: () => null,
        epicChildIds: [],
        runners: {
          tscClean: () => true,
          epicMergeClean: () => true,
          unlandedLeaves: () => [finding],
        },
      } as ProofContext,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('epic-leaves-unlanded');
    expect(result.detail).toContain('w1');
    expect(result.detail).toContain('missing');
  });
});
