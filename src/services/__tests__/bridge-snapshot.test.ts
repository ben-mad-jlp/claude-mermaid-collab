import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'bridge-snapshot-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { buildBridgeSnapshot } from '../bridge-snapshot';
import { createTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import {
  _resetCampaignDbCache,
  createCampaign,
  listProbes,
  recordProbeVerdict,
  recordCampaignCompletion,
} from '../campaign-store';

let project: string;

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'bridge-snapshot-'));
});

afterEach(() => {
  _resetCampaignDbCache();
  _closeAllCollabDbs();
  _closeProject(project);
  _closeLedgerDb();
  rmSync(project, { recursive: true, force: true });
});

describe('buildBridgeSnapshot', () => {
  test('exposes exactly the seven snapshot keys regardless of failures', async () => {
    const result = await buildBridgeSnapshot(project);
    expect(Object.keys(result).sort()).toEqual(
      ['campaigns', 'coverage', 'missions', 'openEscalations', 'projects', 'summaries', 'todos'].sort(),
    );
  });

  test('a throwing projects reader degrades projects to [] while the other five populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listWatchedProjects: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.projects).toEqual([]);
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.missions).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.coverage).not.toBeNull();
    expect(result.summaries).toEqual([]);
  });

  test('a throwing todos reader degrades todos to [] while the other five populate', async () => {
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listTodos: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.todos).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.coverage).not.toBeNull();
    expect(result.summaries).toEqual([]);
  });

  test('a throwing missions reader degrades missions to [] while the other five populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listMissions: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.missions).toEqual([]);
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.coverage).not.toBeNull();
    expect(result.summaries).toEqual([]);
  });

  test('a throwing escalations reader degrades openEscalations to [] while the other five populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listOpenEscalations: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.openEscalations).toEqual([]);
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.coverage).not.toBeNull();
    expect(result.summaries).toEqual([]);
  });

  test('a throwing coverage reader degrades coverage to null while the other five populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        specCoverage: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.coverage).toBeNull();
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  test('a throwing summaries reader degrades summaries to [] while the other five populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        snapshotSummaryMessages: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.summaries).toEqual([]);
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.coverage).not.toBeNull();
  });

  test('serverIds filters escalations to the union of the given ids and narrows to a single id', async () => {
    const { escalation: e1 } = createEscalation({
      project,
      session: 's1',
      kind: 'test',
      questionText: 'Q1',
      serverId: 'server-1',
      audience: 'human',
    });
    const { escalation: e2 } = createEscalation({
      project,
      session: 's1',
      kind: 'test',
      questionText: 'Q2',
      serverId: 'server-2',
      audience: 'human',
    });
    const { escalation: e3 } = createEscalation({
      project,
      session: 's1',
      kind: 'test',
      questionText: 'Q3',
      serverId: 'server-3',
      audience: 'human',
    });

    const resultAll = await buildBridgeSnapshot(project);
    expect(resultAll.openEscalations.length).toBe(3);

    const resultFiltered = await buildBridgeSnapshot(project, {
      serverIds: ['server-1', 'server-2'],
    });
    expect(resultFiltered.openEscalations.length).toBe(2);
    expect(resultFiltered.openEscalations.map((e) => e.id)).toContain(e1.id);
    expect(resultFiltered.openEscalations.map((e) => e.id)).toContain(e2.id);
    expect(resultFiltered.openEscalations.map((e) => e.id)).not.toContain(e3.id);

    const resultSingle = await buildBridgeSnapshot(project, {
      serverIds: ['server-3'],
    });
    expect(resultSingle.openEscalations.length).toBe(1);
    expect(resultSingle.openEscalations[0]!.id).toBe(e3.id);
  });

  test('pagination.todosLimit clamps at MAX_BRIDGE_TODOS_LIMIT', async () => {
    for (let i = 0; i < 100; i++) {
      await createTodo(project, {
        allowOrphan: true,
        ownerSession: 's1',
        title: `Todo ${i}`,
        kind: 'leaf',
      });
    }

    const resultUnlimited = await buildBridgeSnapshot(project, {
      pagination: { todosLimit: 1000000 },
    });
    expect(resultUnlimited.todos.length).toBeLessThanOrEqual(1000);

    const resultClamped = await buildBridgeSnapshot(project, {
      pagination: { todosLimit: 500 },
    });
    expect(resultClamped.todos.length).toBeLessThanOrEqual(500);
  });

  test('pagination.missionsLimit clamps at MAX_BRIDGE_MISSIONS_LIMIT', async () => {
    const resultClamped = await buildBridgeSnapshot(project, {
      pagination: { missionsLimit: 1000000 },
    });
    expect(resultClamped.missions.length).toBeLessThanOrEqual(200);
  });

  test('view=core skips coverage and summaries readers', async () => {
    const coverageCalls: number[] = [];
    const summariesCalls: number[] = [];

    const result = await buildBridgeSnapshot(project, {
      view: 'core',
      deps: {
        specCoverage: () => {
          coverageCalls.push(1);
          throw new Error('should not be called in core view');
        },
        snapshotSummaryMessages: () => {
          summariesCalls.push(1);
          throw new Error('should not be called in core view');
        },
      },
    });

    expect(coverageCalls.length).toBe(0);
    expect(summariesCalls.length).toBe(0);
    expect(result.coverage).toBeNull();
    expect(result.summaries).toEqual([]);
  });

  test('view=full (default) reads coverage and summaries', async () => {
    const coverageCalls: number[] = [];
    const summariesCalls: number[] = [];

    await buildBridgeSnapshot(project, {
      view: 'full',
      deps: {
        specCoverage: () => {
          coverageCalls.push(1);
          return { total: 0, covered: 0, partial: 0, uncovered: 0, stale: 0, byObject: [] };
        },
        snapshotSummaryMessages: () => {
          summariesCalls.push(1);
          return [];
        },
      },
    });

    expect(coverageCalls.length).toBe(1);
    expect(summariesCalls.length).toBe(1);
  });

  test('missions pagination cursor: starting after an id yields next page items', async () => {
    // Create some test data
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });

    const result1 = await buildBridgeSnapshot(project, {
      pagination: { missionsLimit: 10 },
    });

    if (result1.missions.length > 0) {
      const firstId = result1.missions[0]!.node.id;
      const result2 = await buildBridgeSnapshot(project, {
        pagination: { missionsLimit: 10, missionsCursor: firstId },
      });
      const result2Ids = result2.missions.map((m) => m.node.id);
      expect(result2Ids).not.toContain(firstId);
    }
  });

  test('all sources throwing still resolves with all keys present and degraded', async () => {
    const boom = () => {
      throw new Error('boom');
    };
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listWatchedProjects: boom,
        listTodos: boom,
        listMissions: boom,
        listOpenEscalations: boom,
        specCoverage: boom,
        listCampaignsForSnapshot: boom,
        snapshotSummaryMessages: boom,
      },
    });

    expect(Object.keys(result).sort()).toEqual(
      ['campaigns', 'coverage', 'missions', 'openEscalations', 'projects', 'summaries', 'todos'].sort(),
    );
    expect(result.projects).toEqual([]);
    expect(result.todos).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.openEscalations).toEqual([]);
    expect(result.coverage).toBeNull();
    expect(result.campaigns).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  test('a campaign with two probes and a two-lens completion round-trips onto the snapshot', async () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test Goal',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'echo test1' },
        { kind: 'command', environment: 'worktree', command: 'echo test2' },
      ],
    });

    // Get the probes that were created with the campaign
    const probes = listProbes(project, campaign.id);
    expect(probes.length).toBe(2);

    // Record a verdict on the first probe only
    recordProbeVerdict(project, {
      probeId: probes[0]!.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123def456',
      evidence: 'Test evidence',
    });

    // Record a completion with two lenses
    recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'test-judge',
      verdict: 'done',
      ruledAtSha: 'abc123def456',
      rationale: 'All tests passed',
      lenses: [
        { lens: 'correctness', verdict: 'done', reasoning: 'Correct behavior' },
        { lens: 'performance', verdict: 'done', reasoning: 'Good performance' },
      ],
      artifactsRead: ['file1.txt'],
      commandsRun: ['test command'],
      citedLenses: ['correctness', 'performance'],
    });

    const result = await buildBridgeSnapshot(project);
    expect(result.campaigns.length).toBe(1);
    expect(result.campaigns[0]!.title).toBe('Test Campaign');
    expect(result.campaigns[0]!.probes.length).toBe(2);
    expect(result.campaigns[0]!.probes[0]!.lastEvidenceAt).toBeGreaterThan(0);
    expect(result.campaigns[0]!.probes[0]!.lastEvidence).toBe('Test evidence');
    expect(result.campaigns[0]!.probes[1]!.lastEvidenceAt).toBeNull();
    expect(result.campaigns[0]!.ruling).not.toBeNull();
    expect(result.campaigns[0]!.ruling!.lenses.length).toBe(2);
    expect(result.campaigns[0]!.ruling!.lenses[0]!.reasoning).toBe('Correct behavior');
    expect(result.campaigns[0]!.ruling!.lenses[1]!.reasoning).toBe('Good performance');
  });

  test('a campaign with no completion yields a null ruling', async () => {
    createCampaign(project, {
      title: 'Unruled Campaign',
      probes: [{ kind: 'command', environment: 'worktree' }],
    });

    const result = await buildBridgeSnapshot(project);
    expect(result.campaigns.length).toBe(1);
    expect(result.campaigns[0]!.ruling).toBeNull();
  });

  test('a throwing campaigns reader degrades campaigns to [] while the other six populate', async () => {
    await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test todo',
      kind: 'leaf',
    });
    const result = await buildBridgeSnapshot(project, {
      deps: {
        listCampaignsForSnapshot: () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.campaigns).toEqual([]);
    expect(result.todos.length).toBeGreaterThan(0);
    expect(result.projects).toEqual([]);
    expect(result.missions).toEqual([]);
    expect(result.coverage).not.toBeNull();
    expect(result.summaries).toEqual([]);
  });
});
