// Test that listCampaignsForSnapshot reports mission and leaf counts for linked campaigns.
// The snapshot must carry missionCount and leafCount so the UI can display campaign scale
// without a second query — the counts enable drill-down decisions and progress visualization.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampaign, listProbes, _resetCampaignDbCache } from '../campaign-store.ts';
import { listCampaignsForSnapshot } from '../campaign-snapshot.ts';
import { createTodo, _closeProject } from '../todo-store.ts';
import { linkProbeToMission, _resetCampaignPassDbCache } from '../campaign-pass.ts';
import { _closeLedgerDb } from '../worker-ledger.ts';
import { _closeAllCollabDbs } from '../collab-db.ts';

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-stats-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  process.env.MERMAID_SUPERVISOR_DIR = projectDir;
  _resetCampaignDbCache();
  _closeAllCollabDbs();
});

afterEach(() => {
  _closeProject(projectDir);
  _resetCampaignDbCache(projectDir);
  _resetCampaignPassDbCache(projectDir);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(projectDir, { recursive: true, force: true });
});

describe('listCampaignsForSnapshot mission and leaf counts', () => {
  it('a campaign with a linked mission reports its mission and leaf counts', async () => {
    // Create a mission with an epic and two leaves.
    const mission = await createTodo(projectDir, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Stats test',
      kind: 'mission',
    });

    const epic = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: mission.id,
      title: '[EPIC] Work',
      kind: 'epic',
    });

    const leaf1 = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: epic.id,
      title: 'Leaf 1',
      kind: 'leaf',
    });

    const leaf2 = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: epic.id,
      title: 'Leaf 2',
      kind: 'leaf',
    });

    // Create a campaign with a probe.
    const campaign = createCampaign(projectDir, {
      title: 'Stats test campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });
    const probe = listProbes(projectDir, campaign.id)[0];

    // Link the probe to the mission.
    linkProbeToMission(projectDir, probe.id, mission.id, campaign.id);

    // List campaigns and check the counts.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.missionCount).toBe(1);
    expect(found!.leafCount).toBe(2);
  });

  it('an unlinked campaign reports zero mission and leaf counts', () => {
    const campaign = createCampaign(projectDir, {
      title: 'Unlinked campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });

    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.missionCount).toBe(0);
    expect(found!.leafCount).toBe(0);
  });

  it('leafCount counts leaves at any depth under a linked mission (transitive)', async () => {
    // Create a nested hierarchy: mission → epic → epic → leaf
    const mission = await createTodo(projectDir, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Nested test',
      kind: 'mission',
    });

    const epic1 = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: mission.id,
      title: '[EPIC] Level 1',
      kind: 'epic',
    });

    const epic2 = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: epic1.id,
      title: '[EPIC] Level 2',
      kind: 'epic',
    });

    const deepLeaf = await createTodo(projectDir, {
      ownerSession: 's1',
      parentId: epic2.id,
      title: 'Deep leaf',
      kind: 'leaf',
    });

    // Create a campaign with a probe.
    const campaign = createCampaign(projectDir, {
      title: 'Transitive depth campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
    });
    const probe = listProbes(projectDir, campaign.id)[0];

    // Link the probe to the mission.
    linkProbeToMission(projectDir, probe.id, mission.id, campaign.id);

    // List campaigns and verify the deep leaf is counted.
    const campaigns = listCampaignsForSnapshot(projectDir);
    const found = campaigns.find((c) => c.id === campaign.id);

    expect(found).toBeDefined();
    expect(found!.missionCount).toBe(1);
    expect(found!.leafCount).toBe(1);
  });
});
