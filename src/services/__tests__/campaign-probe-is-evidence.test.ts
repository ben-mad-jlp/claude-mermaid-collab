// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCampaignTool } from '../../mcp/campaign-tools.js';
import {
  listProbes,
  listProbeVerdicts,
  recordCampaignCompletion,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  runCampaignPass,
  _resetCampaignPassDbCache,
} from '../campaign-pass';
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
  project = mkdtempSync(join(tmpdir(), 'campaign-probe-is-evidence-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-probe-is-evidence', () => {
  it('a probe run records evidence and never rules on the campaign by itself', async () => {
    // Forge a campaign with one command probe
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign With Probe Evidence',
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'true' }],
    });
    const campaign = JSON.parse(forgeResult!);
    expect(campaign.id).toBeDefined();

    // Run the campaign pass with injected execProbe and commitSha
    const testSha = '0123456789abcdef0123456789abcdef01234567';
    const result = await runCampaignPass(project, campaign.id, 'test-session', {
      execProbe: async () => ({
        verdict: 'pass',
        evidence: 'exit 0',
      }),
      commitSha: () => testSha,
    });

    // Assert the probe was executed
    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);
    const probeId = probes[0].id;
    expect(result.executed).toContain(probeId);
    expect(result.forged).toHaveLength(0);

    // Assert the verdict was recorded with provenance
    const verdicts = listProbeVerdicts(project, probeId);
    expect(verdicts).toHaveLength(1);
    const verdict = verdicts[0];
    expect(verdict.verdict).toBe('pass');
    expect(verdict.environment).toBe('worktree');
    expect(verdict.commitSha).toBe(testSha);
    expect(verdict.evidence).toBe('exit 0');

    // Assert the campaign is not ruled done (no judge verdict recorded)
    const getResult = await handleCampaignTool('get_campaign', {
      project,
      campaignId: campaign.id,
    });
    const campaignData = JSON.parse(getResult!);
    expect(campaignData.completion.done).toBe(false);
    expect(campaignData.completion.verdict).toBe(null);
  });

  it('the front is derived from judge rulings, not from probe exit codes', async () => {
    // Forge a campaign with one command probe
    const forgeResult = await handleCampaignTool('forge_campaign', {
      project,
      title: 'Campaign Front Derived From Judge',
      probes: [{ ref: 'probe-a', kind: 'command', environment: 'worktree', command: 'true' }],
    });
    const campaign = JSON.parse(forgeResult!);
    expect(campaign.id).toBeDefined();

    // Run the campaign pass with all probes green
    const testSha = '0123456789abcdef0123456789abcdef01234567';
    await runCampaignPass(project, campaign.id, 'test-session', {
      execProbe: async () => ({
        verdict: 'pass',
        evidence: 'exit 0',
      }),
      commitSha: () => testSha,
    });

    // Assert the front is empty (all probes passing) but campaign is not done
    let getResult = await handleCampaignTool('get_campaign', {
      project,
      campaignId: campaign.id,
    });
    let campaignData = JSON.parse(getResult!);
    expect(campaignData.front).toHaveLength(0);
    expect(campaignData.completion.done).toBe(false);

    // Record a judge ruling with evidence
    recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'test-judge',
      verdict: 'done',
      ruledAtSha: testSha,
      rationale: 'All probes pass',
      artifactsRead: ['src/services/campaign-completion.ts'],
      commandsRun: ['bun test'],
    });

    // Re-read the campaign and verify completion flips
    getResult = await handleCampaignTool('get_campaign', {
      project,
      campaignId: campaign.id,
    });
    campaignData = JSON.parse(getResult!);
    expect(campaignData.completion.done).toBe(true);
    expect(campaignData.completion.verdict).toBeDefined();
    expect(campaignData.completion.verdict.judge).toBe('test-judge');
    expect(campaignData.completion.verdict.verdict).toBe('done');
  });
});
