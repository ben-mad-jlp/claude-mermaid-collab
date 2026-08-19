// Test that listCampaignsForSnapshot carries linkedMissions with id and nickname for campaigns.
// The snapshot must carry linkedMissions so the UI can reference missions without a second query.
import { test, expect, beforeEach, afterEach } from 'bun:test';
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
  projectDir = mkdtempSync(join(tmpdir(), 'campaign-snap-linked-'));
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

test('listCampaignsForSnapshot carries linkedMissions with the linked mission id and its nickname', async () => {
  // Create a mission with a generated nickname.
  const mission = await createTodo(projectDir, {
    allowOrphan: true,
    ownerSession: 's1',
    title: '[MISSION] Test mission',
    kind: 'mission',
  });

  // Create a campaign with a probe.
  const campaign = createCampaign(projectDir, {
    title: 'Linked missions campaign',
    probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
  });
  const probe = listProbes(projectDir, campaign.id)[0];

  // Link the probe to the mission.
  linkProbeToMission(projectDir, probe.id, mission.id, campaign.id);

  // List campaigns and check that linkedMissions includes the mission with its nickname.
  const campaigns = listCampaignsForSnapshot(projectDir);
  const found = campaigns.find((c) => c.id === campaign.id);

  expect(found).toBeDefined();
  expect(found!.linkedMissions).toBeDefined();
  expect(found!.linkedMissions.length).toBe(1);
  expect(found!.linkedMissions[0]).toEqual({
    id: mission.id,
    nickname: mission.nickname ?? null,
  });
});

test('linkedMissions is empty for a campaign with no linked missions', () => {
  // Create a campaign with a probe but no linked mission.
  const campaign = createCampaign(projectDir, {
    title: 'Unlinked campaign',
    probes: [{ kind: 'command', environment: 'worktree', command: 'echo test' }],
  });

  // List campaigns and check that linkedMissions is empty.
  const campaigns = listCampaignsForSnapshot(projectDir);
  const found = campaigns.find((c) => c.id === campaign.id);

  expect(found).toBeDefined();
  expect(found!.linkedMissions).toBeDefined();
  expect(found!.linkedMissions).toEqual([]);
});
