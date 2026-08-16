// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCampaignTool } from '../../mcp/campaign-tools.js';
import {
  recordProbeVerdict,
  listProbes,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-empty-front-'));
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

describe('campaign-empty-front-is-not-done', () => {
  test('an empty front alone never marks a campaign done without a recorded judge verdict', async () => {
    // Forge a campaign with one probe
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign With Empty Front',
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'echo "test"' }],
    });
    const campaign = JSON.parse(forgeResult!);

    // Get the probes and record a passing verdict on the only probe
    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);

    recordProbeVerdict(project, {
      probeId: probes[0].id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: '0123456789abcdef0123456789abcdef01234567',
    });

    // Get the campaign — front should be empty (all probes passing)
    const getResult = await handleCampaignTool('get_campaign', { project, campaignId: campaign.id });
    const campaignData = JSON.parse(getResult!);

    // Verify front is empty
    expect(campaignData.front).toHaveLength(0);

    // Verify completion is not done (no judge verdict recorded)
    expect(campaignData.completion.done).toBe(false);
    expect(campaignData.completion.verdict).toBe(null);
  });
});
