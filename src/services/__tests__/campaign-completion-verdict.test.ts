// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  recordCampaignCompletion,
  listCampaignCompletions,
  latestCampaignCompletion,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
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

describe('campaign-completion-verdict', () => {
  test('stores the campaign goal verbatim and reads it back', () => {
    // Create a campaign with a goal.
    const goal = 'Validate the deployment pipeline end-to-end';
    const campaign = createCampaign(project, {
      title: 'Deployment Pipeline Validation',
      goal,
    });

    expect(campaign.goal).toBe(goal);

    // Verify getCampaign reads it back.
    const retrieved = getCampaign(project, campaign.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.goal).toBe(goal);

    // Verify listCampaigns reads it back.
    const allCampaigns = listCampaigns(project);
    expect(allCampaigns).toHaveLength(1);
    expect(allCampaigns[0].goal).toBe(goal);
  });

  test('stores a campaign without a goal as null and reads it back', () => {
    // Create a campaign without a goal.
    const campaign = createCampaign(project, {
      title: 'Deployment Pipeline Validation',
    });

    expect(campaign.goal).toBeNull();

    // Verify getCampaign reads it back as null.
    const retrieved = getCampaign(project, campaign.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.goal).toBeNull();
  });

  test('records a completion verdict and returns the latest ruling', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Deployment Pipeline Validation',
      goal: 'End-to-end validation',
    });

    // Record a completion verdict.
    const verdict1 = recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'ci-system',
      verdict: 'done',
      ruledAtSha: 'abc123def456',
      rationale: 'All probes passed successfully',
    });

    expect(verdict1.id).toBeDefined();
    expect(verdict1.campaignId).toBe(campaign.id);
    expect(verdict1.judge).toBe('ci-system');
    expect(verdict1.verdict).toBe('done');
    expect(verdict1.ruledAtSha).toBe('abc123def456');
    expect(verdict1.rationale).toBe('All probes passed successfully');

    // List all completions for the campaign.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(1);
    expect(completions[0].id).toBe(verdict1.id);

    // Record a second completion verdict (not-done).
    const verdict2 = recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'ci-system',
      verdict: 'not-done',
      ruledAtSha: 'def456abc123',
    });

    // List all completions again.
    const allCompletions = listCampaignCompletions(project, campaign.id);
    expect(allCompletions).toHaveLength(2);

    // Get the latest completion (should be verdict2).
    const latest = latestCampaignCompletion(project, campaign.id);
    expect(latest).toBeDefined();
    expect(latest?.id).toBe(verdict2.id);
    expect(latest?.verdict).toBe('not-done');
    expect(latest?.rationale).toBeNull();
  });

  test('throws on an invalid completion verdict before writing any row', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Deployment Pipeline Validation',
    });

    // Try to record a completion with an invalid verdict.
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'ci-system',
        verdict: 'invalid' as any,
        ruledAtSha: 'abc123def456',
      });
    }).toThrow();

    // Verify no completions were written.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });

  test('throws when campaignId is missing', () => {
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: '',
        judge: 'ci-system',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
      });
    }).toThrow('campaignId is required');
  });

  test('throws when judge is missing', () => {
    const campaign = createCampaign(project, {
      title: 'Test',
    });

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: '',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
      });
    }).toThrow('judge is required');
  });

  test('throws when ruledAtSha is missing', () => {
    const campaign = createCampaign(project, {
      title: 'Test',
    });

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'ci-system',
        verdict: 'done',
        ruledAtSha: '',
      });
    }).toThrow('ruledAtSha is required');
  });

  test('returns empty array for an unknown campaign', () => {
    const completions = listCampaignCompletions(project, 'unknown-campaign-id');
    expect(completions).toHaveLength(0);
  });

  test('returns null from latestCampaignCompletion for an unknown campaign', () => {
    const latest = latestCampaignCompletion(project, 'unknown-campaign-id');
    expect(latest).toBeNull();
  });
});
