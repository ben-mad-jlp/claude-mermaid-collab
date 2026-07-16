import { describe, it, expect, beforeEach } from 'bun:test';
import { rmSync } from 'node:fs';
import { parseSplitDecision, hasCycle, topoSortSplitItems, type LeafSplitDecision, type LeafSplitItem } from '../split-decision';
import { parseSizeManifest, type LeafSizeManifest } from '../leaf-executor';
import { createTodo, getTodo, listTodos, splitLeafInto, _closeProject, type Todo } from '../todo-store';
import type { ClaimStruct } from '../todo-store';

describe('parseSplitDecision (validation)', () => {
  it('split:false + reason, many files ⇒ valid decision', () => {
    const raw = { split: false, reason: 'shared lock protocol', items: [] };
    const result = parseSplitDecision(raw);
    expect(result).toEqual({ split: false, reason: 'shared lock protocol', items: [] });
  });

  it('well-formed split:true with 2+ items ⇒ parsed, ids/edges intact', () => {
    const raw = {
      split: true,
      reason: 'independent units',
      items: [
        { id: 'a', files: ['a.ts', 'a-helper.ts'], dependsOn: [] },
        { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
      ],
    };
    const result = parseSplitDecision(raw);
    expect(result?.split).toBe(true);
    expect(result?.items.length).toBe(2);
    expect(result?.items[0].files).toEqual(['a.ts', 'a-helper.ts']);
    expect(result?.items[1].dependsOn).toEqual(['a']);
  });

  it('split:false ignores items', () => {
    const raw = {
      split: false,
      reason: 'coupled',
      items: [{ id: 'a', files: ['a.ts'], dependsOn: [] }],
    };
    const result = parseSplitDecision(raw);
    expect(result?.items).toEqual([]);
  });

  it('missing split key ⇒ null', () => {
    expect(parseSplitDecision({ reason: 'x' })).toBeNull();
  });

  it('missing reason key ⇒ null', () => {
    expect(parseSplitDecision({ split: true, items: [] })).toBeNull();
  });

  it('empty reason string ⇒ null', () => {
    expect(parseSplitDecision({ split: true, reason: '', items: [] })).toBeNull();
  });

  it('split:true with 1 item ⇒ null (not a split)', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [{ id: 'a', files: ['a.ts'], dependsOn: [] }],
    })).toBeNull();
  });

  it('duplicate ids ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [
        { id: 'a', files: ['a.ts'], dependsOn: [] },
        { id: 'a', files: ['b.ts'], dependsOn: [] },
      ],
    })).toBeNull();
  });

  it('dangling dependsOn ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [
        { id: 'a', files: ['a.ts'], dependsOn: ['missing'] },
        { id: 'b', files: ['b.ts'], dependsOn: [] },
      ],
    })).toBeNull();
  });

  it('self-dependency ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [
        { id: 'a', files: ['a.ts'], dependsOn: ['a'] },
        { id: 'b', files: ['b.ts'], dependsOn: [] },
      ],
    })).toBeNull();
  });

  it('2-cycle ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [
        { id: 'a', files: ['a.ts'], dependsOn: ['b'] },
        { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
      ],
    })).toBeNull();
  });

  it('item with files:[] ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: [
        { id: 'a', files: [], dependsOn: [] },
        { id: 'b', files: ['b.ts'], dependsOn: [] },
      ],
    })).toBeNull();
  });

  it('items not an array ⇒ null', () => {
    expect(parseSplitDecision({
      split: true,
      reason: 'x',
      items: { id: 'a', files: ['a.ts'] },
    })).toBeNull();
  });

  it('not an object ⇒ null', () => {
    expect(parseSplitDecision('not an object')).toBeNull();
    expect(parseSplitDecision(null)).toBeNull();
    expect(parseSplitDecision(undefined)).toBeNull();
  });
});

