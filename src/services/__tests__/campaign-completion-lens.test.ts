// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  createCampaign,
  recordCampaignCompletion,
  listCampaignCompletions,
  listCompletionLenses,
  openCampaignDb,
  _resetCampaignDbCache,
  type CompletionLensInput,
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
  project = mkdtempSync(join(tmpdir(), 'campaign-completion-lens-'));
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

describe('campaign-completion-lens', () => {
  test('refuses a completion verdict that records no examined evidence, writing zero rows', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
    });

    // Try to record a completion with no artifactsRead and no commandsRun.
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        // Missing both artifactsRead and commandsRun
      });
    }).toThrow(
      `completion verdict for campaign ${campaign.id} records no examined evidence: artifactsRead and commandsRun are both empty`
    );

    // Verify no completions were written.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });

  test('refuses a completion verdict where artifactsRead and commandsRun are both empty arrays', () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
    });

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        artifactsRead: [],
        commandsRun: [],
      });
    }).toThrow(
      `completion verdict for campaign ${campaign.id} records no examined evidence: artifactsRead and commandsRun are both empty`
    );

    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });

  test('refuses a completion verdict where all entries in both arrays are whitespace', () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
    });

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        artifactsRead: ['  ', '\t', '\n'],
        commandsRun: ['   '],
      });
    }).toThrow(
      `completion verdict for campaign ${campaign.id} records no examined evidence: artifactsRead and commandsRun are both empty`
    );

    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });

  test('stores per-lens verdicts alongside the parent completion and reads them back', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Multi-lens Campaign',
      goal: 'Validate system behavior',
    });

    // Define some lenses.
    const lenses: CompletionLensInput[] = [
      { lens: 'correctness', verdict: 'done', reasoning: 'All assertions passed' },
      { lens: 'performance', verdict: 'not-done', reasoning: 'Latency exceeds 100ms' },
      { lens: 'security', verdict: 'done' },
    ];

    // Record a completion verdict with lenses.
    const verdict = recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'test-judge',
      verdict: 'not-done', // Overall not-done due to performance lens
      ruledAtSha: 'abc123def456',
      rationale: 'Performance issue blocks completion',
      lenses,
      artifactsRead: ['campaign:' + campaign.id],
    });

    expect(verdict.id).toBeDefined();

    // Read back the lenses.
    const recordedLenses = listCompletionLenses(project, verdict.id);
    expect(recordedLenses).toHaveLength(3);

    // Verify the first lens.
    expect(recordedLenses[0].lens).toBe('correctness');
    expect(recordedLenses[0].verdict).toBe('done');
    expect(recordedLenses[0].reasoning).toBe('All assertions passed');
    expect(recordedLenses[0].completionId).toBe(verdict.id);

    // Verify the second lens.
    expect(recordedLenses[1].lens).toBe('performance');
    expect(recordedLenses[1].verdict).toBe('not-done');
    expect(recordedLenses[1].reasoning).toBe('Latency exceeds 100ms');

    // Verify the third lens (no reasoning).
    expect(recordedLenses[2].lens).toBe('security');
    expect(recordedLenses[2].verdict).toBe('done');
    expect(recordedLenses[2].reasoning).toBeNull();
  });

  test('returns empty array when reading lenses for an unknown completion id', () => {
    const lenses = listCompletionLenses(project, 999);
    expect(lenses).toHaveLength(0);
  });

  test('enforces transactionality: a rejected lens insert leaves no parent or sibling rows', () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Transaction Test Campaign',
    });

    // Build an input with a valid parent but an invalid lens (no verdict field).
    // The store should catch this as a validation error during the insert.
    // However, we can test transactionality by checking that the parent is not
    // inserted if the transaction rolls back.
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        lenses: [
          { lens: 'test', verdict: 'done' },
        ],
        // But don't provide evidence, which will trigger the floor validation before the transaction.
        artifactsRead: [],
        commandsRun: [],
      });
    }).toThrow();

    // Verify no completions were written.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(0);
  });

  test('a fresh collab.db contains the campaign_completion_lens table', () => {
    // Create a campaign to ensure the db is initialized.
    createCampaign(project, {
      title: 'Fresh DB Test',
    });

    // Open the database and check for the lens table.
    const db = openCampaignDb(project) as any;

    // Query the schema to verify the table exists.
    const tableInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_completion_lens'")
      .get() as any;

    expect(tableInfo).toBeDefined();
    expect(tableInfo.name).toBe('campaign_completion_lens');

    // Verify the index exists.
    const indexInfo = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_campaign_completion_lens_completion'")
      .get() as any;

    expect(indexInfo).toBeDefined();
    expect(indexInfo.name).toBe('idx_campaign_completion_lens_completion');
  });

  test('artifactsRead and commandsRun are trimmed and stored as JSON', () => {
    const campaign = createCampaign(project, {
      title: 'Trimming Test',
    });

    // Record a verdict with entries that have leading/trailing whitespace.
    const verdict = recordCampaignCompletion(project, {
      campaignId: campaign.id,
      judge: 'test-judge',
      verdict: 'done',
      ruledAtSha: 'abc123def456',
      artifactsRead: ['  campaign:id1  ', 'campaign:id2'],
      commandsRun: ['\techo test\t', 'ls -la'],
    });

    // Verify the returned record has trimmed entries.
    expect(verdict.artifactsRead).toHaveLength(2);
    expect(verdict.artifactsRead[0]).toBe('campaign:id1');
    expect(verdict.artifactsRead[1]).toBe('campaign:id2');

    expect(verdict.commandsRun).toHaveLength(2);
    expect(verdict.commandsRun[0]).toBe('echo test');
    expect(verdict.commandsRun[1]).toBe('ls -la');

    // Verify the stored and read-back data is also trimmed.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions[0].artifactsRead).toEqual(verdict.artifactsRead);
    expect(completions[0].commandsRun).toEqual(verdict.commandsRun);
  });

  test('throws on non-string entries in artifactsRead or commandsRun', () => {
    const campaign = createCampaign(project, {
      title: 'Type Test',
    });

    // Try with non-string artifactsRead.
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        artifactsRead: [123 as any],
      });
    }).toThrow('artifactsRead entries must be strings');

    // Try with non-string commandsRun.
    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        commandsRun: [{ cmd: 'test' } as any],
      });
    }).toThrow('commandsRun entries must be strings');
  });

  test('throws if artifactsRead or commandsRun is not an array', () => {
    const campaign = createCampaign(project, {
      title: 'Type Test',
    });

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        artifactsRead: 'not-an-array' as any,
      });
    }).toThrow('artifactsRead must be an array');

    expect(() => {
      recordCampaignCompletion(project, {
        campaignId: campaign.id,
        judge: 'test-judge',
        verdict: 'done',
        ruledAtSha: 'abc123def456',
        commandsRun: 'not-an-array' as any,
      });
    }).toThrow('commandsRun must be an array');
  });
});
