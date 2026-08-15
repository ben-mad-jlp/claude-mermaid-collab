// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  listProbes,
  recordProbeVerdict,
  listProbeVerdicts,
  _resetCampaignDbCache,
} from '../campaign-store';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import {
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { canonicalProjectRoot } from '../store-paths';
import {
  classifyRigRun,
  runRigFaultArm,
  rigFaultConditionKey,
  CAMPAIGN_RIG_FAULT_KIND,
  type CampaignRigFaultArmDeps,
} from '../campaign-rig-fault';
import type { RigResetRecord } from '../campaign-rig-reset';
import type { Escalation } from '../supervisor-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-rig-fault-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('campaign-rig-fault', () => {
  it('yields rig-fault when the opened count differs from the manifest count', () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Rig Fault Test Campaign',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);
    const probe = probes[0];

    // Construct a reset record with mismatched counts.
    const reset: RigResetRecord = {
      id: 1,
      probeId: probe.id,
      commitSha: 'abc123def456',
      openedMemberCount: 5,
      manifestCount: 7,
      resetAt: Date.now(),
    };

    // Classify with a pass outcome — the mismatch should dominate.
    const verdict1 = classifyRigRun(reset, 'pass');
    expect(verdict1).toBe('rig-fault');

    // Classify with a fail outcome — the mismatch should still dominate.
    const verdict2 = classifyRigRun(reset, 'fail');
    expect(verdict2).toBe('rig-fault');

    // Construct a reset record with matching counts.
    const resetOk: RigResetRecord = {
      id: 2,
      probeId: probe.id,
      commitSha: 'abc123def456',
      openedMemberCount: 7,
      manifestCount: 7,
      resetAt: Date.now(),
    };

    // Classify with matching counts — should pass through the probe outcome.
    const verdict3 = classifyRigRun(resetOk, 'pass');
    expect(verdict3).toBe('pass');

    const verdict4 = classifyRigRun(resetOk, 'fail');
    expect(verdict4).toBe('fail');
  });

  it('raises exactly one card for a rig-fault verdict', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Rig Fault Card Test',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Set up injected dependencies.
    const createdCards: Array<Parameters<typeof createEscalation>[0]> = [];
    const createEscalation = (input: any) => {
      createdCards.push(input);
      return {
        escalation: {
          id: `esc-${createdCards.length}`,
          project: input.project,
          session: input.session,
          kind: input.kind,
          questionText: input.questionText,
          status: 'open',
          createdAt: Date.now(),
          resolvedAt: null,
          serverId: '',
          todoId: input.todoId ?? null,
          options: null,
          recommended: null,
          ui: null,
          operatorGated: input.operatorGated ? 1 : 0,
          audience: input.audience,
          proof: null,
          stewardAttempts: 0,
          suggestedAction: null,
          triageInFlight: false,
          resolvedBy: null,
          briefingMd: null,
          briefingModel: null,
          briefingAt: null,
          conditionKey: input.conditionKey ?? null,
          conditionHash: null,
          lastSeenAt: Date.now(),
          recurrenceCount: 0,
          resolutionNote: null,
          expiresAt: null,
        } as Escalation,
        isNew: true,
      };
    };

    const listOpenEscalations = (filter?: any) => {
      return createdCards
        .filter(
          (card) =>
            (filter?.project == null || card.project === filter.project) &&
            (filter?.kind == null || card.kind === filter.kind),
        )
        .map((_, idx) => ({
          id: `esc-${idx + 1}`,
          conditionKey: _.conditionKey ?? null,
        } as Partial<Escalation>))
        .map((e) => e as Escalation);
    };

    const deps: CampaignRigFaultArmDeps = {
      createEscalation,
      listOpenEscalations,
      recordProbeVerdict: () => ({
        id: 1,
        probeId: probe.id,
        verdict: 'pass' as const,
        environment: 'rig' as const,
        commitSha: 'abc123',
        evidence: null,
        recordedAt: Date.now(),
      }),
    };

    // Construct a reset record with mismatched counts.
    const reset: RigResetRecord = {
      id: 1,
      probeId: probe.id,
      commitSha: 'abc123def456',
      openedMemberCount: 5,
      manifestCount: 7,
      resetAt: Date.now(),
    };

    // Run the arm twice with the same mismatch.
    const result1 = await runRigFaultArm(project, probe.id, reset, 'pass', 'test-session', deps);
    expect(result1.raised).toBe(true);
    expect(result1.verdict).toBe('rig-fault');

    const result2 = await runRigFaultArm(project, probe.id, reset, 'pass', 'test-session', deps);
    expect(result2.raised).toBe(false);
    expect(result2.verdict).toBe('rig-fault');

    // Verify exactly one card was created.
    expect(createdCards).toHaveLength(1);
    expect(createdCards[0].kind).toBe(CAMPAIGN_RIG_FAULT_KIND);
    expect(createdCards[0].operatorGated).toBe(true);
    expect(createdCards[0].audience).toBe('human');
    expect(createdCards[0].conditionKey).toBe(
      rigFaultConditionKey(probe.id, 5, 7),
    );
  });

  it('keeps the prior verdict when a run yields rig-fault', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Rig Fault Verdict Preservation',
      probes: [
        { kind: 'command', environment: 'rig', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Record a known prior verdict: 'pass'.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: 'rig',
      commitSha: 'prior123sha456',
    });

    // Verify the prior verdict is stored.
    let verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toBe('pass');

    // Set up minimal injected dependencies (listOpenEscalations returns empty).
    const deps: CampaignRigFaultArmDeps = {
      createEscalation: (input: any) => ({
        escalation: {
          id: 'esc-1',
          project: input.project,
          session: input.session,
          kind: input.kind,
          questionText: input.questionText,
          status: 'open',
          createdAt: Date.now(),
          resolvedAt: null,
          serverId: '',
          todoId: null,
          options: null,
          recommended: null,
          ui: null,
          operatorGated: 1,
          audience: 'human',
          proof: null,
          stewardAttempts: 0,
          suggestedAction: null,
          triageInFlight: false,
          resolvedBy: null,
          briefingMd: null,
          briefingModel: null,
          briefingAt: null,
          conditionKey: input.conditionKey ?? null,
          conditionHash: null,
          lastSeenAt: Date.now(),
          recurrenceCount: 0,
          resolutionNote: null,
          expiresAt: null,
        } as Escalation,
        isNew: true,
      }),
      listOpenEscalations: () => [],
      // Note: NOT providing recordProbeVerdict, so the arm won't attempt to record.
    };

    // Construct a reset record with mismatched counts.
    const reset: RigResetRecord = {
      id: 1,
      probeId: probe.id,
      commitSha: 'rig123sha456',
      openedMemberCount: 5,
      manifestCount: 7,
      resetAt: Date.now(),
    };

    // Run the arm with a rig fault (counts mismatch).
    const result = await runRigFaultArm(project, probe.id, reset, 'fail', 'test-session', deps);
    expect(result.verdict).toBe('rig-fault');
    expect(result.recorded).toBe(false);

    // Verify the prior verdict is still there (no new record was added).
    verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toBe('pass');

    // Also verify the probe's stored verdict wasn't updated.
    const updatedProbes = listProbes(project, campaign.id);
    expect(updatedProbes[0].verdict).toBe('pass');
  });
});
