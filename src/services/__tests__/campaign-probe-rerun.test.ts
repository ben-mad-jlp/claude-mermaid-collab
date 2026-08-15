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
import { _closeProject, createTodo } from '../todo-store';
import { _closeLedgerDb } from '../worker-ledger';
import { _closeAllCollabDbs } from '../collab-db';
import { _closeDb } from '../supervisor-store';
import { resetProbesForLand } from '../campaign-probe-rerun';
import { runCampaignPass, _resetCampaignPassDbCache, type CampaignPassDeps } from '../campaign-pass';
import { upsertMission } from '../mission-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'campaign-rerun-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache(project);
  _resetCampaignPassDbCache(project);
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

  it('re-executes every not-run probe on the next campaign pass', async () => {
    // Create a campaign with two probes in src/services and one in src/mcp.
    const campaign = createCampaign(project, {
      title: 'test-campaign',
      probes: [
        { kind: 'command', environment: 'worktree', declaredPaths: ['src/services'], command: 'test1' },
        { kind: 'command', environment: 'worktree', declaredPaths: ['src/services'], command: 'test2' },
        { kind: 'command', environment: 'worktree', declaredPaths: ['src/mcp'], command: 'test3' },
      ],
    });

    const probes = listProbes(project, campaign.id);
    const p1 = probes[0];
    const p2 = probes[1];
    const p3 = probes[2];

    // Record 'pass' on all three probes initially.
    recordProbeVerdict(project, {
      probeId: p1.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p2.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: null,
    });
    recordProbeVerdict(project, {
      probeId: p3.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: null,
    });

    // Reset the two src/services probes to 'not-run'.
    await resetProbesForLand(project, campaign.id, ['src/services/campaign-pass.ts']);
    const afterReset = listProbes(project, campaign.id);
    expect(afterReset.find((p) => p.id === p1.id)?.verdict).toBe('not-run');
    expect(afterReset.find((p) => p.id === p2.id)?.verdict).toBe('not-run');
    expect(afterReset.find((p) => p.id === p3.id)?.verdict).toBe('pass');

    // Track execProbe calls.
    let execProbeCallCount = 0;
    const execProbeIds: string[] = [];
    const mockExecProbe = async (probe: any) => {
      execProbeCallCount++;
      execProbeIds.push(probe.id);
      return { verdict: 'fail' as const, evidence: 'stub failure' };
    };

    // Create a mission stub for forge.
    const mockForgeMission = async (proj: string, input: any) => {
      const missionTodo = await createTodo(proj, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      upsertMission(proj, missionTodo.id);
      return { missionId: missionTodo.id } as any;
    };

    const deps: CampaignPassDeps = {
      execProbe: mockExecProbe,
      commitSha: () => 'sha-test',
      forgeMission: mockForgeMission,
    };

    // Run the campaign pass.
    const result = await runCampaignPass(project, campaign.id, 's1', deps);

    // Assert execProbe was called exactly twice (for p1 and p2).
    expect(execProbeCallCount).toBe(2);
    expect(execProbeIds.sort()).toEqual([p1.id, p2.id].sort());

    // Assert result.executed contains exactly p1 and p2.
    expect(result.executed.sort()).toEqual([p1.id, p2.id].sort());

    // Assert the probes are now recorded as 'fail' (since mock returned fail).
    const afterPass = listProbes(project, campaign.id);
    expect(afterPass.find((p) => p.id === p1.id)?.verdict).toBe('fail');
    expect(afterPass.find((p) => p.id === p2.id)?.verdict).toBe('fail');
    expect(afterPass.find((p) => p.id === p3.id)?.verdict).toBe('pass');
  });

  it('leaves a probe unchanged when execProbe throws', async () => {
    // Create a campaign with one probe.
    const campaign = createCampaign(project, { title: 'test-campaign' });
    const probe = addProbe(project, campaign.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'test1',
    });

    // Record 'pass' initially.
    recordProbeVerdict(project, {
      probeId: probe.id,
      verdict: 'pass',
      environment: 'worktree',
      commitSha: 'abc123',
      evidence: null,
    });

    // Reset to 'not-run'.
    const probesAfterReset = listProbes(project, campaign.id);
    expect(probesAfterReset[0].verdict).toBe('pass');

    // Use the public resetProbeVerdict if needed, or directly via recordProbeVerdict:
    // For now, let's use a simpler approach: create a new campaign with a not-run probe.
    const campaign2 = createCampaign(project, { title: 'test-campaign-2' });
    const probe2 = addProbe(project, campaign2.id, {
      kind: 'command',
      environment: 'worktree',
      command: 'test1',
    });

    // Don't record any verdict, so it stays 'not-run'.
    const probesBeforePass = listProbes(project, campaign2.id);
    expect(probesBeforePass[0].verdict).toBe('not-run');

    // Mock execProbe to throw.
    const mockExecProbe = async (probe: any) => {
      throw new Error('execution failed');
    };

    // Mock forge to avoid errors.
    const mockForgeMission = async (proj: string, input: any) => {
      const missionTodo = await createTodo(proj, {
        allowOrphan: true,
        ownerSession: 's1',
        title: input.title,
        kind: 'mission',
      });
      upsertMission(proj, missionTodo.id);
      return { missionId: missionTodo.id } as any;
    };

    const deps: CampaignPassDeps = {
      execProbe: mockExecProbe,
      commitSha: () => 'sha-test',
      forgeMission: mockForgeMission,
    };

    // Run the campaign pass.
    const result = await runCampaignPass(project, campaign2.id, 's1', deps);

    // Assert result.executed is empty (the thrown error was caught).
    expect(result.executed).toEqual([]);

    // Assert the probe is still 'not-run'.
    const probesAfterPass = listProbes(project, campaign2.id);
    expect(probesAfterPass[0].verdict).toBe('not-run');
  });
});
