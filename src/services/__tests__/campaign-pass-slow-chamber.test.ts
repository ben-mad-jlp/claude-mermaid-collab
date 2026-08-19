/**
 * Regression test for campaign pass with a slow chamber completion arm.
 *
 * Verifies that the campaign pass correctly handles a chamber convene that takes
 * longer than 90 seconds by using a fake clock. The test captures state from a
 * single beforeAll pass run and asserts across multiple it() blocks.
 *
 * Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
 */

// Module-scope setup BEFORE importing stores (pattern: campaign-pass-scheduling.test.ts:19-20).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'campaign-slow-chamber-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  createCampaign,
  listProbes,
  recordProbeVerdict,
  recordMissionProposal,
  listMissionProposals,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  runCampaignPassForProject,
  _resetCampaignPassThrottle,
  type CampaignSchedulingDeps,
} from '../campaign-scheduling';
import {
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
} from '../campaign-pass';
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
import { CAMPAIGN_PASS_TIMEOUT_MS } from '../orchestrator-live';
import type { MissionCriterion } from '../mission-store';

let project: string;
let capturedForgeCalls: Array<{ title: string }> = [];
let capturedSimulatedElapsedMs: number = 0;
let capturedCampaignId: string = '';

beforeAll(async () => {
  project = dir;

  // Create a campaign with a single probe that will fail.
  const campaign = createCampaign(project, {
    title: 'Slow Chamber Campaign',
    probes: [
      { kind: 'command', environment: 'worktree', command: 'slow1' },
    ],
  });
  capturedCampaignId = campaign.id;

  // Get the probe and record a fail verdict.
  const probes = listProbes(project, campaign.id);
  const probe = probes[0];

  recordProbeVerdict(project, {
    probeId: probe.id,
    verdict: 'fail',
    environment: 'worktree',
    commitSha: 'abc123',
    evidence: 'slow',
  });

  // Set up fake clock that will be advanced by the stub chamber.
  let fakeNow = 1_000_000;

  // Create mock deps with a slow runChamber that advances time.
  const passDeps: CampaignPassDeps = {
    campaignFront: () => {
      return [{ ...probe, verdict: 'fail' as const }];
    },
    listProbeVerdicts: () => {
      return [
        {
          id: 1,
          probeId: probe.id,
          verdict: 'fail' as const,
          environment: 'worktree' as const,
          commitSha: 'abc123',
          evidence: 'slow',
          recordedAt: fakeNow,
        },
      ];
    },
    execProbe: async () => {
      return { verdict: 'fail' as const, evidence: 'slow' };
    },
    commitSha: () => 'abc123',
    now: () => fakeNow,
    runChamber: async () => {
      // Simulate a slow chamber convene: record start time, advance fake clock past 90s,
      // and return a decision.
      const start = fakeNow;
      await Promise.resolve(); // Yield control but don't actually sleep.
      fakeNow += 120_000; // Advance 120 seconds past the 90-second threshold.
      capturedSimulatedElapsedMs = fakeNow - start;

      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision: {
          id: 1,
          campaignId: campaign.id,
          sessionId: 's1',
          outcome: 'decision' as const,
          chosenCandidate: 'Close the slow-convene probe failures',
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'abc123',
          createdAt: fakeNow,
        },
        forged: null,
      };
    },
    ruleMissionProposal: async (proj, args) => {
      // Must write the durable row, not just return approval.
      const record = recordMissionProposal(proj, {
        campaignId: args.campaignId,
        proposedGoal: args.proposedGoal,
        ruling: 'approved',
        ruledAtSha: 'abc123',
      });
      return { record, objections: [] };
    },
    forgeMission: async (proj, input) => {
      // Record the forge call with its title.
      capturedForgeCalls.push({ title: input.title });

      // Create the mission todo and mission row.
      const missionTodo = await createTodo(proj, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      const missionId = missionTodo.id;
      upsertMission(proj, missionId);

      // Create minimal MissionCriterion objects from input strings for proper typing.
      const criteria: MissionCriterion[] = (input.criteria || []).map((text, idx) => ({
        id: `crit_test_${idx}`,
        todoId: missionId,
        text,
        nickname: `crit${idx}`,
        met: false,
        order: idx,
        updatedAt: Date.now(),
        type: 'capability' as const,
        status: 'active' as const,
        evidence: null,
        verifiedBy: null,
        verifiedAt: null,
        verifiedAtSha: null,
        evidencePaths: [],
        reopenCount: 0,
        verifyAttemptCount: 0,
        serveAttemptCount: 0,
        lastReopenSha: null,
        dependsOn: [],
        droppedReason: null,
        droppedAt: null,
        droppedBy: null,
        reArmCount: 0,
        measurementPendingUntil: null,
      }));

      return {
        node: { id: missionId } as any,
        missionId,
        criteria,
        constraints: [],
        decisions: [],
        digestWritten: false,
        rollup: {} as any,
        ratificationMessage: '',
        consumedBucketItems: { consumed: [], skipped: [] },
      };
    },
  };

  // Run the campaign pass with injected deps.
  const schedulingDeps: CampaignSchedulingDeps = {
    passDepsFn: () => passDeps,
    runChamberCompletionArm: async () => ({}) as any,
  };

  // Run the pass and await to ensure state is captured before tests run.
  await runCampaignPassForProject(project, { session: 's1', deps: schedulingDeps });
});

afterAll(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _resetCampaignPassThrottle(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('campaign-pass slow chamber regression', () => {
  it('forges once with the chamber-decided candidate after a convene slower than 90s', () => {
    expect(capturedForgeCalls.length).toBe(1);
    expect(capturedForgeCalls[0].title).toBe('Close the slow-convene probe failures');
    expect(capturedSimulatedElapsedMs).toBeGreaterThan(90_000);
  });

  it('records a campaign_mission_proposal row for the campaign', () => {
    const proposals = listMissionProposals(project, capturedCampaignId);
    expect(proposals.length).toBeGreaterThanOrEqual(1);

    // Verify all proposals are for the campaign we created.
    for (const proposal of proposals) {
      expect(proposal.campaignId).toBe(capturedCampaignId);
    }
  });

  it('the campaign pass budget covers the measured convene', () => {
    expect(capturedSimulatedElapsedMs).toBeGreaterThan(90_000);
    expect(capturedSimulatedElapsedMs).toBeLessThan(CAMPAIGN_PASS_TIMEOUT_MS);
  });
});
