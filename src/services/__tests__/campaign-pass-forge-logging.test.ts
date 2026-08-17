// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
// Tests for campaign-pass forge logging: verifies console.warn is called on forge failures.
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
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { type ForgeMissionInput } from '../../mcp/tools/mission-forge';
import {
  type MissionProposalRecord,
  type ProposalObjectionRecord,
} from '../campaign-store';
import { type JudgmentLLM } from '../judgment-llm';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-pass-forge-logging-'));
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

describe('campaign-pass-forge-logging', () => {
  it('a throwing forgeMission warns with the campaign id, signature, probe ids and error', async () => {
    // Create a campaign with one probe that will fail.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    // Inject deps: campaignFront returns a failing probe, listProbeVerdicts returns
    // a recorded failure, and forgeMission throws.
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
    const mockForgeMission = async () => {
      throw new Error('boom-forge-failed');
    };
    const mockExecProbe = async () => ({ verdict: 'fail' as const, evidence: 'timeout' });
    const mockCommitSha = () => 'abc123';
    const mockRecordProbeVerdict = () => undefined as any;
    const mockRuleMissionProposal = async (
      _project: string,
      args: { campaignId: string; proposedGoal: string; ruledAtSha: string },
    ): Promise<{ record: MissionProposalRecord; objections: ProposalObjectionRecord[] }> => ({
      record: {
        id: 1,
        campaignId: args.campaignId,
        proposedGoal: args.proposedGoal,
        ruling: 'approved' as const,
        ruledAtSha: args.ruledAtSha,
        rationale: null,
        ruledAt: Date.now(),
        missionId: null,
      },
      objections: [],
    });
    const mockLlm: JudgmentLLM = {
      complete: async () => {
        throw new Error('mockLlm.complete should never be called');
      },
    };

    const deps: CampaignPassDeps = {
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      forgeMission: mockForgeMission,
      execProbe: mockExecProbe,
      commitSha: mockCommitSha,
      recordProbeVerdict: mockRecordProbeVerdict,
      ruleMissionProposal: mockRuleMissionProposal,
      llm: mockLlm,
    };

    // Spy on console.warn to capture log messages.
    const warnCalls: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnCalls.push(args.join(' '));
    };

    try {
      // Run the campaign pass. It should fail gracefully (fail-open).
      const result = await runCampaignPass(project, campaign.id, 's1', deps);

      // Assert that no missions were forged (fail-open path).
      expect(result.forged).toHaveLength(0);

      // Assert that console.warn was called with the expected message containing:
      // - the campaign id
      // - the failure signature ('timeout')
      // - the probe id
      // - the error message ('boom-forge-failed')
      const warnText = warnCalls.join('\n');
      expect(warnText).toContain(campaign.id);
      expect(warnText).toContain('timeout'); // The normalized evidence (failure signature)
      expect(warnText).toContain(p1.id);
      expect(warnText).toContain('boom-forge-failed');
    } finally {
      console.warn = originalWarn;
    }
  });
});
