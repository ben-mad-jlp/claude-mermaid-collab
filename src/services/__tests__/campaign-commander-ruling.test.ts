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
  buildCommanderPrompt,
  ruleByCommander,
  type JudgeCampaignOpts,
  type LensExamination,
} from '../campaign-completion-judge';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-commander-ruling-'));
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

describe('campaign-commander-ruling', () => {
  test('a commander reads the lens arguments and rules, rather than tallying lens votes', async () => {
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

    // Create a fake LLM that branches on COMMANDER vs LENS.
    let lensCallCount = 0;
    let commanderCallCount = 0;

    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        // Distinguish commander from lens by the COMMANDER keyword.
        if (system.includes('COMMANDER')) {
          commanderCallCount++;
          // Return a done verdict from the commander.
          return '{"verdict":"done","rationale":"All lenses are convinced and the evidence is solid","citedLenses":["goal-met","evidence-quality"]}';
        } else {
          lensCallCount++;
          // Lenses all vote done.
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';
          return `{"verdict":"done","rationale":"${lensName} confirms the goal is met"}`;
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // TWO calls per lens, not one: the panel rules independently and then deliberates,
    // so three lenses across two rounds is six. The commander still rules exactly once.
    expect(lensCallCount).toBe(6);
    expect(commanderCallCount).toBe(1);

    // Verify the verdict came from the commander.
    expect(result.verdict).toBe('done');
    expect(result.rationale).toContain('All lenses are convinced');

    // Verify citedLenses was persisted.
    expect(result.citedLenses).toContain('goal-met');
    expect(result.citedLenses).toContain('evidence-quality');
  });

  test('a lone well-argued dissent can defeat a majority of concurring lenses', async () => {
    // Create a campaign.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Assemble a complete robot arm',
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
        evidence: 'Test passed',
      });
    }

    // Create a fake LLM that:
    // - Returns done for goal-met and evidence-quality lenses
    // - Returns not-done for refuter lens (the dissent)
    // - Commander, reading the refuter's strong argument, rules not-done
    let commanderCallCount = 0;

    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(system: string, user: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          commanderCallCount++;
          // The commander reads the refuter's well-argued dissent and rules not-done.
          return '{"verdict":"not-done","rationale":"The refuter provides a compelling argument: the arm lacks critical components despite the passing probe","citedLenses":["refuter"]}';
        } else {
          // Lenses: two vote done, one votes not-done (refuter).
          const lensMatch = system.match(/LENS: ([\w-]+)/);
          const lensName = lensMatch ? lensMatch[1] : 'unknown';

          if (lensName === 'refuter') {
            return '{"verdict":"not-done","rationale":"The arm lacks the critical gripper mechanism — the goal is plainly unmet"}';
          } else {
            return '{"verdict":"done","rationale":"The ${lensName} lens sees the passing probe and votes done"}';
          }
        }
      },
    };

    const result = await judgeCampaignCompletion(project, campaign.id, {
      llm: fakeJudgmentLLM,
      judge: 'test-judge',
      ruledAtSha: 'sha123',
    });

    // Verify the commander was called and made its ruling.
    expect(commanderCallCount).toBe(1);

    // The commander rules not-done, following the refuter's well-argued dissent.
    expect(result.verdict).toBe('not-done');
    expect(result.rationale).toContain('compelling argument');

    // Verify the cited lenses include the refuter.
    expect(result.citedLenses).toContain('refuter');
  });

  test('a commander reply that throws, is empty, or is unparseable degrades to not-done with judge-inconclusive', async () => {
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      goal: 'Test goal',
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
        evidence: 'Test passed',
      });
    }

    // Test case 1: commander throws
    const throwingLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          throw new Error('Commander network timeout');
        }
        // Lenses return normally.
        return '{"verdict":"done","rationale":"lens agrees"}';
      },
    };

    const result1 = await judgeCampaignCompletion(project, campaign.id, {
      llm: throwingLLM,
      judge: 'test-judge-1',
      ruledAtSha: 'sha1',
    });

    expect(result1.verdict).toBe('not-done');
    expect(result1.rationale).toContain('judge-inconclusive:');
    expect(result1.rationale).toContain('network timeout');
    expect(result1.citedLenses).toHaveLength(0);

    // Test case 2: commander returns garbage (no JSON)
    const garbageLLM: JudgmentLLM = {
      async complete(system: string): Promise<string> {
        if (system.includes('COMMANDER')) {
          return 'I think the campaign might be done, but who really knows for sure';
        }
        return '{"verdict":"done","rationale":"lens agrees"}';
      },
    };

    const result2 = await judgeCampaignCompletion(project, campaign.id, {
      llm: garbageLLM,
      judge: 'test-judge-2',
      ruledAtSha: 'sha2',
    });

    expect(result2.verdict).toBe('not-done');
    expect(result2.rationale).toContain('judge-inconclusive:');
    expect(result2.rationale).toContain('no JSON object found');

    // Verify both runs persisted.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions).toHaveLength(2);
    expect(completions.every((c) => c.verdict === 'not-done')).toBe(true);
  });

  test('buildCommanderPrompt contains COMMANDER keyword and embeds lens reasoning verbatim', () => {
    const campaign = {
      id: 'test-campaign',
      project: project,
      title: 'Test',
      goal: 'Reach the finish line',
      createdAt: Date.now(),
    };

    const lensExaminations: LensExamination[] = [
      {
        lens: 'goal-met',
        verdict: 'done',
        reasoning: 'The racer crossed the finish line at time 42.5 seconds',
        artifactsRead: ['race_video.mp4'],
        commandsRun: ['ffmpeg -i race_video.mp4 -ss 42.5'],
      },
      {
        lens: 'evidence-quality',
        verdict: 'not-done',
        reasoning: 'The video timestamp might be off by a few seconds due to synchronization issues',
        artifactsRead: ['clock_offset_log.txt'],
        commandsRun: [],
      },
    ];

    const { system, user } = buildCommanderPrompt(campaign, lensExaminations);

    // Verify the system contains COMMANDER.
    expect(system).toContain('COMMANDER');

    // Verify the system contains the JSON schema instruction.
    expect(system).toContain('{"verdict":"done"|"not-done"');

    // Verify the system mentions ruling on strength of arguments.
    expect(system.toLowerCase()).toContain('strength of the arguments');
    expect(system.toLowerCase()).toContain('vote count');

    // Verify the user contains the goal.
    expect(user).toContain('Reach the finish line');

    // Verify the user embeds each lens's name, verdict, and reasoning verbatim.
    expect(user).toContain('goal-met');
    expect(user).toContain('The racer crossed the finish line at time 42.5 seconds');
    expect(user).toContain('evidence-quality');
    expect(user).toContain('The video timestamp might be off');

    // Verify the user mentions the artifacts and commands examined.
    expect(user).toContain('race_video.mp4');
    expect(user).toContain('ffmpeg -i race_video.mp4');
    expect(user).toContain('clock_offset_log.txt');
  });

  test('ruleByCommander filters citedLenses to only those present in the examinations', async () => {
    const campaign = {
      id: 'test-campaign',
      project: project,
      title: 'Test',
      goal: 'Test goal',
      createdAt: Date.now(),
    };

    const lensExaminations: LensExamination[] = [
      { lens: 'goal-met', verdict: 'done', reasoning: 'Goal met', artifactsRead: [], commandsRun: [] },
      { lens: 'evidence-quality', verdict: 'done', reasoning: 'Evidence strong', artifactsRead: [], commandsRun: [] },
    ];

    // Create a fake LLM that returns a command citing a non-existent lens.
    const fakeJudgmentLLM: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"verdict":"done","rationale":"All good","citedLenses":["goal-met","evidence-quality","non-existent-lens","another-fake"]}';
      },
    };

    const ruling = await ruleByCommander(lensExaminations, {
      llm: fakeJudgmentLLM,
      campaign,
    });

    // Verify only valid lens names are kept.
    expect(ruling.citedLenses).toContain('goal-met');
    expect(ruling.citedLenses).toContain('evidence-quality');
    expect(ruling.citedLenses).not.toContain('non-existent-lens');
    expect(ruling.citedLenses).not.toContain('another-fake');
    expect(ruling.citedLenses).toHaveLength(2);
  });
});
