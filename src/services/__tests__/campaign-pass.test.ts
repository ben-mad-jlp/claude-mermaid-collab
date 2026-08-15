// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  failureSignature,
  linkProbeToMission,
  getProbeMissionLink,
  listOpenLinkedMissions,
  probeCriterionText,
  runCampaignPass,
  _resetCampaignPassDbCache,
  type CampaignPassDeps,
  type CampaignPassResult,
} from '../campaign-pass';
import {
  createCampaign,
  listProbes,
  recordProbeVerdict,
  _resetCampaignDbCache,
  type CampaignProbe,
  type ProbeVerdictRecord,
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

let project: string;

/** Create the `[MISSION]` graph node (a top-level durable root). */
async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-pass-'));
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

describe('campaign-pass', () => {
  it('links and retrieves a probe→mission link', () => {
    linkProbeToMission(project, 'p-test', 'm-test', 'c-test', 5000);
    const link = getProbeMissionLink(project, 'p-test');
    expect(link).not.toBeNull();
    expect(link?.missionId).toBe('m-test');
    expect(link?.campaignId).toBe('c-test');
    expect(link?.createdAt).toBe(5000);
  });


  describe('failureSignature', () => {
    it('selects the most recent fail verdict evidence', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: 'echo test',
        createdAt: Date.now(),
      };

      const verdicts: ProbeVerdictRecord[] = [
        {
          id: 1,
          probeId: 'p1',
          verdict: 'pass',
          environment: 'worktree',
          commitSha: 'abc123',
          evidence: 'pass evidence',
          recordedAt: 1000,
        },
        {
          id: 2,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'def456',
          evidence: 'Error: timeout occurred',
          recordedAt: 2000,
        },
        {
          id: 3,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'ghi789',
          evidence: 'Error: connection refused',
          recordedAt: 3000,
        },
      ];

      const sig = failureSignature(probe, verdicts);
      expect(sig).toBe('error: connection refused');
    });

    it('falls back to probe.command when no fail evidence', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: 'bun run test:backend',
        createdAt: Date.now(),
      };

      const verdicts: ProbeVerdictRecord[] = [
        {
          id: 1,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'abc123',
          evidence: null,
          recordedAt: 1000,
        },
      ];

      const sig = failureSignature(probe, verdicts);
      expect(sig).toBe('bun run test:backend');
    });

    it('normalises whitespace and ANSI sequences', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: 'test',
        createdAt: Date.now(),
      };

      const verdicts: ProbeVerdictRecord[] = [
        {
          id: 1,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'abc123',
          evidence: '\x1b[31mError:\x1b[0m   multiple   \n  whitespace  \t  runs',
          recordedAt: 1000,
        },
      ];

      const sig = failureSignature(probe, verdicts);
      expect(sig).toBe('error: multiple whitespace runs');
    });

    it('truncates to 200 characters', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: 'test',
        createdAt: Date.now(),
      };

      const longEvidence = 'a'.repeat(250);
      const verdicts: ProbeVerdictRecord[] = [
        {
          id: 1,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'abc123',
          evidence: longEvidence,
          recordedAt: 1000,
        },
      ];

      const sig = failureSignature(probe, verdicts);
      expect(sig.length).toBe(200);
      expect(sig).toBe('a'.repeat(200));
    });

    it('returns empty string for truly empty evidence and command', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: null,
        createdAt: Date.now(),
      };

      const verdicts: ProbeVerdictRecord[] = [
        {
          id: 1,
          probeId: 'p1',
          verdict: 'fail',
          environment: 'worktree',
          commitSha: 'abc123',
          evidence: '   ',
          recordedAt: 1000,
        },
      ];

      const sig = failureSignature(probe, verdicts);
      expect(sig).toBe('');
    });
  });

  describe('probeCriterionText', () => {
    it('renders probe id, command, and environment', () => {
      const probe: CampaignProbe = {
        id: 'p1',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: 'bun run test',
        createdAt: Date.now(),
      };

      const text = probeCriterionText(probe);
      expect(text).toBe('[p1] bun run test (worktree)');
    });

    it('handles missing command', () => {
      const probe: CampaignProbe = {
        id: 'p2',
        campaignId: 'c1',
        kind: 'command',
        environment: 'worktree',
        dependsOn: [],
        verdict: 'fail',
        command: null,
        createdAt: Date.now(),
      };

      const text = probeCriterionText(probe);
      expect(text).toBe('[p2] (worktree)');
    });
  });

  describe('probe→mission linking', () => {
    it('links a probe to a mission', () => {
      linkProbeToMission(project, 'p1', 'm1', 'c1');
      const link = getProbeMissionLink(project, 'p1');
      expect(link).not.toBeNull();
      expect(link?.missionId).toBe('m1');
      expect(link?.campaignId).toBe('c1');
    });

    it('returns null for unlinked probes', () => {
      const link = getProbeMissionLink(project, 'nonexistent');
      expect(link).toBeNull();
    });

    it('is idempotent (INSERT OR REPLACE)', () => {
      linkProbeToMission(project, 'p1', 'm1', 'c1', 1000);
      linkProbeToMission(project, 'p1', 'm2', 'c1', 2000);
      const link = getProbeMissionLink(project, 'p1');
      expect(link?.missionId).toBe('m2');
      expect(link?.createdAt).toBe(2000);
    });

    it('filters open linked missions by campaign', async () => {
      // Create two mission nodes.
      const missionId1 = await makeMissionNode('m1');
      const missionId2 = await makeMissionNode('m2');
      upsertMission(project, missionId1);
      upsertMission(project, missionId2);

      // Link probes to these missions.
      linkProbeToMission(project, 'p1', missionId1, 'c1');
      linkProbeToMission(project, 'p2', missionId2, 'c1');
      linkProbeToMission(project, 'p3', missionId1, 'c2'); // Different campaign.

      // List open links for campaign c1.
      const open = listOpenLinkedMissions(project, 'c1');
      expect(open).toHaveLength(2);
      const probeIds = open.map((l) => l.probeId).sort();
      expect(probeIds).toEqual(['p1', 'p2']);
    });
  });

  it('forges one mission for two probes sharing a failure signature', async () => {
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

    // Track forge calls.
    let forgeCallCount = 0;
    let forgedMissionId = '';
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      // Create the mission todo first, then use its ID.
      const missionTodo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
      forgedMissionId = missionTodo.id;
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

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Should forge exactly one mission.
    expect(forgeCallCount).toBe(1);

    // Both probes should be linked to the same mission.
    const link1 = getProbeMissionLink(project, p1.id);
    const link2 = getProbeMissionLink(project, p2.id);
    expect(link1?.missionId).toBe(forgedMissionId);
    expect(link2?.missionId).toBe(forgedMissionId);

    // Result should show the group and the forged mission.
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].probeIds.sort()).toEqual([p1.id, p2.id].sort());
    expect(result.forged).toHaveLength(1);
    expect(result.forged[0].missionId).toBe(forgedMissionId);
    expect(result.forged[0].probeIds.sort()).toEqual([p1.id, p2.id].sort());
  });

  it('forges separate missions for probes with differing failure signatures', async () => {
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

    // They fail with different signatures.
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
      evidence: 'connection refused',
    });

    // Track forge calls.
    let forgeCallCount = 0;
    const forgedMissions: string[] = [];
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      // Create the mission todo first, then use its ID.
      const missionTodo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
      const missionId = missionTodo.id;
      forgedMissions.push(missionId);
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
      const evidence = probeId === p1.id ? 'timeout' : 'connection refused';
      return [
        {
          id: 1,
          probeId,
          verdict: 'fail' as const,
          environment: 'worktree' as const,
          commitSha: 'abc123',
          evidence,
          recordedAt: Date.now(),
        },
      ];
    };

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Should forge two missions.
    expect(forgeCallCount).toBe(2);

    // Each probe should be linked to a different mission.
    const link1 = getProbeMissionLink(project, p1.id);
    const link2 = getProbeMissionLink(project, p2.id);
    expect(link1?.missionId).not.toBe(link2?.missionId);
    expect([link1?.missionId, link2?.missionId]).toContain(forgedMissions[0]);
    expect([link1?.missionId, link2?.missionId]).toContain(forgedMissions[1]);

    // Result should show two groups.
    expect(result.groups).toHaveLength(2);
    expect(result.forged).toHaveLength(2);
  });

  it('skips a probe that already holds an open linked mission', async () => {
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

    // Pre-link p1 to an open mission.
    const existingMissionId = await makeMissionNode('existing');
    upsertMission(project, existingMissionId);
    linkProbeToMission(project, p1.id, existingMissionId, campaign.id);

    // Track forge calls.
    let forgeCallCount = 0;
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      // Create the mission todo first, then use its ID.
      const missionTodo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
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

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Should forge only one mission (for p2 only).
    expect(forgeCallCount).toBe(1);

    // p1 should be in skipped.
    expect(result.skipped).toContain(p1.id);
    expect(result.skipped).not.toContain(p2.id);

    // p2 should be linked to a new mission (not the existing one).
    const link2 = getProbeMissionLink(project, p2.id);
    expect(link2?.missionId).not.toBe(existingMissionId);

    // p1 should still be linked to the original mission.
    const link1 = getProbeMissionLink(project, p1.id);
    expect(link1?.missionId).toBe(existingMissionId);
  });

  it('preserves fail-open discipline: throwing forge does not block other groups', async () => {
    // Create a campaign with three probes.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
        { kind: 'command', environment: 'worktree', command: 'test2' },
        { kind: 'command', environment: 'worktree', command: 'test3' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const [p1, p2, p3] = probes;

    // p1, p2 fail with signature A; p3 fails with signature B.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'error a',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'error a',
    });
    recordProbeVerdict(project, {
      probeId: p3.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'error b',
    });

    // Forge will throw for the first group (signature 'error a'), but not the second.
    let forgeCallCount = 0;
    const mockForgeMission = async (proj: string, input: any) => {
      forgeCallCount++;
      if (forgeCallCount === 1) {
        throw new Error('forge failed for group 1');
      }
      // Create the mission todo first, then use its ID.
      const missionTodo = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: input.title, kind: 'mission' });
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
        { ...p3, verdict: 'fail' as const },
      ];
    };

    const mockListProbeVerdicts = (proj: string, probeId: string) => {
      const evidence = probeId === p3.id ? 'error b' : 'error a';
      return [
        {
          id: 1,
          probeId,
          verdict: 'fail' as const,
          environment: 'worktree' as const,
          commitSha: 'abc123',
          evidence,
          recordedAt: Date.now(),
        },
      ];
    };

    const deps: CampaignPassDeps = {
      forgeMission: mockForgeMission,
      campaignFront: mockCampaignFront,
      listProbeVerdicts: mockListProbeVerdicts,
    };

    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Forge should be called twice (once per group), but only the second succeeds.
    expect(forgeCallCount).toBe(2);

    // Only one mission should be forged.
    expect(result.forged).toHaveLength(1);

    // p3 should be linked, but p1 and p2 should not.
    expect(getProbeMissionLink(project, p3.id)).not.toBeNull();
    expect(getProbeMissionLink(project, p1.id)).toBeNull();
    expect(getProbeMissionLink(project, p2.id)).toBeNull();

    // Both groups should be listed even though the first failed to forge.
    expect(result.groups).toHaveLength(2);
  });

  it('returns empty result on outer exception (fail-open)', async () => {
    const deps: CampaignPassDeps = {
      campaignFront: () => {
        throw new Error('front read failed');
      },
    };

    const result = await runCampaignPass(project, 'nonexistent-campaign', 's1', deps);

    expect(result.groups).toEqual([]);
    expect(result.forged).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
