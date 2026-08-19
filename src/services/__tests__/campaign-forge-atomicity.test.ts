// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
// Tests for campaign-pass forge atomicity: compensating rollback and concurrent claim race.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCampaignPass,
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
} from '../campaign-pass';
import {
  createCampaign,
  listProbes,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
  listTodos,
  _closeProject,
} from '../todo-store';
import {
  upsertMission,
  getMission,
  _resetMissionDbCache,
} from '../mission-store';
import { forgeMission, type ForgeMissionInput, type ForgeMissionResult } from '../../mcp/tools/mission-forge';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-forge-atomicity-'));
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

// The chamber now sits between the front and the forge: without a decision the pass
// records inaction and never reaches the proposal gate or forgeMission. These tests
// exercise the gate/forge stages, so the convene itself is stubbed to a decision.
const chamberDecisionStub = (async () => ({
  decision: { outcome: 'decision', chosenCandidate: 'Stub chamber candidate' },
})) as any;

describe('campaign-forge-atomicity', () => {
  it('a criterion write that throws leaves zero mission todos behind', async () => {
    // Create a campaign with one probe that will be forged.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    // Set up a mock addCriterion that throws during criterion addition.
    const mockAddCriterion = (proj: string, todoId: string, text: string) => {
      throw new Error('Simulated criterion write failure');
    };

    const mockForgeMission = async (proj: string, input: ForgeMissionInput) => {
      // Call the real forgeMission with the failing addCriterion dep.
      return forgeMission(proj, input, { addCriterion: mockAddCriterion as any });
    };

    const mockCampaignFront = () => [{ ...p1, verdict: 'fail' as const }];
    const mockListProbeVerdicts = () => [
      {
        id: 1,
        probeId: p1.id,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'timeout',
        recordedAt: Date.now(),
      },
    ];

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    const deps: CampaignPassDeps = {
      runChamber: chamberDecisionStub,
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      llm: approvingLlm,
    };

    // Run the pass. It should reject due to the thrown criterion.
    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // The pass should fail gracefully (fail-open).
    expect(result.forged).toHaveLength(0);

    // Assert that no mission todos were left behind: zero kind==='mission' todos.
    const allTodos = listTodos(project, {});
    const missionTodos = allTodos.filter((t: any) => t.kind === 'mission');
    expect(missionTodos).toHaveLength(0);

    // Assert that no mission row exists (getMission returns null for any created ID).
    // (We can't easily retrieve the ID that was created, so we just verify the count.)
  });

  it('two concurrent passes over one failing probe leave exactly one mission todo', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    let forgeCallCount = 0;
    const forgedMissionIds: string[] = [];

    // Mock forgeMission that creates a mission todo, then awaits a macrotask to reproduce the race.
    const mockForgeMission = async (proj: string, input: ForgeMissionInput): Promise<ForgeMissionResult> => {
      forgeCallCount++;
      // Mint the mission todo and mission row.
      const missionTodo = await createTodo(proj, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
      const missionId = missionTodo.id;
      forgedMissionIds.push(missionId);
      upsertMission(proj, missionId);

      // Yield to the event loop to interleave the two concurrent calls.
      // This reproduces the race: both calls mint their missions before either completes.
      await new Promise((resolve) => setTimeout(resolve, 0));

      return {
        node: { id: missionId } as any,
        missionId,
        criteria: input.criteria as any,
        constraints: [],
        decisions: [],
        digestWritten: false,
        rollup: {} as any,
        ratificationMessage: '',
        consumedBucketItems: { consumed: [], skipped: [] },
      } as ForgeMissionResult;
    };

    const mockCampaignFront = () => [{ ...p1, verdict: 'fail' as const }];
    const mockListProbeVerdicts = () => [
      {
        id: 1,
        probeId: p1.id,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'timeout',
        recordedAt: Date.now(),
      },
    ];

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    const deps: CampaignPassDeps = {
      runChamber: chamberDecisionStub,
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      llm: approvingLlm,
    };

    // Run two concurrent passes over the same campaign.
    const [result1, result2] = await Promise.all([
      runCampaignPass(project, campaign.id, 's1', deps),
      runCampaignPass(project, campaign.id, 's1', deps),
    ]);

    // The forge stub should have been called exactly once (the winner) or twice (if both started before the claim).
    // With the claim mechanism, only one should win and return success in forged.
    const totalForged = (result1.forged.length) + (result2.forged.length);
    expect(totalForged).toBe(1);

    // Exactly one mission todo should exist (the winner's mission).
    const allTodos = listTodos(project, {});
    const missionTodos = allTodos.filter((t: any) => t.kind === 'mission');
    expect(missionTodos).toHaveLength(1);

    // The linked mission should be exactly the one mission todo that exists.
    const linkedMissionId = missionTodos[0].id;
    const mission = getMission(project, linkedMissionId);
    expect(mission).not.toBeNull();
  });
});
