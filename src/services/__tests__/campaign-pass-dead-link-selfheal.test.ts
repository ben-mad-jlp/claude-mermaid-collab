// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
// Tests for campaign-pass dead link self-healing: verifies that probes with stale links
// are unlinked before attempting to forge new missions.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runCampaignPass,
  getProbeMissionLink,
  linkProbeToMission,
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
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-pass-dead-link-selfheal-'));
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

describe('campaign-pass-dead-link-selfheal', () => {
  it('a link to a missing mission is deleted and the probe is re-forged on the same pass', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    // Seed a link to a mission that does not exist.
    linkProbeToMission(project, p1.id, 'mission-does-not-exist', campaign.id, 1000);

    // Verify the link was created.
    const linkBefore = getProbeMissionLink(project, p1.id);
    expect(linkBefore).toBeTruthy();
    expect(linkBefore!.missionId).toBe('mission-does-not-exist');

    // Inject deps: campaignFront returns a failing probe, listProbeVerdicts returns
    // a recorded failure, and forgeMission succeeds with a new mission.
    const mockCampaignFront = () => [{ ...p1, verdict: 'fail' as const }];
    const mockListProbeVerdicts = () => [
      {
        id: 1,
        probeId: p1.id,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'fail',
        recordedAt: Date.now(),
      },
    ];
    const mockForgeMission = async () => ({
      missionId: 'mission-new',
    } as any);
    const mockExecProbe = async () => ({ verdict: 'fail' as const, evidence: 'fail' });
    const mockCommitSha = () => 'abc123';
    const mockRecordProbeVerdict = () => undefined as any;
    const mockRuleMissionProposal = async () => ({
      record: { ruling: 'approved' } as any,
      objections: [],
    });

    // Use the DEFAULT isMissionOpen so the real getMission → null path is exercised.
    // This simulates the mission truly not existing.
    const deps: CampaignPassDeps = {
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      forgeMission: mockForgeMission,
      execProbe: mockExecProbe,
      commitSha: mockCommitSha,
      recordProbeVerdict: mockRecordProbeVerdict,
      ruleMissionProposal: mockRuleMissionProposal,
    };

    // Run the campaign pass.
    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Assert that the probe was forged (not skipped).
    expect(result.forged).toHaveLength(1);
    expect(result.forged[0].probeIds).toContain(p1.id);
    expect(result.forged[0].missionId).toBe('mission-new');

    // Assert that the probe is not in skipped.
    expect(result.skipped).not.toContain(p1.id);

    // Assert that the link was relinked to the new mission.
    const linkAfter = getProbeMissionLink(project, p1.id);
    expect(linkAfter).toBeTruthy();
    expect(linkAfter!.missionId).toBe('mission-new');
  });

  it('a link to a terminal mission is deleted and the probe is re-forged on the same pass', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    // Seed a link to a terminal mission.
    linkProbeToMission(project, p1.id, 'mission-terminal', campaign.id, 1000);

    // Verify the link was created.
    const linkBefore = getProbeMissionLink(project, p1.id);
    expect(linkBefore).toBeTruthy();
    expect(linkBefore!.missionId).toBe('mission-terminal');

    // Inject deps: campaignFront returns a failing probe, listProbeVerdicts returns
    // a recorded failure, and forgeMission succeeds with a new mission.
    const mockCampaignFront = () => [{ ...p1, verdict: 'fail' as const }];
    const mockListProbeVerdicts = () => [
      {
        id: 1,
        probeId: p1.id,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'fail',
        recordedAt: Date.now(),
      },
    ];
    const mockForgeMission = async () => ({
      missionId: 'mission-new',
    } as any);
    const mockExecProbe = async () => ({ verdict: 'fail' as const, evidence: 'fail' });
    const mockCommitSha = () => 'abc123';
    const mockRecordProbeVerdict = () => undefined as any;
    const mockRuleMissionProposal = async () => ({
      record: { ruling: 'approved' } as any,
      objections: [],
    });

    // Inject isMissionOpen to return false for the terminal mission.
    const mockIsMissionOpen = () => false;

    const deps: CampaignPassDeps = {
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      forgeMission: mockForgeMission,
      execProbe: mockExecProbe,
      commitSha: mockCommitSha,
      recordProbeVerdict: mockRecordProbeVerdict,
      isMissionOpen: mockIsMissionOpen,
      ruleMissionProposal: mockRuleMissionProposal,
    };

    // Run the campaign pass.
    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Assert that the probe was forged (not skipped).
    expect(result.forged).toHaveLength(1);
    expect(result.forged[0].probeIds).toContain(p1.id);
    expect(result.forged[0].missionId).toBe('mission-new');

    // Assert that the probe is not in skipped.
    expect(result.skipped).not.toContain(p1.id);

    // Assert that the link was relinked to the new mission.
    const linkAfter = getProbeMissionLink(project, p1.id);
    expect(linkAfter).toBeTruthy();
    expect(linkAfter!.missionId).toBe('mission-new');
  });

  it('a probe with an open linked mission is skipped and its link is preserved', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    // Seed a link to an open mission.
    linkProbeToMission(project, p1.id, 'mission-open', campaign.id, 1000);

    // Verify the link was created.
    const linkBefore = getProbeMissionLink(project, p1.id);
    expect(linkBefore).toBeTruthy();
    expect(linkBefore!.missionId).toBe('mission-open');

    // Inject deps: campaignFront returns a failing probe.
    const mockCampaignFront = () => [{ ...p1, verdict: 'fail' as const }];
    const mockListProbeVerdicts = () => [
      {
        id: 1,
        probeId: p1.id,
        verdict: 'fail' as const,
        environment: 'worktree' as const,
        commitSha: 'abc123',
        evidence: 'fail',
        recordedAt: Date.now(),
      },
    ];
    const mockForgeMission = async () => ({
      missionId: 'mission-new',
    } as any);
    const mockExecProbe = async () => ({ verdict: 'fail' as const, evidence: 'fail' });
    const mockCommitSha = () => 'abc123';
    const mockRecordProbeVerdict = () => undefined as any;

    // Inject isMissionOpen to return true for the open mission.
    const mockIsMissionOpen = () => true;

    const deps: CampaignPassDeps = {
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      forgeMission: mockForgeMission,
      execProbe: mockExecProbe,
      commitSha: mockCommitSha,
      recordProbeVerdict: mockRecordProbeVerdict,
      isMissionOpen: mockIsMissionOpen,
    };

    // Run the campaign pass.
    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Assert that the probe was skipped (not forged).
    expect(result.skipped).toContain(p1.id);
    expect(result.forged).toHaveLength(0);

    // Assert that the link was preserved (unchanged).
    const linkAfter = getProbeMissionLink(project, p1.id);
    expect(linkAfter).toBeTruthy();
    expect(linkAfter!.missionId).toBe('mission-open');
  });
});
