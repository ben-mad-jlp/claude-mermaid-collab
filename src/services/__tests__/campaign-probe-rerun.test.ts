// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
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
import { resetProbesForLand } from '../campaign-probe-rerun';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-rerun-'));
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

describe('campaign-probe-rerun', () => {
  it('resets a passing verdict to not-run when a land touches a declared path', async () => {
    // Create a campaign and a probe with declaredPaths.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      declaredPaths: ['src/services'],
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

    // Call resetProbesForLand with a touched path that matches the declared path.
    const result = await resetProbesForLand(project, campaign.id, ['src/services/campaign-pass.ts']);

    // Assert the probe is in the reset list.
    expect(result.reset).toContain(probe.id);
    expect(result.kept).not.toContain(probe.id);

    // Re-read the probe and assert its verdict is now 'not-run'.
    const afterProbes = listProbes(project, campaign.id);
    const afterProbe = afterProbes.find((p) => p.id === probe.id);
    expect(afterProbe?.verdict).toBe('not-run');
  });

  it('keeps a verdict when the land touches only paths the probe omits', async () => {
    // Create a campaign and a probe with declaredPaths.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      declaredPaths: ['src/mcp'],
      command: 'true',
    });

    // Seed the probe with a passing verdict.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: probe.environment,
      commitSha: 'abc123def456',
    });

    // Verify the probe reports 'pass' before the land call.
    const beforeProbes = listProbes(project, campaign.id);
    const beforeProbe = beforeProbes.find((p) => p.id === probe.id);
    expect(beforeProbe?.verdict).toBe('pass');

    // Call resetProbesForLand with a touched path that does NOT match the declared paths.
    const result = await resetProbesForLand(project, campaign.id, ['src/services/foo.ts']);

    // Assert the probe is in the kept list.
    expect(result.kept).toContain(probe.id);
    expect(result.reset).not.toContain(probe.id);

    // Re-read the probe and assert its verdict is still 'pass'.
    const afterProbes = listProbes(project, campaign.id);
    const afterProbe = afterProbes.find((p) => p.id === probe.id);
    expect(afterProbe?.verdict).toBe('pass');
  });
});
