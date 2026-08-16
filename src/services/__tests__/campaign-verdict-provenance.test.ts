// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-verdict-'));
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

describe('campaign-verdict-provenance', () => {
  test('stores environment and commit sha on a recorded verdict', () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    expect(probes).toHaveLength(1);
    const probe = probes[0];

    // Record a verdict with provenance.
    const verdict = recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123def456',
      evidence: 'Test passed successfully',
    });

    // Verify the verdict row has the correct fields.
    expect(verdict.id).toBeDefined();
    expect(verdict.probeId).toBe(probe.id);
    expect(verdict.verdict).toBe('pass');
    expect(verdict.environment).toBe('worktree');
    expect(verdict.commitSha).toBe('abc123def456');
    expect(verdict.evidence).toBe('Test passed successfully');
    expect(verdict.recordedAt).toBeDefined();

    // Read back via listProbeVerdicts.
    const verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toEqual(verdict);

    // Verify that campaign_probe.verdict was updated.
    const updatedProbes = listProbes(project, campaign.id);
    expect(updatedProbes[0].verdict).toBe('pass');
  });

  test('refuses a verdict write that omits the commit sha', () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Attempt to record a verdict without commitSha.
    expect(() => recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: '',
    } as any)).toThrow();

    // Verify that the probe verdict remains 'not-run'.
    const updatedProbes = listProbes(project, campaign.id);
    expect(updatedProbes[0].verdict).toBe('not-run');

    // Verify that no verdict rows were recorded.
    const verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(0);
  });

  test('refuses a verdict write that omits the environment', () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, {
      title: 'Test Campaign',
      probes: [
        { kind: 'command', environment: 'worktree', command: 'true' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const probe = probes[0];

    // Attempt to record a verdict without environment.
    expect(() => recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: '',
      commitSha: 'abc123def456',
    } as any)).toThrow();

    // Verify that the probe verdict remains 'not-run'.
    const updatedProbes = listProbes(project, campaign.id);
    expect(updatedProbes[0].verdict).toBe('not-run');

    // Verify that no verdict rows were recorded.
    const verdicts = listProbeVerdicts(project, probe.id);
    expect(verdicts).toHaveLength(0);
  });
});
