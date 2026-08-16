// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCampaign,
  addProbe,
  recordProbeVerdict,
  listProbes,
  _resetCampaignDbCache,
} from '../campaign-store';
import { _closeProject } from '../todo-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { _closeDb } from '../supervisor-store';
import { resetCampaignProbesForLandedPaths } from '../coordinator-land';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'land-resets-campaign-probes-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _closeLedgerDb();
  _closeAllCollabDbs();
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('land-resets-campaign-probes', () => {
  it('clears the stored verdict of a probe whose declaredPaths the landed paths touched', async () => {
    // Create a campaign and a probe with declaredPaths.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      declaredPaths: ['src/services/campaign-pass.ts'],
      command: 'true',
    });

    // Seed the probe with a passing verdict.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: probe.environment,
      commitSha: 'abc123def456',
    });

    // Verify the probe reports 'pass' before reset.
    const beforeProbes = listProbes(project, campaign.id);
    const beforeProbe = beforeProbes.find((p) => p.id === probe.id);
    expect(beforeProbe?.verdict).toBe('pass');

    // Call resetCampaignProbesForLandedPaths with a touched path that matches the declared path.
    const result = await resetCampaignProbesForLandedPaths(project, ['src/services/campaign-pass.ts']);

    // Assert the probe is in the reset list.
    expect(result.reset).toContain(probe.id);
    expect(result.kept).not.toContain(probe.id);

    // Re-read the probe and assert its verdict is now 'not-run'.
    const afterProbes = listProbes(project, campaign.id);
    const afterProbe = afterProbes.find((p) => p.id === probe.id);
    expect(afterProbe?.verdict).toBe('not-run');
  });

  it('returns the untouched probe in the kept partition', async () => {
    // Create a campaign with two probes: one for src/services and one for src/mcp.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe1 = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      declaredPaths: ['src/services/campaign-pass.ts'],
      command: 'true',
    });
    const probe2 = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      declaredPaths: ['src/services/other.ts'],
      command: 'true',
    });

    // Seed both probes with passing verdicts.
    recordProbeVerdict(project, {
      probeId: probe1.id,
      verdict: 'pass',
      environment: probe1.environment,
      commitSha: 'abc123def456',
    });
    recordProbeVerdict(project, {
      probeId: probe2.id,
      verdict: 'pass',
      environment: probe2.environment,
      commitSha: 'abc123def456',
    });

    // Call resetCampaignProbesForLandedPaths with only a path that touches probe1.
    const result = await resetCampaignProbesForLandedPaths(project, ['src/services/campaign-pass.ts']);

    // Assert probe1 is reset and probe2 is kept.
    expect(result.reset).toContain(probe1.id);
    expect(result.kept).toContain(probe2.id);

    // Re-read probes: probe1 should be 'not-run', probe2 should still be 'pass'.
    const afterProbes = listProbes(project, campaign.id);
    const afterProbe1 = afterProbes.find((p) => p.id === probe1.id);
    const afterProbe2 = afterProbes.find((p) => p.id === probe2.id);
    expect(afterProbe1?.verdict).toBe('not-run');
    expect(afterProbe2?.verdict).toBe('pass');
  });

  it('coordinator-land.ts statically imports resetProbesForLand from campaign-probe-rerun', async () => {
    // Read the source of coordinator-land.ts.
    const coordinatorLandPath = join(import.meta.dir, '..', 'coordinator-land.ts');
    const source = readFileSync(coordinatorLandPath, 'utf-8');

    // Assert it contains both the static import and the wiring.
    expect(source).toContain('resetProbesForLand');
    expect(source).toContain('campaign-probe-rerun');

    // Assert the resetCampaignProbesForLandedPaths call uses land.landedPaths in the argument list.
    const wiringRegex = /resetCampaignProbesForLandedPaths\([^)]*land\.landedPaths/;
    expect(wiringRegex.test(source)).toBe(true);
  });
});
