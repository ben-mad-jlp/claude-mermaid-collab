// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  recordProbeVerdict,
  listCampaignCompletions,
  listCompletionLenses,
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
import {
  judgeCampaignCompletion,
  CAMPAIGN_LENSES,
  type JudgeCampaignOpts,
} from '../campaign-completion-judge';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-panel-deliberation-'));
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

describe('campaign-panel-deliberation', () => {
  test('lenses rule independently before any lens sees another lens output', async () => {
    // Set up test campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });

    // Create a recording LLM stub that captures every prompt and detects deliberation.
    const prompts: Array<{ system: string; user: string }> = [];
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        prompts.push({ system, user });

        if (system.includes('COMMANDER')) {
          // Commander ruling
          return '{"verdict":"done","rationale":"Campaign complete","citedLenses":["goal-met"]}';
        } else if (system.includes('deliberation')) {
          // Round 2 (deliberation)
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          return `{"verdict":"done","rationale":"${lensName} deliberation","artifactsRead":[],"commandsRun":[]}`;
        } else {
          // Round 1 (independent)
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          return `{"verdict":"done","rationale":"${lensName} independent","artifactsRead":[],"commandsRun":[]}`;
        }
      },
    };

    await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify that exactly 3 round-1 prompts were built without any deliberation marker.
    // Round 1 prompts should NOT contain "deliberation".
    const round1Prompts = prompts.filter((p) => !p.system.includes('COMMANDER') && !p.system.includes('deliberation'));
    expect(round1Prompts).toHaveLength(3);

    // For each round-1 prompt, verify that no other lens's reasoning appears in the prompt.
    // Since each round-1 prompt is built independently, no lens's round-1 reply is available yet.
    // We can verify this by checking that the other lenses' names don't appear in reasoning context.
    const lensNames = CAMPAIGN_LENSES.map((l) => l.name);
    for (const prompt of round1Prompts) {
      const combinedText = prompt.system + prompt.user;
      // The prompt should not contain "deliberation" (that's round 2).
      expect(combinedText).not.toContain('deliberation');
      // The prompt should not contain reasoning from other lenses at this stage.
      expect(combinedText).not.toContain('Lens Arguments:');
    }
  });

  test('stores both the independent round and the post-deliberation round, including which lens changed its verdict', async () => {
    // Set up test campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });

    // Create a stubbed LLM that makes the 'refuter' lens flip its verdict in round 2.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          // Commander ruling based on round-2
          return '{"verdict":"done","rationale":"Campaign complete","citedLenses":["goal-met","evidence-quality"]}';
        } else if (system.includes('deliberation')) {
          // Round 2 deliberation
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';

          // refuter flips from 'not-done' (round 1) to 'done' (round 2)
          if (lensName === 'refuter') {
            return '{"verdict":"done","rationale":"After deliberation, refutation is weak","artifactsRead":[],"commandsRun":[]}';
          }
          // goal-met and evidence-quality keep their round-1 verdicts
          return `{"verdict":"done","rationale":"${lensName} confirms in round 2","artifactsRead":[],"commandsRun":[]}`;
        } else {
          // Round 1 independent
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';

          if (lensName === 'refuter') {
            return '{"verdict":"not-done","rationale":"Strong refutation possible","artifactsRead":[],"commandsRun":[]}';
          }
          return `{"verdict":"done","rationale":"${lensName} initial verdict","artifactsRead":[],"commandsRun":[]}`;
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify that 6 lens rows are stored: 3 for round 1, 3 for round 2.
    const lensRecords = listCompletionLenses(project, result.id);
    expect(lensRecords).toHaveLength(6);

    // Verify round-1 rows: each has round === 'independent' and changedVerdict === false.
    const round1Records = lensRecords.filter((l) => l.round === 'independent');
    expect(round1Records).toHaveLength(3);

    for (const record of round1Records) {
      expect(record.changedVerdict).toBe(false);
    }

    // Verify the refuter round-1 row has verdict 'not-done'.
    const refuterRound1 = round1Records.find((l) => l.lens === 'refuter');
    expect(refuterRound1).toBeDefined();
    expect(refuterRound1?.verdict).toBe('not-done');
    expect(refuterRound1?.reasoning).toContain('Strong refutation');

    // Verify round-2 rows: each has round === 'deliberation'.
    const round2Records = lensRecords.filter((l) => l.round === 'deliberation');
    expect(round2Records).toHaveLength(3);

    // Verify the refuter round-2 row has verdict 'done' (flipped) and changedVerdict === true.
    const refuterRound2 = round2Records.find((l) => l.lens === 'refuter');
    expect(refuterRound2).toBeDefined();
    expect(refuterRound2?.verdict).toBe('done');
    expect(refuterRound2?.changedVerdict).toBe(true);
    expect(refuterRound2?.reasoning).toContain('After deliberation');

    // Verify the goal-met and evidence-quality round-2 rows kept their verdicts and have changedVerdict === false.
    const goalMetRound2 = round2Records.find((l) => l.lens === 'goal-met');
    expect(goalMetRound2).toBeDefined();
    expect(goalMetRound2?.verdict).toBe('done');
    expect(goalMetRound2?.changedVerdict).toBe(false);

    const evidenceQualityRound2 = round2Records.find((l) => l.lens === 'evidence-quality');
    expect(evidenceQualityRound2).toBeDefined();
    expect(evidenceQualityRound2?.verdict).toBe('done');
    expect(evidenceQualityRound2?.changedVerdict).toBe(false);
  });
});
