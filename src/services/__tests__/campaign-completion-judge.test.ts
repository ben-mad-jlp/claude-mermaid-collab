// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  recordProbeVerdict,
  listCampaignCompletions,
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
  buildCompletionPrompt,
  type JudgeCampaignOpts,
} from '../campaign-completion-judge';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-judge-'));
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

describe('campaign-completion-judge', () => {
  test('rules not-done when every probe passes but the goal is plainly unmet', async () => {
    // Create a campaign with a clear goal and two passing probes.
    const campaign = createCampaign(project, {
      title: 'Assemble an arm',
      goal: 'Assemble a complete robot arm with gripper and articulation',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    // Record both probes as passing.
    const probes = campaign;
    // We need to get the actual probes from listProbes
    const { listProbes } = await import('../campaign-store');
    const actualProbes = listProbes(project, campaign.id);
    expect(actualProbes).toHaveLength(2);

    for (const probe of actualProbes) {
      recordProbeVerdict(project, {
        probeId: probe.id,
        verdict: 'pass',
        environment: 'worktree',
        commitSha: 'abc123def456',
        evidence: 'Test passed',
      });
    }

    // Create a fake LLM that asserts the prompt contains the goal and probe info.
    // The lenses and commander all see the goal and probes.
    let callCount = 0;
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        callCount++;
        if (system.includes('COMMANDER')) {
          // Commander sees that the lenses agree the goal is unmet.
          return '{"verdict":"not-done","rationale":"arm was never assembled","citedLenses":[]}';
        }

        // Verify the prompt contains the goal (in lens prompts).
        expect(user).toContain('Assemble a complete robot arm with gripper and articulation');
        // Verify the prompt contains probe ids.
        expect(user).toContain(actualProbes[0].id);
        expect(user).toContain(actualProbes[1].id);
        // Verify the prompt mentions the passing verdicts.
        expect(user).toContain('pass');
        // Return a not-done verdict because the goal is unmet.
        return '{"verdict":"not-done","rationale":"arm was never assembled"}';
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the returned record is not-done with the correct rationale.
    expect(result.verdict).toBe('not-done');
    expect(result.rationale).toContain('arm was never assembled');

    // Verify the completion is stored.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(1);
    expect(completions[0].verdict).toBe('not-done');
    expect(completions[0].rationale).toContain('arm was never assembled');
    expect(completions[0].judge).toBe('test-judge');
    expect(completions[0].ruledAtSha).toBe('sha123');
  });

  test('defaults to not-done when the judge errors or returns an unparseable verdict', async () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    // Test case 1: lens LLM calls all pass, but commander throws
    const failingJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          throw new Error('Network timeout');
        }
        // Lenses all return done.
        return '{"verdict":"done","rationale":"lens complete"}';
      },
    };

    const result1 = await judgeCampaignCompletion(project, campaign.id, {
      llm: failingJudgmentLLM,
      judge: 'test-judge-1',
      ruledAtSha: 'sha1',
    });

    expect(result1.verdict).toBe('not-done');
    expect(result1.rationale).toContain('judge-inconclusive:');
    expect(result1.rationale).toContain('Network timeout');

    // Test case 2: commander returns garbage prose (no JSON)
    const garbageJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          return 'I think maybe the campaign is done or maybe not, who knows really';
        }
        return '{"verdict":"done","rationale":"lens complete"}';
      },
    };

    const result2 = await judgeCampaignCompletion(project, campaign.id, {
      llm: garbageJudgmentLLM,
      judge: 'test-judge-2',
      ruledAtSha: 'sha2',
    });

    expect(result2.verdict).toBe('not-done');
    expect(result2.rationale).toContain('judge-inconclusive:');
    expect(result2.rationale).toContain('no JSON object found');

    // Test case 3: commander returns JSON with invalid verdict
    const invalidVerdictJudgmentLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          return '{"verdict":"maybe","rationale":"unclear"}';
        }
        return '{"verdict":"done","rationale":"lens complete"}';
      },
    };

    const result3 = await judgeCampaignCompletion(project, campaign.id, {
      llm: invalidVerdictJudgmentLLM,
      judge: 'test-judge-3',
      ruledAtSha: 'sha3',
    });

    expect(result3.verdict).toBe('not-done');
    expect(result3.rationale).toContain('judge-inconclusive:');
    expect(result3.rationale).toContain('invalid verdict');

    // Verify all three runs persisted separately.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(3);
    expect(completions.every((c) => c.verdict === 'not-done')).toBe(true);
    expect(completions.every((c) => c.rationale && c.rationale.includes('judge-inconclusive:'))).toBe(true);
  });
});