describe('hasCycle (cycle detection)', () => {
  it('no cycle (linear chain)', () => {
    const items: LeafSplitItem[] = [
      { id: 'a', files: ['a.ts'], dependsOn: [] },
      { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
      { id: 'c', files: ['c.ts'], dependsOn: ['b'] },
    ];
    expect(hasCycle(items)).toBe(false);
  });

  it('2-cycle', () => {
    const items: LeafSplitItem[] = [
      { id: 'a', files: ['a.ts'], dependsOn: ['b'] },
      { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
    ];
    expect(hasCycle(items)).toBe(true);
  });

  it('3-cycle', () => {
    const items: LeafSplitItem[] = [
      { id: 'a', files: ['a.ts'], dependsOn: ['b'] },
      { id: 'b', files: ['b.ts'], dependsOn: ['c'] },
      { id: 'c', files: ['c.ts'], dependsOn: ['a'] },
    ];
    expect(hasCycle(items)).toBe(true);
  });

  it('empty items ⇒ no cycle', () => {
    expect(hasCycle([])).toBe(false);
  });
});

describe('topoSortSplitItems (topological sort)', () => {
  it('linear chain sorts correctly', () => {
    const items: LeafSplitItem[] = [
      { id: 'c', files: ['c.ts'], dependsOn: ['b'] },
      { id: 'a', files: ['a.ts'], dependsOn: [] },
      { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
    ];
    const sorted = topoSortSplitItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('diamond DAG (two paths to a tail)', () => {
    const items: LeafSplitItem[] = [
      { id: 'root', files: ['root.ts'], dependsOn: [] },
      { id: 'left', files: ['left.ts'], dependsOn: ['root'] },
      { id: 'right', files: ['right.ts'], dependsOn: ['root'] },
      { id: 'tail', files: ['tail.ts'], dependsOn: ['left', 'right'] },
    ];
    const sorted = topoSortSplitItems(items);
    expect(sorted.map((i) => i.id)).toEqual(['root', 'left', 'right', 'tail']);
  });

  it('throws on cycle', () => {
    const items: LeafSplitItem[] = [
      { id: 'a', files: ['a.ts'], dependsOn: ['b'] },
      { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
    ];
    expect(() => topoSortSplitItems(items)).toThrow();
  });

  it('empty items returns empty', () => {
    expect(topoSortSplitItems([])).toEqual([]);
  });
});

describe('parseSizeManifest with splitDecision', () => {
  it('split:false + reason, 12 files ⇒ splitDecision present, no malformed', () => {
    const manifestText = '# bp\n\n```json\n' + JSON.stringify({
      schemaVersion: 1,
      estimatedFiles: 12,
      estimatedTasks: 2,
      nonEnumerableFanout: false,
      filesToCreate: Array(12).fill(0).map((_, i) => `f${i}.ts`),
      filesToEdit: [],
      tasks: [],
      splitDecision: { split: false, reason: 'shared lock', items: [] },
    }) + '\n```';
    const result = parseSizeManifest(manifestText);
    expect(result?.splitDecision?.split).toBe(false);
    expect(result?.splitDecisionMalformed).toBeUndefined();
  });

  it('malformed splitDecision (split:true, items:[]) ⇒ malformed flag, no decision', () => {
    const manifestText = '# bp\n\n```json\n' + JSON.stringify({
      schemaVersion: 1,
      estimatedFiles: 2,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: ['a.ts'],
      filesToEdit: ['b.ts'],
      tasks: [],
      splitDecision: { split: true, reason: 'x', items: [] },
    }) + '\n```';
    const result = parseSizeManifest(manifestText);
    expect(result?.splitDecisionMalformed).toBe(true);
    expect(result?.splitDecision).toBeUndefined();
  });

  it('no splitDecision key ⇒ neither field set (legacy)', () => {
    const manifestText = '# bp\n\n```json\n' + JSON.stringify({
      schemaVersion: 1,
      estimatedFiles: 2,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: ['a.ts'],
      filesToEdit: ['b.ts'],
      tasks: [],
    }) + '\n```';
    const result = parseSizeManifest(manifestText);
    expect(result?.splitDecision).toBeUndefined();
    expect(result?.splitDecisionMalformed).toBeUndefined();
  });

  it('well-formed items (multi-file) ⇒ parsed', () => {
    const manifestText = '# bp\n\n```json\n' + JSON.stringify({
      schemaVersion: 1,
      estimatedFiles: 4,
      estimatedTasks: 2,
      nonEnumerableFanout: false,
      filesToCreate: [],
      filesToEdit: [],
      tasks: [],
      splitDecision: {
        split: true,
        reason: 'independent units',
        items: [
          { id: 'store', files: ['store.ts', 'store.test.ts'], dependsOn: [] },
          { id: 'parenting', files: ['parenting.ts'], dependsOn: ['store'] },
        ],
      },
    }) + '\n```';
    const result = parseSizeManifest(manifestText);
    expect(result?.splitDecision?.split).toBe(true);
    expect(result?.splitDecision?.items.length).toBe(2);
    expect(result?.splitDecision?.items[0].files).toEqual(['store.ts', 'store.test.ts']);
    expect(result?.splitDecision?.items[1].dependsOn).toEqual(['store']);
  });
});

describe('splitLeafInto with items', () => {
  // These tests split leaves into a PERSISTENT on-disk 'proj-test' DB. Without a reset, a
  // prior run's accumulated children inflate childIds counts (Received > Expected) — a
  // test-isolation flake. Clear the DB before each test so counts are deterministic.
  beforeEach(() => {
    _closeProject('proj-test');
    rmSync('proj-test', { recursive: true, force: true });
  });

  // Helper to create a leaf with minimal setup.
  function makeLeaf(overrides: Partial<Todo> = {}): Todo {
    return {
      id: 'leaf-test',
      kind: 'leaf' as const,
      ownerSession: 'coordinator',
      assigneeSession: null,
      assigneeKind: 'agent' as const,
      title: 'Test Leaf',
      description: 'test',
      status: 'in_progress' as const,
      completed: false,
      priority: null,
      dueDate: null,
      parentId: null,
      dependsOn: [],
      order: 0,
      link: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      asanaGid: null,
      sessionName: 'test-session',
      executedBySession: null,
      blueprintId: null,
      type: null,
      targetProject: null,
      acceptanceStatus: null,
      claimedBy: null,
      claimToken: null,
      claimedAt: null,
      claimLeaseMs: null,
      claim: null as unknown as ClaimStruct | null,
      approvedAt: null,
      approvedBy: null,
      heldAt: null,
      heldReason: null,
      retryCount: 0,
      completedBy: null,
      objectRef: null,
      servesCriterionId: null, servesCriterionIds: [],
      decisionRef: null,
      claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      isBucket: false,
      ...overrides,
    };
  }

  // Note: these tests create todos in a real SQLite DB via bun:sqlite.
  // They are integration tests that exercise the real createTodo + listTodos paths.
  // For a full test suite, also verify cleanup + idempotence.

  it('two items with edges ⇒ two children, edge preserved', async () => {
    const leaf = makeLeaf({ id: 'leaf-edges-test' });
    const result = await splitLeafInto('proj-test', leaf, [
      { id: 'mod-a', files: ['a.ts'], dependsOn: [] },
      { id: 'mod-b', files: ['b.ts'], dependsOn: ['mod-a'] },
    ]);
    expect(result.childIds.length).toBe(2);
    const childB = getTodo('proj-test', result.childIds[1]);
    expect(childB?.dependsOn).toContain(result.childIds[0]); // child b depends on child a
    expect(childB?.status).toBe('planned');
  });

  it('multi-file item ⇒ ONE child, not per-file split', async () => {
    const leaf = makeLeaf({ id: 'leaf-multifile-test' });
    const result = await splitLeafInto('proj-test', leaf, [
      { id: 'multi', files: ['a.ts', 'b.ts', 'c.ts'], dependsOn: [] },
    ]);
    expect(result.childIds.length).toBe(1);
    const child = getTodo('proj-test', result.childIds[0]);
    expect(child?.title).toContain('a.ts, b.ts, c.ts');
  });

  it('legacy string[] ⇒ one edgeless child per file (back-compat)', async () => {
    const leaf = makeLeaf({ id: 'leaf-legacy-test' });
    const result = await splitLeafInto('proj-test', leaf, ['a.ts', 'b.ts']);
    expect(result.childIds.length).toBe(2);
    const childA = getTodo('proj-test', result.childIds[0]);
    expect(childA?.dependsOn.length).toBe(0);
    expect(childA?.title).toContain('a.ts');
  });

  it('re-entrancy: second split on a leaf with live children is a no-op', async () => {
    const leaf = makeLeaf({ id: 'leaf-idempotent' });
    const result1 = await splitLeafInto('proj-test', leaf, ['a.ts']);
    const result2 = await splitLeafInto('proj-test', leaf, ['a.ts', 'b.ts', 'c.ts']);
    expect(result2.childIds).toEqual(result1.childIds); // no new children
  });

  it('complex DAG: regression test for 6ed01ed4 shape', async () => {
    const leaf = makeLeaf({ id: 'leaf-complex-dag' });
    const items: LeafSplitItem[] = [
      { id: 'store', files: ['store.ts'], dependsOn: [] },
      { id: 'parenting', files: ['parenting.ts'], dependsOn: ['store'] },
      { id: 'tests', files: ['tests.ts'], dependsOn: ['parenting'] },
      { id: 'mcp', files: ['mcp-tool.ts'], dependsOn: ['parenting'] },
      { id: 'api', files: ['api-route.ts'], dependsOn: ['parenting'] },
    ];
    const result = await splitLeafInto('proj-test', leaf, items);
    expect(result.childIds.length).toBe(5);
    // Verify the DAG structure
    const childIds = result.childIds;
    const storeId = childIds[0];
    const parentingId = childIds[1];
    const testsId = childIds[2];
    const mcpId = childIds[3];
    const apiId = childIds[4];
    const testsChild = getTodo('proj-test', testsId);
    const mcpChild = getTodo('proj-test', mcpId);
    const apiChild = getTodo('proj-test', apiId);
    expect(testsChild?.dependsOn).toContain(parentingId);
    expect(mcpChild?.dependsOn).toContain(parentingId);
    expect(apiChild?.dependsOn).toContain(parentingId);
  });
});
