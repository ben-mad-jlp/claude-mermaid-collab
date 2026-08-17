// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// FIX: repair-forge pairing — buildRepairMissionSpec derives criteria AND consumesTodoIds
// from a SINGLE paired list filtered by non-empty trimmed fixedMeans.
//
// Previously, criteria and consumesTodoIds were built independently from batch,
// so an item with whitespace-only fixedMeans would be dropped from criteria but NOT
// from consumesTodoIds. This caused consumeBucketItems to mark it done+promotedTo while
// NO criterion in the mission covered it — the request was silently retired unfixed.
//
// The fix pairs the item to its criterion text, filters by non-empty trim,
// and derives both arrays from the single paired list so index i names the same item.
//
// Three properties under test:
//   1. items whose spec.fixedMeans becomes a criterion are promoted; items dropped
//      by the trim filter are left open and eligible.
//   2. the title count (parsed from spec.title) equals spec.criteria.length, not batch.length.
//   3. if criteria generation rejects one item (uncitable), the forge propagates the error
//      without consuming any items.
//
// Hermetic: every test runs against a fresh mkdtemp project; no real .collab/*.db and no
// ~/.mermaid-collab access.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _closeProject,
  createTodo,
  getTodo,
  listTodos,
} from '../todo-store';
import {
  listMissions,
  listCriteria,
  _resetMissionDbCache,
} from '../mission-store';
import { ensureBucket } from '../bucket-registry';
import {
  buildRepairMissionSpec,
  type RepairBatchItem,
} from '../repair-mission-forge';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { runRepairForgePass, _resetRepairForgeThrottle } from '../repair-mission-pass';
import { _closeLedgerDb } from '../worker-ledger';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'repair-forge-consumption-parity-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('repair-forge consumption parity', () => {
  it('promotes exactly the items whose specs became criteria', async () => {
    const bucketId = await ensureBucket(project, 'bugfix');

    // Create three bugfix leaves with specs: citable, whitespace-only, citable.
    const leaf1 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 1',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 1',
        evidence: '/test/path.ts:10',
        fixedMeans: 'First criterion text',
      },
    });

    const leaf2 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 2',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 2',
        evidence: '/test/path.ts:11',
        fixedMeans: '   ', // whitespace-only — will be filtered out
      },
    });

    const leaf3 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 3',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 3',
        evidence: '/test/path.ts:12',
        fixedMeans: 'Third criterion text',
      },
    });

    // Build the batch manually (include the whitespace-only item).
    const batch: RepairBatchItem[] = [
      {
        request: {
          id: leaf1.id,
          title: leaf1.title,
          description: leaf1.description,
          bugfixSpec: leaf1.bugfixSpec,
          createdAt: new Date(leaf1.createdAt).toISOString(),
        },
        spec: leaf1.bugfixSpec!,
      },
      {
        request: {
          id: leaf2.id,
          title: leaf2.title,
          description: leaf2.description,
          bugfixSpec: leaf2.bugfixSpec,
          createdAt: new Date(leaf2.createdAt).toISOString(),
        },
        spec: leaf2.bugfixSpec!,
      },
      {
        request: {
          id: leaf3.id,
          title: leaf3.title,
          description: leaf3.description,
          bugfixSpec: leaf3.bugfixSpec,
          createdAt: new Date(leaf3.createdAt).toISOString(),
        },
        spec: leaf3.bugfixSpec!,
      },
    ];

    // Build spec (will drop the whitespace item) and forge.
    const spec = buildRepairMissionSpec(batch);
    expect(spec.criteria.length).toBe(2); // Only citable ones
    expect(spec.consumesTodoIds.length).toBe(2);

    const forgeResult = await forgeMission(project, {
      session: 'test-session',
      title: spec.title,
      description: spec.description,
      criteria: spec.criteria,
      budgetUsd: spec.budgetUsd,
      consumesTodoIds: spec.consumesTodoIds,
    });

    const missionId = forgeResult.missionId;

    // Verify leaf1 and leaf3 are done + promotedTo
    const leafAfter1 = getTodo(project, leaf1.id)!;
    expect(leafAfter1.status).toBe('done');
    expect(leafAfter1.promotedTo).toBe(missionId);

    const leafAfter2 = getTodo(project, leaf2.id)!;
    expect(leafAfter2.status).not.toBe('done');
    expect(leafAfter2.promotedTo).toBe(null);

    const leafAfter3 = getTodo(project, leaf3.id)!;
    expect(leafAfter3.status).toBe('done');
    expect(leafAfter3.promotedTo).toBe(missionId);
  });

  test('derives the title count from the criteria actually created', async () => {
    const bucketId = await ensureBucket(project, 'bugfix');

    // Create three bugfix leaves: citable, whitespace-only, citable.
    const leaf1 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 1',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 1',
        evidence: '/test/path.ts:10',
        fixedMeans: 'First criterion',
      },
    });

    const leaf2 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 2',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 2',
        evidence: '/test/path.ts:11',
        fixedMeans: '   ', // whitespace-only
      },
    });

    const leaf3 = await createTodo(project, {
      ownerSession: 'test-session',
      kind: 'leaf',
      title: 'Bugfix 3',
      parentId: bucketId,
      bugfixSpec: {
        observedFailure: 'Observed failure 3',
        evidence: '/test/path.ts:12',
        fixedMeans: 'Third criterion',
      },
    });

    const batch: RepairBatchItem[] = [
      {
        request: {
          id: leaf1.id,
          title: leaf1.title,
          description: leaf1.description,
          bugfixSpec: leaf1.bugfixSpec,
          createdAt: new Date(leaf1.createdAt).toISOString(),
        },
        spec: leaf1.bugfixSpec!,
      },
      {
        request: {
          id: leaf2.id,
          title: leaf2.title,
          description: leaf2.description,
          bugfixSpec: leaf2.bugfixSpec,
          createdAt: new Date(leaf2.createdAt).toISOString(),
        },
        spec: leaf2.bugfixSpec!,
      },
      {
        request: {
          id: leaf3.id,
          title: leaf3.title,
          description: leaf3.description,
          bugfixSpec: leaf3.bugfixSpec,
          createdAt: new Date(leaf3.createdAt).toISOString(),
        },
        spec: leaf3.bugfixSpec!,
      },
    ];

    const spec = buildRepairMissionSpec(batch);

    // Parse the title to extract the count.
    // Format: "Auto-forge repair mission: 2 bugfixes"
    const titleMatch = spec.title.match(/(\d+) bugfix/);
    expect(titleMatch).toBeTruthy();
    const titleCount = parseInt(titleMatch![1], 10);

    // The title count should equal criteria.length (2), not batch.length (3).
    expect(titleCount).toBe(spec.criteria.length);
    expect(titleCount).toBe(2);
    expect(titleCount).not.toBe(batch.length);
  });

  it('forges the citable four and leaves the uncitable candidate eligible', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed enough bugfix leaves to trigger a batch (threshold: 5).
    // One item will have an uncitable criterion (command-result).
    const leafIds: string[] = [];
    let uncitableLeafId: string | null = null;
    for (let i = 0; i < 5; i++) {
      const leaf = await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans:
            i === 1 ? 'all tests pass and the build is green' // UNCITABLE: command result
              : `Fixed means criterion ${i + 1}`,
        },
      });
      leafIds.push(leaf.id);
      if (i === 1) uncitableLeafId = leaf.id;
    }

    const missionsBefore = listMissions(project, { withFacts: false, includeArchived: true });

    // Run the pass with the real forgeMission. The pre-validation should partition the batch,
    // card the uncitable item, and forge the citable 4.
    const result = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
    });

    // The pass should have forged successfully with 4 criteria.
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBe(null);
    expect(result.forged!.criteriaCount).toBe(4);
    expect(result.forged!.consumed.length).toBe(4);

    // Verify one new mission was created
    const missionsAfter = listMissions(project, { withFacts: false, includeArchived: true });
    expect(missionsAfter.length).toBe(missionsBefore.length + 1);

    // Verify the uncitable leaf is not in consumed and is still eligible
    expect(result.forged!.consumed).not.toContain(uncitableLeafId);
    const uncitableLeaf = getTodo(project, uncitableLeafId!)!;
    expect(uncitableLeaf.status).not.toBe('done');
    expect(uncitableLeaf.promotedTo).toBe(null);

    // Verify the other 4 leaves are promoted
    for (const leafId of leafIds) {
      const leaf = getTodo(project, leafId)!;
      if (leafId === uncitableLeafId) {
        expect(leaf.status).not.toBe('done');
        expect(leaf.promotedTo).toBe(null);
      } else {
        expect(leaf.status).toBe('done');
        expect(leaf.promotedTo).toBe(result.forged!.missionId);
      }
    }
  });

  it('increases the mission count by exactly 1 when criteria generation rejects one', async () => {
    _resetRepairForgeThrottle(project);
    const bucketId = await ensureBucket(project, 'bugfix');

    // Seed 5 bugfix leaves, with index 1 carrying an uncitable criterion.
    for (let i = 0; i < 5; i++) {
      await createTodo(project, {
        ownerSession: 'test-session',
        kind: 'leaf',
        title: `Bugfix ${i + 1}`,
        parentId: bucketId,
        bugfixSpec: {
          observedFailure: `Observed failure ${i + 1}`,
          evidence: `/test/path.ts:${10 + i}`,
          fixedMeans:
            i === 1 ? 'all tests pass and the build is green' // UNCITABLE: command result
              : `Fixed means criterion ${i + 1}`,
        },
      });
    }

    const before = listMissions(project, { withFacts: false, includeArchived: true }).length;

    // Run the pass; pre-validation will partition and card the uncitable item,
    // then forge the 4 citable items.
    const result = await runRepairForgePass(project, {
      threshold: 5,
      forge: forgeMission,
      createEscalation: () => ({
        escalation: {} as any,
        isNew: true,
      }),
    });

    // The pass should have forged successfully.
    expect(result.reason).toBe('forged');
    expect(result.forged).not.toBe(null);

    // Mission count must increase by exactly 1.
    const after = listMissions(project, { withFacts: false, includeArchived: true }).length;
    expect(after).toBe(before + 1);
  });
});
