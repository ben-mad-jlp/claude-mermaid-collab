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
  type CampaignCompletionRecord,
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
  ruleByCommander,
  CAMPAIGN_LENSES,
  type JudgeCampaignOpts,
  type LensExamination,
} from '../campaign-completion-judge';
import type { JudgmentLLM } from '../judgment-llm';
import type { CompletionLensInput } from '../campaign-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-judge-panel-'));
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

describe('campaign-judge-panel', () => {
  test('has exactly three lenses with distinct names and focuses', () => {
    expect(CAMPAIGN_LENSES).toHaveLength(3);

    const names = CAMPAIGN_LENSES.map((l) => l.name);
    expect(names).toContain('goal-met');
    expect(names).toContain('evidence-quality');
    expect(names).toContain('refuter');

    // Verify each lens has a distinct focus.
    const focuses = CAMPAIGN_LENSES.map((l) => l.focus);
    expect(new Set(focuses).size).toBe(3);

    // Verify each focus is non-empty and meaningful.
    for (const lens of CAMPAIGN_LENSES) {
      expect(lens.focus.length).toBeGreaterThan(10);
    }
  });

  test('commander rules based on the strength of lens arguments, not a vote tally', async () => {
    // Set up test campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });

    // Create a fake LLM that has commander rule not-done (against two done lenses).
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          // Commander overrides the 2-to-1 vote and rules not-done.
          return '{"verdict":"not-done","rationale":"Evidence is weak despite the lens votes","citedLenses":["refuter"]}';
        } else {
          // Lenses vote: two done, one not-done.
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          if (lensName === 'refuter') {
            return '{"verdict":"not-done","rationale":"refutation holds"}';
          }
          return '{"verdict":"done","rationale":"lens votes done"}';
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the commander ruling overrides the lens vote tally.
    // (Two lenses voted done, one not-done, but the commander rules not-done.)
    expect(result.verdict).toBe('not-done');
    expect(result.rationale).toContain('Evidence is weak');
    expect(result.citedLenses).toContain('refuter');
  });

  test('commander reads the lens reasoning and cites which lenses it relied on', async () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });

    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          // Commander cites the goal-met lens reasoning.
          return '{"verdict":"done","rationale":"This specific reason for goal-met leads me to rule done","citedLenses":["goal-met"]}';
        } else {
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          if (lensName === 'goal-met') {
            return '{"verdict":"done","rationale":"This specific reason for goal-met"}';
          } else if (lensName === 'evidence-quality') {
            return '{"verdict":"not-done","rationale":"This specific reason for evidence-quality"}';
          } else {
            return '{"verdict":"not-done","rationale":"This specific reason for refuter"}';
          }
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the commander's rationale includes the lens reasoning it cited.
    expect(result.rationale).toContain('This specific reason for goal-met');
    expect(result.citedLenses).toHaveLength(1);
    expect(result.citedLenses[0]).toBe('goal-met');
  });

  test('the commander can weigh a single strong lens argument against others', async () => {
    // Test that the commander, reading the lens arguments, can decide on the strength
    // of reasoning rather than a vote count. A single lens with a strong argument can
    // move the verdict.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });

    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          // Commander rules not-done because the refuter's argument is strong.
          return '{"verdict":"not-done","rationale":"The refuter makes a strong case that wins","citedLenses":["refuter"]}';
        } else {
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          if (lensName === 'refuter') {
            return '{"verdict":"not-done","rationale":"Critical component is missing"}';
          }
          return '{"verdict":"done","rationale":"lens votes done"}';
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // The commander rules not-done based on the refuter's strong argument alone.
    expect(result.verdict).toBe('not-done');
    expect(result.citedLenses).toContain('refuter');
  });

  test('rules from a panel of lenses and records every lens verdict including dissent', async () => {
    // Create a campaign with a goal and a passing probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Deploy the service successfully',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    // Record the probe as passing.
    const { listProbes } = await import('../campaign-store');
    const probes = listProbes(project, campaign.id);
    for (const probe of probes) {
      recordProbeVerdict(project, {
        probeId: probe.id,
        verdict: 'pass',
        environment: 'worktree',
        commitSha: 'abc123def456',
        evidence: 'Service deployed and responding',
      });
    }

    // Create a fake LLM that returns specific verdicts per lens for both rounds.
    // goal-met and evidence-quality vote done; refuter votes not-done in round 1.
    // In round 2 (deliberation), all lenses keep their verdicts.
    // The commander, seeing the round-2 verdicts, rules done.
    let lensCallCount = 0;
    let commanderCallCount = 0;
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          commanderCallCount++;
          // Commander sees two strong done lenses and rules done.
          return '{"verdict":"done","rationale":"Goal-met and evidence-quality lenses provide convincing evidence","citedLenses":["goal-met","evidence-quality"]}';
        }

        lensCallCount++;

        // Verify that the lens name is present in both prompts.
        const lensMatch = system.match(/LENS: ([\w-]+)/);
        expect(lensMatch).toBeTruthy();
        const lensName = lensMatch![1];

        // Return the same verdicts for both round 1 and round 2 deliberation.
        // All lenses keep their verdicts across rounds.
        if (lensName === 'goal-met') {
          return '{"verdict":"done","rationale":"Goal is clearly met by the passing probe"}';
        } else if (lensName === 'evidence-quality') {
          return '{"verdict":"done","rationale":"Evidence is strong and recent"}';
        } else if (lensName === 'refuter') {
          return '{"verdict":"not-done","rationale":"No strong refutation found"}';
        } else {
          throw new Error(`Unknown lens: ${lensName}`);
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the judge was called 6 times for lenses (3 round 1 + 3 round 2 deliberation) plus once for the commander.
    expect(lensCallCount).toBe(6);
    expect(commanderCallCount).toBe(1);

    // Verify the commander ruling is 'done'.
    expect(result.verdict).toBe('done');

    // Verify the rationale is from the commander and mentions the cited lenses.
    expect(result.rationale).toContain('convincing evidence');
    expect(result.citedLenses).toContain('goal-met');
    expect(result.citedLenses).toContain('evidence-quality');

    // Verify all three lenses were persisted in two rounds.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(1);

    const lensRecords = listCompletionLenses(project, result.id);
    expect(lensRecords).toHaveLength(6);

    // Verify each lens verdict and reasoning from the independent round only.
    const lensMap = new Map(lensRecords.filter((l) => l.round === 'independent').map((l) => [l.lens, l]));

    expect(lensMap.get('goal-met')?.verdict).toBe('done');
    expect(lensMap.get('goal-met')?.reasoning).toContain('Goal is clearly met');

    expect(lensMap.get('evidence-quality')?.verdict).toBe('done');
    expect(lensMap.get('evidence-quality')?.reasoning).toContain('Evidence is strong');

    expect(lensMap.get('refuter')?.verdict).toBe('not-done');
    expect(lensMap.get('refuter')?.reasoning).toContain('No strong refutation');
  });
});
