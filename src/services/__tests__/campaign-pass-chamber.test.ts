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
  project = mkdtempSync(join(tmpdir(), 'campaign-pass-chamber-'));
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

describe('campaign-pass chamber routing', () => {
  it('a failing front convenes the chamber and forges only the president-decided candidate', async () => {
    // Create a campaign with two probes that fail with the same signature.
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

    // Track forge calls and their inputs.
    let forgeCallCount = 0;
    let forgedTitle = '';
    const forgedMissionId = 'm-forge-1';
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      forgedTitle = input.title;
      // Create the mission todo first, then use its ID.
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

    const approvingLlm: JudgmentLLM = {
      async complete(): Promise<string> {
        return '{"objection":null,"reasoning":"ok"}';
      },
    };

    // Track chamber calls.
    let chamberCallCount = 0;
    const decidingChamber: CampaignPassDeps['runChamber'] = async (proj, args, deps) => {
      chamberCallCount++;
      // Verify that the chamber was passed forgeMission as a dep.
      expect(deps.forgeMission).toBeDefined();
      return {
        candidates: [],
        vetoes: [],
        wargamed: [],
        decision: {
          id: 1,
          campaignId: '',
          sessionId: 's1',
          outcome: 'decision' as const,
          chosenCandidate: 'Close the timeout probe failures',
          strongestDissent: null,
          refiningGuidance: null,
          decidedAtSha: 'abc123',
          createdAt: Date.now(),
          frontFingerprint: null,
        },
        forged: null,
      };
    };

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
      llm: approvingLlm,
      runChamber: decidingChamber,
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Chamber should be called exactly once.
    expect(chamberCallCount).toBe(1);

    // Forge should be called exactly once (by runCampaignPass, not by the chamber itself).
    expect(forgeCallCount).toBe(1);

    // The forged title should carry the president's candidate, not the signature.
    expect(forgedTitle).toBe('Close the timeout probe failures');

    // Both probes should be linked to the same mission.
    expect(result.forged).toHaveLength(1);
    expect(result.forged[0].probeIds.sort()).toEqual([p1.id, p2.id].sort());

    // Result should show one group and one forged mission.
    expect(result.groups).toHaveLength(1);
    expect(result.forged).toHaveLength(1);
  });
});
