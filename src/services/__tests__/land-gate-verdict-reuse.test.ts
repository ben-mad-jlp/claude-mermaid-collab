import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { landReadiness } from '../land-authority';
import { recordLandCycle } from '../epic-land-record-store';
import { getEpicLandRecord } from '../epic-land-record-store';
import { resolveMergedTreeSha } from '../merged-tree-sha';

describe('land-gate-verdict-reuse', () => {
  let tempDir: string;
  let repoPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(process.env.TMPDIR || '/tmp', 'land-gate-verdict-reuse-'));
    repoPath = join(tempDir, 'repo');

    // Initialize git repo with base and epic branches
    execSync(`git init -b master "${repoPath}"`, { stdio: 'ignore' });
    execSync(`git config user.email "test@test.com"`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git config user.name "Test"`, { cwd: repoPath, stdio: 'ignore' });

    // Create base commit
    execSync(`echo "base" > file.txt`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git add file.txt`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git commit -m "base"`, { cwd: repoPath, stdio: 'ignore' });

    // Create epic branch
    execSync(`git checkout -b collab/epic/test1`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`echo "epic" >> file.txt`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git commit -am "epic change"`, { cwd: repoPath, stdio: 'ignore' });

    // Switch back to master
    execSync(`git checkout master`, { cwd: repoPath, stdio: 'ignore' });
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('a land whose merged tree sha matches a recorded green verdict never invokes the gate runner and records verdict-reused provenance', async () => {
    const baseSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    execSync(`git checkout collab/epic/test1`, { cwd: repoPath, stdio: 'ignore' });
    const epicTipSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    execSync(`git checkout master`, { cwd: repoPath, stdio: 'ignore' });

    const treeSha = resolveMergedTreeSha({
      repo: repoPath,
      baseSha,
      epicTipSha,
    });

    expect(treeSha).not.toBeNull();
    if (!treeSha) throw new Error('Failed to resolve merged tree sha');

    let gateCalls = 0;
    const countingGate = async () => {
      gateCalls++;
      return {
        status: 'pass' as const,
        declared: true,
        manifestPath: '',
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: [],
        epicTipSha,
        baseSha,
      };
    };

    const readiness = await landReadiness(repoPath, 'test-epic-id', {
      todos: [],
      snapshot: { baseSha, epicTipSha },
      probes: {
        worktreeCwd: async () => repoPath,
        merge: async () => ({ tscClean: true, mergeClean: true }),
        presence: async () => ({ project: repoPath, epicId: 'test-epic-id', epicBranch: 'collab/epic/test1', blocking: false, findings: [], exemptions: [], duplicateCommits: [], checked: 0 }),
        gate: countingGate,
        greenTreeVerdict: () => ({ key: 'k1', measuredAt: 1_700_000_000_000 }),
      },
    });

    expect(gateCalls).toBe(0);
    expect(readiness.verdictReuse).toBeDefined();
    expect(readiness.verdictReuse?.treeSha).toBe(treeSha);
    expect(readiness.verdictReuse?.verdictKey).toBe('k1');
    expect(readiness.verdictReuse?.measuredAt).toBe(1_700_000_000_000);

    // Verify the recorded land cycle contains the verdict reuse
    const verdictReuseJson = JSON.stringify(readiness.verdictReuse);
    await recordLandCycle(repoPath, {
      epicId: 'test-epic-id',
      epicTipSha,
      landedMergeSha: 'mock-merge-sha',
      source: 'escalation-land',
      gateVerdictReuse: verdictReuseJson,
    });

    const record = getEpicLandRecord(repoPath, 'test-epic-id');
    expect(record?.gateVerdictReuse).toBe(verdictReuseJson);
  });

  it('moving the base by one commit re-invokes the gate runner', async () => {
    execSync(`git checkout master`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`echo "new base" > base2.txt`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git add base2.txt`, { cwd: repoPath, stdio: 'ignore' });
    execSync(`git commit -m "advance base"`, { cwd: repoPath, stdio: 'ignore' });

    const baseSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    execSync(`git checkout collab/epic/test1`, { cwd: repoPath, stdio: 'ignore' });
    const epicTipSha = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
    execSync(`git checkout master`, { cwd: repoPath, stdio: 'ignore' });

    const treeSha = resolveMergedTreeSha({
      repo: repoPath,
      baseSha,
      epicTipSha,
    });

    expect(treeSha).not.toBeNull();
    if (!treeSha) throw new Error('Failed to resolve merged tree sha');

    let gateCalls = 0;
    const countingGate = async () => {
      gateCalls++;
      return {
        status: 'pass' as const,
        declared: true,
        manifestPath: '',
        units: [],
        regressions: [],
        inherited: [],
        incidents: [],
        reasons: [],
        specFiles: [],
        epicTipSha,
        baseSha,
      };
    };

    const readiness = await landReadiness(repoPath, 'test-epic-id-2', {
      todos: [],
      snapshot: { baseSha, epicTipSha },
      probes: {
        worktreeCwd: async () => repoPath,
        merge: async () => ({ tscClean: true, mergeClean: true }),
        presence: async () => ({ project: repoPath, epicId: 'test-epic-id-2', epicBranch: 'collab/epic/test1', blocking: false, findings: [], exemptions: [], duplicateCommits: [], checked: 0 }),
        gate: countingGate,
        greenTreeVerdict: () => null,
      },
    });

    expect(gateCalls).toBe(1);
    expect(readiness.verdictReuse).toBeUndefined();
  });
});
