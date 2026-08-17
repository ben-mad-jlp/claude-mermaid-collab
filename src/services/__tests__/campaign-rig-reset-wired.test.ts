// runRigReset was fully implemented and tested with ZERO production callers, so a probe
// declared `environment: 'rig'` reset nothing and every run silently inherited the previous
// run's drift. The first Koch campaign produced three runs whose apparent progress all lived
// in an unsaved working tree. These tests pin the wiring, not the reset's internals.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCampaignPass, _resetCampaignPassDbCache, type CampaignPassDeps } from '../campaign-pass';
import { createCampaign, listProbes, addProbe, _resetCampaignDbCache } from '../campaign-store';
import { _closeProject } from '../todo-store';
import { _closeAllCollabDbs } from '../collab-db';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'rig-wired-'));
  _resetCampaignDbCache();
  _resetCampaignPassDbCache();
});
afterEach(() => {
  _closeProject(project);
  _resetCampaignDbCache();
  _resetCampaignPassDbCache();
  _closeAllCollabDbs();
  rmSync(project, { recursive: true, force: true });
});

describe('rig reset is wired into the campaign pass', () => {
  it('resets a rig probe to its pinned commit BEFORE the probe measures', async () => {
    const campaign = createCampaign(project, {
      title: 'Rig campaign',
      probes: [{
        kind: 'command', environment: 'rig', command: 'true',
        rigTargetDir: '/tmp/some-rig', rigCommitSha: 'deadbeef',
      }],
    });
    const probe = listProbes(project, campaign.id)[0]!;

    const order: string[] = [];
    const deps: CampaignPassDeps = {
      runRigReset: (async (_p: string, probeId: string, input: any) => {
        order.push(`reset:${probeId}:${input.targetDir}@${input.commitSha}`);
        return {} as any;
      }) as any,
      execProbe: (async () => { order.push('exec'); return { verdict: 'pass' as const, evidence: 'ok' }; }) as any,
      commitSha: () => 'abc123',
    };

    await runCampaignPass(project, campaign.id, 's1', deps);

    expect(order).toEqual([`reset:${probe.id}:/tmp/some-rig@deadbeef`, 'exec']);
  });

  it('does not reset a worktree probe', async () => {
    const campaign = createCampaign(project, {
      title: 'Worktree campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });
    let resets = 0;
    const deps: CampaignPassDeps = {
      runRigReset: (async () => { resets++; return {} as any; }) as any,
      execProbe: (async () => ({ verdict: 'pass' as const, evidence: 'ok' })) as any,
      commitSha: () => 'abc123',
    };
    await runCampaignPass(project, campaign.id, 's1', deps);
    expect(resets).toBe(0);
  });

  it('refuses a rig probe that names no directory or commit, so a rig probe cannot reset nothing', () => {
    const campaign = createCampaign(project, {
      title: 'Guard campaign',
      probes: [{ kind: 'command', environment: 'worktree', command: 'true' }],
    });
    expect(() => addProbe(project, campaign.id, {
      kind: 'command', environment: 'rig', command: 'true',
    })).toThrow(/rigTargetDir/);
    expect(() => addProbe(project, campaign.id, {
      kind: 'command', environment: 'rig', command: 'true', rigTargetDir: '/tmp/x',
    })).toThrow(/rigCommitSha/);
  });
});
