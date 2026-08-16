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
  rulePanel,
  CAMPAIGN_LENSES,
  type JudgeCampaignOpts,
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

  test('rulePanel requires at least two done verdicts to rule done', () => {
    // One done, two not-done → not-done
    const lenses1: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'goal is met' },
      { lens: 'evidence-quality', verdict: 'not-done', reasoning: 'evidence weak' },
      { lens: 'refuter', verdict: 'not-done', reasoning: 'refutation holds' },
    ];

    const ruling1 = rulePanel(lenses1);
    expect(ruling1.verdict).toBe('not-done');
    expect(ruling1.rationale).toContain('goal-met');
    expect(ruling1.rationale).toContain('evidence-quality');
    expect(ruling1.rationale).toContain('refuter');

    // Two done, one not-done → done
    const lenses2: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'goal is met' },
      { lens: 'evidence-quality', verdict: 'done', reasoning: 'evidence strong' },
      { lens: 'refuter', verdict: 'not-done', reasoning: 'refutation fails' },
    ];

    const ruling2 = rulePanel(lenses2);
    expect(ruling2.verdict).toBe('done');
    expect(ruling2.rationale).toContain('goal-met');
    expect(ruling2.rationale).toContain('evidence-quality');

    // All three done → done
    const lenses3: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'goal is met' },
      { lens: 'evidence-quality', verdict: 'done', reasoning: 'evidence strong' },
      { lens: 'refuter', verdict: 'done', reasoning: 'refutation fails' },
    ];

    const ruling3 = rulePanel(lenses3);
    expect(ruling3.verdict).toBe('done');
  });

  test('rulePanel embeds lens reasoning verbatim in its rationale', () => {
    const lenses: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'This specific reason for goal-met' },
      { lens: 'evidence-quality', verdict: 'not-done', reasoning: 'This specific reason for evidence-quality' },
      { lens: 'refuter', verdict: 'not-done', reasoning: 'This specific reason for refuter' },
    ];

    const ruling = rulePanel(lenses);

    // Verify each lens's reasoning is embedded verbatim.
    expect(ruling.rationale).toContain('This specific reason for goal-met');
    expect(ruling.rationale).toContain('This specific reason for evidence-quality');
    expect(ruling.rationale).toContain('This specific reason for refuter');
  });

  test('one lens alone cannot rule a campaign done', () => {
    // Even if all three lenses vote done individually, we're testing the threshold.
    // Here we test with just one done: it should be not-done.
    const lenses: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'goal is met' },
      { lens: 'evidence-quality', verdict: 'not-done', reasoning: 'evidence weak' },
      { lens: 'refuter', verdict: 'not-done', reasoning: 'refutation holds' },
    ];

    const ruling = rulePanel(lenses);
    expect(ruling.verdict).toBe('not-done');

    // Also verify with exactly one not-done on the other side.
    const lenses2: CompletionLensInput[] = [
      { lens: 'goal-met', verdict: 'not-done', reasoning: 'goal not met' },
      { lens: 'evidence-quality', verdict: 'not-done', reasoning: 'evidence weak' },
      { lens: 'refuter', verdict: 'not-done', reasoning: 'refutation holds' },
    ];

    const ruling2 = rulePanel(lenses2);
    expect(ruling2.verdict).toBe('not-done');
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

    // Create a fake LLM that returns specific verdicts per lens.
    // goal-met and evidence-quality vote done; refuter votes not-done.
    let callCount = 0;
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        callCount++;

        // Verify that the lens name is present in both prompts.
        const lensMatch = system.match(/LENS: ([\w-]+)/);
        expect(lensMatch).toBeTruthy();
        const lensName = lensMatch![1];

        // Return different verdicts per lens.
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

    // Verify the judge was called once per lens.
    expect(callCount).toBe(3);

    // Verify the panel ruling is 'done' (two lenses voted done).
    expect(result.verdict).toBe('done');

    // Verify the rationale names both concurring and dissenting lenses.
    expect(result.rationale).toContain('goal-met');
    expect(result.rationale).toContain('evidence-quality');
    expect(result.rationale).toContain('refuter');

    // Verify all three lenses were persisted.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(1);

    const lensRecords = listCompletionLenses(project, result.id);
    expect(lensRecords).toHaveLength(3);

    // Verify each lens verdict and reasoning.
    const lensMap = new Map(lensRecords.map((l) => [l.lens, l]));

    expect(lensMap.get('goal-met')?.verdict).toBe('done');
    expect(lensMap.get('goal-met')?.reasoning).toContain('Goal is clearly met');

    expect(lensMap.get('evidence-quality')?.verdict).toBe('done');
    expect(lensMap.get('evidence-quality')?.reasoning).toContain('Evidence is strong');

    expect(lensMap.get('refuter')?.verdict).toBe('not-done');
    expect(lensMap.get('refuter')?.reasoning).toContain('No strong refutation');
  });
});
