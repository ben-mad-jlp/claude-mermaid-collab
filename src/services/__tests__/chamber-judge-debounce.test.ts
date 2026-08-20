// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Regression: runChamberCompletionArm previously convened UNCONDITIONALLY on every
// campaign pass — no fingerprint, no budget — which burned ~12 back-to-back full
// deliberations in one morning while pinning the orchestrator tick. These tests pin
// the two guards: the unchanged-front debounce and the rolling-24h convene budget.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  addProbe,
  recordProbeVerdict,
  recordChamberDecision,
  listCampaignCompletions,
  _resetCampaignDbCache,
} from '../campaign-store';
import { computeFrontFingerprint, campaignFront } from '../campaign-front';
import { listProbeVerdicts } from '../campaign-store';
import {
  runChamberCompletionArm,
  CHAMBER_CONVENES_PER_DAY_DEFAULT,
} from '../chamber-judge';
import { _closeProject } from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'chamber-debounce-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** A runChamber stub that records invocations and returns a minimal decision. */
function stubChamber(campaignId: string, calls: any[]) {
  return async (_project: string, args: any, _deps: any) => {
    calls.push(args);
    return {
      candidates: [],
      vetoes: [],
      wargamed: [],
      decision: {
        id: 1,
        campaignId,
        sessionId: args.sessionId,
        outcome: 'decision' as const,
        chosenCandidate: 'stub candidate',
        strongestDissent: null,
        refiningGuidance: null,
        decidedAtSha: args.decidedAtSha,
        createdAt: Date.now(),
        frontFingerprint: args.frontFingerprint ?? null,
      },
    };
  };
}

describe('chamber completion arm debounce', () => {
  test('skips the convene when the latest decision fingerprint matches the current front', async () => {
    const campaign = createCampaign(project, { title: 'debounce', goal: 'goal' });
    const probe = addProbe(project, campaign.id, { kind: 'command', environment: 'worktree', command: 'true' });
    recordProbeVerdict(project, { probeId: probe.id, verdict: 'fail', environment: 'worktree', commitSha: 'sha-1' });

    const fingerprint = computeFrontFingerprint(campaignFront(project, campaign.id), (id) => {
      const vs = listProbeVerdicts(project, id);
      return vs.length > 0 ? vs[vs.length - 1].commitSha : null;
    });
    recordChamberDecision(project, {
      campaignId: campaign.id,
      sessionId: 's',
      outcome: 'decision',
      decidedAtSha: 'sha-1',
      frontFingerprint: fingerprint,
    });

    const calls: any[] = [];
    const result = await runChamberCompletionArm(project, campaign.id, 's', {
      runChamber: stubChamber(campaign.id, calls) as any,
    });

    expect(result.convened).toBe(false);
    expect(result.skipped).toBe('unchanged-front');
    expect(calls.length).toBe(0);
  });

  test('convenes when a probe verdict sha changed since the last decision, and stamps the new fingerprint', async () => {
    const campaign = createCampaign(project, { title: 'changed', goal: 'goal' });
    const probe = addProbe(project, campaign.id, { kind: 'command', environment: 'worktree', command: 'true' });
    recordProbeVerdict(project, { probeId: probe.id, verdict: 'fail', environment: 'worktree', commitSha: 'sha-1' });

    // Latest decision fingerprints the OLD evidence.
    const oldFingerprint = computeFrontFingerprint(campaignFront(project, campaign.id), () => 'sha-1');
    recordChamberDecision(project, {
      campaignId: campaign.id,
      sessionId: 's',
      outcome: 'decision',
      decidedAtSha: 'sha-1',
      frontFingerprint: oldFingerprint,
    });

    // New evidence arrives.
    recordProbeVerdict(project, { probeId: probe.id, verdict: 'fail', environment: 'worktree', commitSha: 'sha-2' });

    const calls: any[] = [];
    const result = await runChamberCompletionArm(project, campaign.id, 's', {
      runChamber: stubChamber(campaign.id, calls) as any,
      commitSha: () => 'sha-2',
    });

    expect(result.convened).toBe(true);
    expect(calls.length).toBe(1);
    expect(typeof calls[0].frontFingerprint).toBe('string');
    expect(calls[0].frontFingerprint).toContain(probe.id);
    expect(calls[0].frontFingerprint).toContain('sha-2');
  });

  test('a legacy NULL-fingerprint latest decision does not debounce (convene proceeds)', async () => {
    const campaign = createCampaign(project, { title: 'legacy', goal: 'goal' });
    recordChamberDecision(project, {
      campaignId: campaign.id,
      sessionId: 's',
      outcome: 'decision',
      decidedAtSha: 'sha-1',
    });

    const calls: any[] = [];
    const result = await runChamberCompletionArm(project, campaign.id, 's', {
      runChamber: stubChamber(campaign.id, calls) as any,
      commitSha: () => 'sha-1',
    });

    expect(result.convened).toBe(true);
    expect(calls.length).toBe(1);

    // The completion verdict must actually persist: the arm's record call previously
    // threw "records no examined evidence" on every live convene, leaving
    // campaign_completion_verdict empty while chamber decisions accumulated.
    const completions = listCampaignCompletions(project, campaign.id);
    expect(completions.length).toBe(1);
    expect(completions[0].verdict).toBe('done');
    expect(completions[0].artifactsRead.length).toBeGreaterThan(0);
  });
});

describe('chamber convene budget', () => {
  test('refuses to convene once the rolling-24h decision count reaches the cap, even with a changed front', async () => {
    const campaign = createCampaign(project, { title: 'budget', goal: 'goal' });
    for (let i = 0; i < CHAMBER_CONVENES_PER_DAY_DEFAULT; i++) {
      recordChamberDecision(project, {
        campaignId: campaign.id,
        sessionId: 's',
        outcome: 'decision',
        decidedAtSha: `sha-${i}`,
        frontFingerprint: `fp-${i}`,
      });
    }

    const calls: any[] = [];
    const result = await runChamberCompletionArm(project, campaign.id, 's', {
      runChamber: stubChamber(campaign.id, calls) as any,
    });

    expect(result.convened).toBe(false);
    expect(result.skipped).toBe('convene-budget-exhausted');
    expect(calls.length).toBe(0);
  });

  test('decisions older than 24h do not count against the budget', async () => {
    const campaign = createCampaign(project, { title: 'window', goal: 'goal' });
    for (let i = 0; i < CHAMBER_CONVENES_PER_DAY_DEFAULT; i++) {
      recordChamberDecision(project, {
        campaignId: campaign.id,
        sessionId: 's',
        outcome: 'decision',
        decidedAtSha: `sha-${i}`,
        frontFingerprint: `fp-${i}`,
      });
    }

    // A clock 25h ahead ages every seeded decision out of the window.
    const calls: any[] = [];
    const result = await runChamberCompletionArm(project, campaign.id, 's', {
      runChamber: stubChamber(campaign.id, calls) as any,
      now: () => Date.now() + 25 * 60 * 60 * 1000,
      commitSha: () => 'sha-x',
    });

    expect(result.convened).toBe(true);
    expect(calls.length).toBe(1);
  });
});
