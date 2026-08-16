// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const supervisorDir = mkdtempSync(join(tmpdir(), 'campaign-liveness-card-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import {
  runCampaignLivenessArm,
  campaignLivenessConditionKey,
  CAMPAIGN_FRONT_UNSATISFIED_KIND,
  type CampaignLivenessArmDeps,
} from '../campaign-liveness-card.ts';
import { listOpenEscalations, _closeDb } from '../supervisor-store.ts';
import {
  createCampaign,
  recordProbeVerdict,
  listProbes,
  _resetCampaignDbCache,
} from '../campaign-store.ts';
import { linkProbeToMission, _resetCampaignPassDbCache } from '../campaign-pass.ts';
import { createTodo, _closeProject } from '../todo-store.ts';
import { _resetMissionDbCache } from '../mission-store.ts';
import { _closeAllCollabDbs } from '../collab-db.ts';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-liveness-card-project-'));
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
  _resetMissionDbCache(project);
  _closeAllCollabDbs();
  rmSync(project, { recursive: true, force: true });
});

afterAll(() => {
  _closeDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
});

describe('campaign-liveness-card', () => {
  it('raises one card when the front is unsatisfied with zero open missions and zero open cards', async () => {
    // Create a campaign with two probes.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
        { kind: 'command', environment: 'worktree', command: 'test2' },
      ],
    });

    // Get the probe IDs.
    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];
    const p2 = probes[1];

    // Record verdicts: p1 fails, p2 fails.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'Error: test failed',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'Error: probe failed',
    });

    // Run the arm.
    const result = await runCampaignLivenessArm(project, campaign.id, 'session-1');

    // Assert: card is raised.
    expect(result.raised).toBe(true);
    expect(result.bumped).toBe(false);
    expect(result.unsatisfied).toEqual([p1.id, p2.id]);
    expect(result.conditionKey).toMatch(new RegExp(`^campaign-front-unsatisfied:${campaign.id}:`));

    // Assert: the card exists in the store.
    const cards = listOpenEscalations({ project, kind: CAMPAIGN_FRONT_UNSATISFIED_KIND });
    expect(cards.length).toBe(1);
    expect(cards[0].conditionKey).toBe(result.conditionKey);
    expect(cards[0].operatorGated).toBe(1);
    expect(cards[0].audience).toBe('human');
  });

  it('bumps the existing row to recurrenceCount 1 when the same condition is observed twice', async () => {
    // Create a campaign with two probes.
    const campaign = createCampaign(project, {
      title: 'Recurrence Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
        { kind: 'command', environment: 'worktree', command: 'test2' },
      ],
    });

    // Get the probe IDs.
    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];
    const p2 = probes[1];

    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'Error: fail',
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'Error: fail',
    });

    // First call: raises the card.
    const result1 = await runCampaignLivenessArm(project, campaign.id, 'session-1');
    expect(result1.raised).toBe(true);
    expect(result1.bumped).toBe(false);

    // Verify: exactly one card exists with recurrenceCount = 0 (initial).
    let cards = listOpenEscalations({ project, kind: CAMPAIGN_FRONT_UNSATISFIED_KIND });
    expect(cards.length).toBe(1);
    expect(cards[0].recurrenceCount).toBe(0);

    // Second call: same front, but inject listOpenEscalations: () => [] to bypass
    // the open-card check (so the arm tries to create again), proving the STORE dedups.
    const mockListOpenEscalations: typeof listOpenEscalations = () => [];
    const result2 = await runCampaignLivenessArm(project, campaign.id, 'session-1', {
      listOpenEscalations: mockListOpenEscalations,
    });

    // The arm will call createEscalation again (because our mock says no open cards),
    // and the store will bump the existing row.
    expect(result2.raised).toBe(true);
    expect(result2.bumped).toBe(true);

    // Verify: still one card, but recurrenceCount = 1.
    cards = listOpenEscalations({ project, kind: CAMPAIGN_FRONT_UNSATISFIED_KIND });
    expect(cards.length).toBe(1);
    expect(cards[0].recurrenceCount).toBe(1);
  });

  it('stays quiet while a linked mission is open', async () => {
    // Create a campaign with one failing probe.
    const campaign = createCampaign(project, {
      title: 'Linked Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'test1' },
      ],
    });

    // Get the probe ID.
    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];

    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'fail',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: 'Error: fail',
    });

    // Create a mission and link the probe to it.
    const missionTodo = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Test',
      kind: 'mission',
    });
    const actualMissionId = missionTodo.id;

    linkProbeToMission(project, p1.id, actualMissionId, campaign.id);

    // Mock listOpenLinkedMissions to return the linked mission.
    const mockListOpenLinkedMissions = () => [
      {
        probeId: p1.id,
        missionId: actualMissionId,
        campaignId: campaign.id,
        createdAt: Date.now(),
      },
    ];

    // Mock createEscalation to assert it's never called.
    let createEscalationCalled = false;
    const mockCreateEscalation = () => {
      createEscalationCalled = true;
      throw new Error('Should not be called');
    };

    // Run the arm with mocked dependencies.
    const result = await runCampaignLivenessArm(project, campaign.id, 'session-1', {
      listOpenLinkedMissions: mockListOpenLinkedMissions,
      createEscalation: mockCreateEscalation as any,
    });

    // Assert: arm stays quiet (returns EMPTY_RESULT because mission is open).
    expect(result.raised).toBe(false);
    expect(result.bumped).toBe(false);
    expect(result.unsatisfied).toEqual([]);
    expect(result.conditionKey).toBe(null);
    expect(createEscalationCalled).toBe(false);

    // Assert: no card was created.
    const cards = listOpenEscalations({ project, kind: CAMPAIGN_FRONT_UNSATISFIED_KIND });
    expect(cards.length).toBe(0);
  });
});
