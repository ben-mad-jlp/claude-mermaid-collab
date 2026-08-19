// Test for the set_campaign_level verb and campaignLevel enrichment.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCampaignTool } from '../../mcp/campaign-tools.js';
import { _closeProject } from '../todo-store';
import { _resetCampaignDbCache } from '../campaign-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { getCampaignLevel, _closeDb } from '../orchestrator-config';

let project: string;

// Set up a non-transient project path for the duration of the file
const dir = mkdtempSync(join(tmpdir(), 'set-campaign-level-verb-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'set-campaign-level-'));
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  rmSync(project, { recursive: true, force: true });
});

afterAll(() => {
  _closeDb();
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('set_campaign_level verb', () => {
  it("the verb flips a project level from on to off and the store read returns off", async () => {
    // Call the verb to set level to off
    const result = await handleCampaignTool('set_campaign_level', {
      project,
      level: 'off',
    });
    expect(result).toBeTruthy();

    const parsed = JSON.parse(result!);
    expect(parsed.level).toBe('off');
    expect(getCampaignLevel(project)).toBe('off');
  });

  it('list_campaigns output carries the resolved level field', async () => {
    // First, forge a campaign to have something in the list
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Test Campaign',
      probes: [
        {
          ref: 'probe-test',
          kind: 'command',
          environment: 'worktree',
          command: 'echo "a"',
        },
      ],
    });
    expect(forgeResult).toBeTruthy();

    // List campaigns and verify campaignLevel is present
    const listResult = await handleCampaignTool('list_campaigns', { project });
    expect(listResult).toBeTruthy();

    const campaigns = JSON.parse(listResult!);
    expect(Array.isArray(campaigns)).toBe(true);
    expect(campaigns.length).toBeGreaterThan(0);

    // Every campaign should have the campaignLevel field
    for (const campaign of campaigns) {
      expect(campaign.campaignLevel).toBe('on');
    }
  });
});
