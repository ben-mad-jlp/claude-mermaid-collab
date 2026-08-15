// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  listProbes,
  addProbe,
  getCampaign,
  listCampaigns,
  _resetCampaignDbCache,
  type ProbeInput,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
  listTodos,
} from '../todo-store';
import {
  upsertMission,
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-store-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-store', () => {
  test('creates a campaign and its probes while the todo row count holds steady', () => {
    const beforeCount = listTodos(project, { includeCompleted: true }).length;

    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'echo "hello"' },
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    const afterCount = listTodos(project, { includeCompleted: true }).length;

    // Campaign creation must not touch the todo table.
    expect(afterCount).toBe(beforeCount);

    // Verify the campaign was created.
    expect(campaign.id).toBeDefined();
    expect(campaign.title).toBe('Test Campaign');

    // Verify the probes were created.
    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(2);

    // Collect commands and check they match (order may vary due to UUID sorting).
    const commands = probes.map((p) => p.command).sort();
    expect(commands).toEqual(['echo "hello"', 'true']);

    // Check that all probes have correct properties.
    for (const probe of probes) {
      expect(probe.kind).toBe('command');
      expect(probe.environment).toBe('worktree');
      expect(probe.verdict).toBe('not-run');
      expect(probe.dependsOn).toEqual([]);
    }
  });

  test('leaves the active-mission selection identical after a campaign is created', async () => {
    // Create a mission node and upsert it.
    const missionId = await makeMissionNode();
    upsertMission(project, missionId);

    // Snapshot the active-mission selection before campaign creation.
    const before = listMissions(project).map((m) => ({
      id: m.mission.todoId,
      active: m.mission.active,
    }));

    // Create a campaign.
    createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    // Snapshot the active-mission selection after campaign creation.
    const after = listMissions(project).map((m) => ({
      id: m.mission.todoId,
      active: m.mission.active,
    }));

    // Mission state must not be affected by campaign creation.
    expect(after).toEqual(before);
  });

  test('refuses a probe that omits environment', () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [],
    });

    // Attempt to add a probe without environment.
    expect(() => addProbe(project, campaign.id, { kind: 'command' } as any)).toThrow();
  });

  test('listCampaigns returns campaigns for the project and grows by exactly one per createCampaign', () => {
    const before = listCampaigns(project);
    const beforeCount = before.length;

    const campaign = createCampaign(project, {
      title: 'Counted Campaign',
    });

    const after = listCampaigns(project);
    const afterCount = after.length;

    // Assert the count grew by exactly one.
    expect(afterCount).toBe(beforeCount + 1);

    // Assert the new campaign is in the list with matching title.
    const found = after.find((c) => c.id === campaign.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Counted Campaign');
  });
});
