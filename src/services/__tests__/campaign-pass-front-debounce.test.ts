// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
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
  listChamberDecisions,
  listProbeVerdicts,
  recordProbeVerdict,
  _resetCampaignDbCache,
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

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-pass-front-debounce-'));
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

describe('campaign-pass front-fingerprint debounce', () => {
  it('a second pass over an unchanged front records exactly one chamber_decision row', async () => {
    // Create a campaign with two probes.
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
    let sha = 'abc123';
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: sha,
      evidence: 'timeout',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: sha,
      evidence: 'timeout',
    });

    // Track forge calls.
    let forgeCallCount = 0;
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      const missionTodo = await createTodo(project, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      const missionId = missionTodo.id;
      upsertMission(project, missionId);
      return {
        node: { id: missionId } as any,
        missionId,
        criteria: input.criteria,
        constraints: [],
        decisions: [],
        digestWritten: false,
        rollup: {} as any,
        ratificationMessage: '',
        consumedBucketItems: { consumed: [], skipped: [] },
      };
    };

    const mockCampaignFront = (proj: string, campaignId: string) => {
      return [
        { ...p1, verdict: 'fail' as const },
        { ...p2, verdict: 'fail' as const },
      ];
    };

    const mockCommitSha = () => sha;

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    // Track chamber calls.
    let chamberCallCount = 0;
    const mockRunChamber: CampaignPassDeps['runChamber'] = async (proj, args, deps) => {
      chamberCallCount++;
      // Record the decision with the frontFingerprint that was passed.
      const { recordChamberDecision } = await import('../campaign-store');
      const decision = recordChamberDecision(proj, {
        campaignId: args.campaignId,
        sessionId: args.sessionId,
        outcome: 'decision' as const,
        chosenCandidate: 'Test decision',
        strongestDissent: null,
        refiningGuidance: null,
        decidedAtSha: args.decidedAtSha,
        frontFingerprint: args.frontFingerprint,
        transcript: [],
      });
      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision,
        forged: null,
      };
    };

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts, // Use live implementation
      commitSha: mockCommitSha,
      execProbe: async () => ({ verdict: 'fail' as const, evidence: 'timeout' }),
      llm: approvingLlm,
      runChamber: mockRunChamber,
      isMissionOpen: () => false, // Prevent probes from being skipped due to links
    };

    // First pass.
    const result1 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(chamberCallCount).toBe(1);

    // Second pass with unchanged front — should debounce.
    const result2 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(chamberCallCount).toBe(1); // No additional chamber call
    expect(result2.skipped).toHaveLength(2); // Both probes skipped (debounced)

    // Verify exactly one decision row was recorded.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(1);
  });

  it('a changed probe verdict sha re-arms the convene and records a second decision row', async () => {
    // Create a campaign with two probes.
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

    // Mutable sha for verdicts.
    let sha = 'abc123';

    // Both fail with the same signature, initially at sha abc123.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: sha,
      evidence: 'timeout',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: sha,
      evidence: 'timeout',
    });

    // Track forge calls.
    let forgeCallCount = 0;
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      const missionTodo = await createTodo(project, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      const missionId = missionTodo.id;
      upsertMission(project, missionId);
      return {
        node: { id: missionId } as any,
        missionId,
        criteria: input.criteria,
        constraints: [],
        decisions: [],
        digestWritten: false,
        rollup: {} as any,
        ratificationMessage: '',
        consumedBucketItems: { consumed: [], skipped: [] },
      };
    };

    const mockCampaignFront = (proj: string, campaignId: string) => {
      return [
        { ...p1, verdict: 'fail' as const },
        { ...p2, verdict: 'fail' as const },
      ];
    };

    const mockCommitSha = () => sha;

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    // Track chamber calls.
    let chamberCallCount = 0;
    const mockRunChamber: CampaignPassDeps['runChamber'] = async (proj, args, deps) => {
      chamberCallCount++;
      const { recordChamberDecision } = await import('../campaign-store');
      const decision = recordChamberDecision(proj, {
        campaignId: args.campaignId,
        sessionId: args.sessionId,
        outcome: 'decision' as const,
        chosenCandidate: 'Test decision',
        strongestDissent: null,
        refiningGuidance: null,
        decidedAtSha: args.decidedAtSha,
        frontFingerprint: args.frontFingerprint,
        transcript: [],
      });
      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision,
        forged: null,
      };
    };

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts, // Use live implementation
      commitSha: mockCommitSha,
      execProbe: async () => ({ verdict: 'fail' as const, evidence: 'timeout' }),
      llm: approvingLlm,
      runChamber: mockRunChamber,
      isMissionOpen: () => false, // Prevent probes from being skipped due to links
    };

    // First pass at sha abc123.
    const result1 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(chamberCallCount).toBe(1);

    // Change the sha for one of the failing probes.
    sha = 'def456';
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: sha,
      evidence: 'timeout',
    });

    // Second pass at sha def456 — should re-arm because the fingerprint changed.
    const result2 = await runCampaignPass(project, campaign.id, 's1', deps);
    expect(chamberCallCount).toBe(2); // Chamber called again

    // Verify two decision rows were recorded with different fingerprints.
    const decisions = listChamberDecisions(project, campaign.id);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].frontFingerprint).not.toBe(decisions[1].frontFingerprint);
  });
});
