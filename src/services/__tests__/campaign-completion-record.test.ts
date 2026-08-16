// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCampaignTool } from '../../mcp/campaign-tools.js';
import {
  recordCampaignCompletion,
  listCampaignCompletions,
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
  project = mkdtempSync(join(tmpdir(), 'campaign-completion-'));
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

describe('campaign-completion-record', () => {
  test('forge_campaign stores a free-text goal and get_campaign returns it verbatim', async () => {
    const goalInput = 'Test goal\nwith\n"quotes" and \'apostrophes\'.';

    // Forge a campaign with a goal
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign With Goal',
      goal: goalInput,
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'echo "test"' }],
    });
    const campaign = JSON.parse(forgeResult!);

    // Get the campaign back and verify the goal is verbatim
    const getResult = await handleCampaignTool('get_campaign', { project, campaignId: campaign.id });
    const campaignData = JSON.parse(getResult!);

    expect(campaignData.goal).toBe(goalInput);
  });

  test('a completion verdict round-trips with judge, verdict, ruledAtSha and rationale', () => {
    // Create a campaign
    const campaign = handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign For Completion Test',
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'echo "test"' }],
    }).then((result) => JSON.parse(result!));

    campaign.then((c) => {
      // Record a completion verdict
      const rationale = 'All probes passed successfully and the campaign is ready.';
      const recordedVerdict = recordCampaignCompletion(project, {
        campaignId: c.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: '0123456789abcdef0123456789abcdef01234567',
        rationale,
        artifactsRead: ['campaign:' + c.id],
      });

      expect(recordedVerdict.id).toBeDefined();
      expect(recordedVerdict.campaignId).toBe(c.id);
      expect(recordedVerdict.judge).toBe('test-judge');
      expect(recordedVerdict.verdict).toBe('done');
      expect(recordedVerdict.ruledAtSha).toBe('0123456789abcdef0123456789abcdef01234567');
      expect(recordedVerdict.rationale).toBe(rationale);
      expect(recordedVerdict.ruledAt).toBeDefined();
      expect(recordedVerdict.artifactsRead).toEqual(['campaign:' + c.id]);

      // Read back via listCampaignCompletions
      const completions = listCampaignCompletions(project, c.id);
      expect(completions).toHaveLength(1);
      expect(completions[0]).toEqual(recordedVerdict);
    });
  });
});
