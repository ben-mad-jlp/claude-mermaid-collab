// The LIVE rig reset path — the four default deps runRigReset uses when nobody injects.
//
// These were `throw new Error('not wired')` stubs in production: every rig probe's reset
// threw, the pass's fail-open catch swallowed it, and a live campaign recorded zero
// verdicts with zero log lines. These tests run the real defaults against a real git
// fixture, so the wiring can never silently regress to a placebo again.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRigReset } from '../campaign-rig-reset.ts';
import { createCampaign, _resetCampaignDbCache } from '../campaign-store.ts';
import { _closeAllCollabDbs } from '../collab-db';

let projectDir: string;
let rigDir: string;
let pinSha = '';
let probeId = '';

function git(...args: string[]): string {
  const p = Bun.spawnSync(['git', '-C', rigDir, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'rig-live-proj-'));
  mkdirSync(join(projectDir, '.collab'), { recursive: true });
  _resetCampaignDbCache();
  _closeAllCollabDbs();

  // A tiny rig: git repo with a bsync-shaped project.json declaring two members,
  // one of which exists on disk. Pin = the first commit.
  rigDir = mkdtempSync(join(tmpdir(), 'rig-live-rig-'));
  Bun.spawnSync(['git', '-C', rigDir, 'init', '-q']);
  git('config', 'user.email', 'rig@test');
  git('config', 'user.name', 'rig');
  mkdirSync(join(rigDir, 'parts'), { recursive: true });
  writeFileSync(join(rigDir, 'parts', 'base.prt'), 'v1');
  writeFileSync(
    join(rigDir, 'project.json'),
    JSON.stringify({
      format: 'bsync_project',
      members: [
        { kind: 'part', label: 'Base', path: 'parts/base.prt' },
        { kind: 'part', label: 'Ghost', path: 'parts/ghost.prt' },
      ],
    }),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'pin');
  pinSha = git('rev-parse', 'HEAD');

  const campaign = createCampaign(projectDir, {
    title: 'rig live wiring',
    probes: [{
      id: undefined,
      kind: 'command',
      environment: 'rig',
      command: 'true',
      rigTargetDir: rigDir,
      rigCommitSha: pinSha,
    }],
  });
  // createCampaign returns only the campaign row; read the probe id back.
  const { listProbes } = require('../campaign-store.ts');
  probeId = listProbes(projectDir, campaign.id)[0].id;
});

afterEach(() => {
  _resetCampaignDbCache();
  _closeAllCollabDbs();
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(rigDir, { recursive: true, force: true });
});

describe('runRigReset live defaults', () => {
  it('restores drift to the pin, removes untracked files, and records honest member counts', async () => {
    // Drift: mutate a tracked file, add an untracked one, move HEAD forward.
    writeFileSync(join(rigDir, 'parts', 'base.prt'), 'DRIFTED');
    writeFileSync(join(rigDir, 'stray.txt'), 'uncommitted');
    git('add', 'parts/base.prt');
    git('commit', '-q', '-m', 'drift');

    const record = await runRigReset(projectDir, probeId, { targetDir: rigDir, commitSha: pinSha });

    // Filesystem is back at the pin: tracked content restored, untracked drift gone.
    expect(readFileSync(join(rigDir, 'parts', 'base.prt'), 'utf8')).toBe('v1');
    expect(existsSync(join(rigDir, 'stray.txt'))).toBe(false);
    expect(git('rev-parse', 'HEAD')).toBe(pinSha);

    // Counts are honest: 2 declared members, 1 present on disk (Ghost is missing).
    expect(record.manifestCount).toBe(2);
    expect(record.openedMemberCount).toBe(1);
    expect(record.commitSha).toBe(pinSha);
  });

  it('throws on an unknown pin commit instead of silently restoring HEAD', async () => {
    await expect(
      runRigReset(projectDir, probeId, { targetDir: rigDir, commitSha: 'deadbeef'.repeat(5) }),
    ).rejects.toThrow(/cat-file|failed/);
  });

  it('throws when the rig has no readable manifest', async () => {
    rmSync(join(rigDir, 'project.json'));
    git('add', '-A');
    git('commit', '-q', '-m', 'drop manifest');
    const noManifestSha = git('rev-parse', 'HEAD');
    await expect(
      runRigReset(projectDir, probeId, { targetDir: rigDir, commitSha: noManifestSha }),
    ).rejects.toThrow(/manifest/);
  });
});
