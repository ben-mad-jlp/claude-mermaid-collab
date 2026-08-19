// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCampaignPass,
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
  getProbeMissionLink,
} from '../campaign-pass';
import {
  createCampaign,
  listProbes,
  recordProbeVerdict,
  listMissionProposals,
  listProposalObjections,
  _resetCampaignDbCache,
  type CampaignProbe,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import {
  upsertMission,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import type { JudgmentLLM } from '../judgment-llm';

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-proposal-wiring-'));
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

describe('campaign-proposal-wiring', () => {
  const mockForgeMission = async (proj: string, input: any) => {
    // Create the mission todo first, then use its ID.
    const missionTodo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
    const forgedMissionId = missionTodo.id;
    upsertMission(project, forgedMissionId);
    return {
      node: { id: forgedMissionId } as any,
      missionId: forgedMissionId,
      criteria: input.criteria,
      constraints: [],
      decisions: [],
      digestWritten: false,
      rollup: {} as any,
      ratificationMessage: '',
      consumedBucketItems: { consumed: [], skipped: [] },
    };
  };

  const mockCampaignFront = (proj: string, campaignId: string, probes: CampaignProbe[]) => {
    return probes.map((p) => ({ ...p, verdict: 'fail' as const }));
  };

  const mockListProbeVerdicts = (proj: string, probeId: string) => {
    return [
      {
        id: 1,
        probeId,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'timeout',
        recordedAt: Date.now(),
      },
    ];
  };

  it('an approved ruling forges and records the proposal with per-lens objections', async () => {
    // Create a campaign with two probes sharing a failure signature.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
        { kind: 'command', environment: 'worktree', command: 'test2' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];
    const p2 = probes[1];

    // Both fail with the same signature.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'timeout',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'timeout',
    });

    // Use an approving LLM stub.
    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    const deps: CampaignPassDeps = {
      runChamber: chamberDecisionStub,
      forgeMission: mockForgeMission,
      campaignFront: (proj: string, cid: string) => mockCampaignFront(proj, cid, [p1, p2]),
      listProbeVerdicts: mockListProbeVerdicts,
      llm: approvingLlm,
      commitSha: () => 'abc123',
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Should forge exactly one mission.
    expect(result.forged).toHaveLength(1);
    const forgedMissionId = result.forged[0].missionId;

    // Both probes should be linked to the mission.
    const link1 = getProbeMissionLink(project, p1.id);
    const link2 = getProbeMissionLink(project, p2.id);
    expect(link1?.missionId).toBe(forgedMissionId);
    expect(link2?.missionId).toBe(forgedMissionId);

    // Check that the proposal was recorded as approved.
    const proposals = listMissionProposals(project, campaign.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].ruling).toBe('approved');
    expect(proposals[0].ruledAtSha).toBe('abc123');

    // The approving panel should have no objections.
    const objections = listProposalObjections(project, proposals[0].id);
    expect(objections).toHaveLength(0);
  });

  it('a rejected ruling forges nothing and releases the probe claims', async () => {
    // Create a campaign with two probes sharing a failure signature.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
        { kind: 'command', environment: 'worktree', command: 'test2' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];
    const p2 = probes[1];

    // Both fail with the same signature.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'timeout',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'timeout',
    });

    // Use a rejecting LLM stub.
    const rejectingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":"already covered","reasoning":"dup"}';
      },
    };

    let forgeCallCount = 0;
    const mockForge = async (proj: string, input: any) => {
      forgeCallCount++;
      return mockForgeMission(proj, input);
    };

    const deps: CampaignPassDeps = {
      runChamber: chamberDecisionStub,
      forgeMission: mockForge,
      campaignFront: (proj: string, cid: string) => mockCampaignFront(proj, cid, [p1, p2]),
      listProbeVerdicts: mockListProbeVerdicts,
      llm: rejectingLlm,
      commitSha: () => 'abc123',
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Should not forge any missions.
    expect(forgeCallCount).toBe(0);
    expect(result.forged).toHaveLength(0);

    // Both probes should have their claims released (no mission links).
    const link1 = getProbeMissionLink(project, p1.id);
    const link2 = getProbeMissionLink(project, p2.id);
    expect(link1).toBeNull();
    expect(link2).toBeNull();

    // Check that the proposal was recorded as rejected.
    const proposals = listMissionProposals(project, campaign.id);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].ruling).toBe('rejected');

    // The rejecting panel should have one objection (from one lens hitting the objection).
    const objections = listProposalObjections(project, proposals[0].id);
    expect(objections.length).toBeGreaterThan(0);
  });
});
