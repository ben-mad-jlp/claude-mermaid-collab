/**
 * Zero-drift regression across a FULL land + forward-integrate cycle:
 * `WorktreeManager.ensureEpic()` → `forwardIntegrateEpic()` → `landEpicToMaster()`
 * (`src/agent/worktree-manager.ts:1347,1471,2042`), run against a scratch repo whose MAIN
 * checkout is pre-dirtied in the INDEX before the cycle starts.
 *
 * The post-land sync gate (`worktree-manager.ts:2189-2236`) takes the 'skipped-dirty' arm
 * and throws MainCheckoutResidueError when the main checkout has real tracked dirt — but
 * `update-ref` has ALREADY advanced the base ref before that throw. So `rev-parse HEAD`
 * legitimately moves and `status --porcelain -uno` legitimately gains one entry per file the
 * land commit changed (their symref resolved to a new sha while index/worktree stayed put).
 * A correct assertion must not treat that ref-advance-driven change as drift: it must (a)
 * preserve every pre-existing staged/unstaged entry byte-for-byte, and (b) attribute every
 * NEW status entry to `git diff --name-only <baselineSha> <postSha>`.
 *
 * Case A pins the same-project cycle (evidence b). Case B pins the cross-project
 * `targetProject` cycle (item 6): a second repo with no `master` ref, exercising
 * `resolveBase()` → `detectBaseBranch()` → `main` (mirrors `getWorktreeManager(child.targetProject
 * ?? project)` at `src/services/coordinator-land.ts:721-723`), and proves the cross-project
 * instance never touches the Case-A repo.
 *
 * Real git, real WorktreeManager — no mocks of the code under test.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (worktree-manager pulls in the
// main-checkout escalation adapter). Mirrors land-staged-deletion-residue.test.ts:26-27.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-drift-cycle-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import {
  MainCheckoutResidueError,
  MainCheckoutBranchChangedError,
} from '../main-checkout-invariant';

type Violation = MainCheckoutResidueError | MainCheckoutBranchChangedError;

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

/** The five probes that define "the main checkout was not touched", plus a snapshot of the
 *  staged blobs' content (keyed by path) so drift-checks can prove the byte content itself
 *  survived, not just that the name-status line is still present. */
interface CheckoutProbes {
  branch: string;
  sha: string;
  status: string;
  staged: string;
  unstaged: string;
  stagedBlobs: Map<string, string>;
}

async function probeCheckout(repo: string): Promise<CheckoutProbes> {
  const [branch, sha, status, staged, unstaged] = await Promise.all([
    runGit(repo, ['symbolic-ref', '--short', 'HEAD']),
    runGit(repo, ['rev-parse', 'HEAD']),
    runGit(repo, ['status', '--porcelain', '--untracked-files=no']),
    runGit(repo, ['diff', '--cached', '--name-status']),
    runGit(repo, ['diff', '--name-status']),
  ]);
  const stagedPaths = [...parseNameStatus(staged.stdout).keys()];
  const stagedBlobs = new Map<string, string>();
  for (const path of stagedPaths) {
    const blob = await runGit(repo, ['show', `:${path}`]);
    if (blob.code === 0) stagedBlobs.set(path, blob.stdout);
  }
  return {
    branch: branch.stdout.trim(),
    sha: sha.stdout.trim(),
    status: status.stdout,
    staged: staged.stdout,
    unstaged: unstaged.stdout,
    stagedBlobs,
  };
}

/** Parse `git diff --name-status` output into a Map<path, statusCode>. */
function parseNameStatus(out: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [code, ...rest] = trimmed.split('\t');
    m.set(rest.join('\t'), code!);
  }
  return m;
}

/** Parse `git status --porcelain` lines into the set of paths reported. */
function statusPaths(out: string): Set<string> {
  const s = new Set<string>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // porcelain format: "XY path" (or "XY orig -> path" for renames) — take the path.
    const path = trimmed.slice(2).trim().split(' -> ').pop()!;
    s.add(path);
  }
  return s;
}

/**
 * Acceptance for a main checkout that went through the cycle: either the operation was LOUD
 * (a MainCheckoutResidueError/MainCheckoutBranchChangedError naming 'land_epic' at this repo),
 * or the post-cycle capture is byte-identical to baseline. In BOTH arms:
 *  - every baseline staged/unstaged entry is still present, with byte-identical staged blobs
 *  - every NEW status entry is attributable to the ref advance (git diff baselineSha..postSha)
 * A silent mutation satisfies neither arm.
 */
async function expectNoMainCheckoutDrift(
  repo: string,
  baseline: CheckoutProbes,
  caught: unknown,
): Promise<void> {
  const loud =
    (caught instanceof MainCheckoutResidueError || caught instanceof MainCheckoutBranchChangedError) &&
    caught.opName === 'land_epic' &&
    caught.projectRoot === repo;

  const after = await probeCheckout(repo);

  // branch identity never changes, loud or not.
  expect(after.branch).toBe(baseline.branch);

  if (!loud) {
    expect(after.sha).toBe(baseline.sha);
    expect(after.status).toBe(baseline.status);
    expect(after.staged).toBe(baseline.staged);
    expect(after.unstaged).toBe(baseline.unstaged);
  }

  // Preservation: every baseline staged/unstaged name-status entry survives, with the
  // staged blob byte-identical to what was staged before the cycle.
  const baselineStaged = parseNameStatus(baseline.staged);
  const afterStaged = parseNameStatus(after.staged);
  for (const [path, code] of baselineStaged) {
    expect(afterStaged.get(path)).toBe(code);
    expect(after.stagedBlobs.get(path)).toBe(baseline.stagedBlobs.get(path));
  }
  const baselineUnstaged = parseNameStatus(baseline.unstaged);
  const afterUnstaged = parseNameStatus(after.unstaged);
  for (const [path, code] of baselineUnstaged) {
    expect(afterUnstaged.get(path)).toBe(code);
  }

  // Attribution: any status entry NEW relative to baseline must be a path touched between
  // the baseline sha and the post-cycle sha — i.e. caused by the ref advance, never by a
  // mutation of the checkout.
  const baselinePaths = statusPaths(baseline.status);
  const afterPaths = statusPaths(after.status);
  const newPaths = [...afterPaths].filter((p) => !baselinePaths.has(p));
  if (newPaths.length > 0) {
    expect(after.sha).not.toBe(baseline.sha);
    const refAdvanceDiff = await runGit(repo, ['diff', '--name-only', baseline.sha, after.sha]);
    const refAdvancePaths = new Set(
      refAdvanceDiff.stdout.split('\n').map((s) => s.trim()).filter(Boolean),
    );
    for (const p of newPaths) {
      expect(refAdvancePaths.has(p)).toBe(true);
    }
  }
}

/** Pre-dirt the main checkout: one staged mod, one staged add, one unstaged mod, one untracked. */
async function preDirty(repo: string): Promise<void> {
  writeFileSync(join(repo, 'staged-mod.txt'), 'staged edit\n');
  await runGit(repo, ['add', 'staged-mod.txt']);
  writeFileSync(join(repo, 'staged-add.txt'), 'new staged file\n');
  await runGit(repo, ['add', 'staged-add.txt']);
  writeFileSync(join(repo, 'unstaged-mod.txt'), 'unstaged edit\n');
  writeFileSync(join(repo, 'untracked.txt'), 'untracked\n');
}

const EPIC = 'epic-drift-cycle';

describe('land + forward-integrate cycle — zero main-checkout drift', () => {
  let repoA: string;
  let persistDirA: string;
  let mgrA: WorktreeManager;
  let violationsA: Violation[];

  let repoB: string;
  let persistDirB: string;
  let mgrB: WorktreeManager;
  let violationsB: Violation[];

  async function initRepo(repo: string, defaultBranch: string): Promise<void> {
    await runGit(repo, ['init', '-q', '-b', defaultBranch]);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'staged-mod.txt'), 'original\n');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'main.txt'), 'main\n');
    writeFileSync(join(repo, 'unstaged-mod.txt'), 'original\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  }

  async function buildEpic(mgr: WorktreeManager, baseRef: string): Promise<void> {
    const epic = await mgr.ensureEpic(EPIC, undefined, baseRef);
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'src', 'main.txt'), 'main # epic\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: work']);
  }

  async function driveCycle(
    mgr: WorktreeManager,
    baseRef: string,
  ): Promise<{ caught: unknown; landResult?: Awaited<ReturnType<WorktreeManager['landEpicToMaster']>> }> {
    await buildEpic(mgr, baseRef);
    await mgr.forwardIntegrateEpic(EPIC, baseRef);
    let caught: unknown = null;
    let landResult: Awaited<ReturnType<WorktreeManager['landEpicToMaster']>> | undefined;
    try {
      landResult = await mgr.landEpicToMaster(EPIC, { baseRef });
    } catch (err) {
      caught = err;
    }
    return { caught, landResult };
  }

  beforeEach(async () => {
    repoA = mkdtempSync(join(tmpdir(), 'drift-cycle-repoA-'));
    persistDirA = mkdtempSync(join(tmpdir(), 'drift-cycle-persistA-'));
    violationsA = [];
    await initRepo(repoA, 'master');
    mgrA = new WorktreeManager({
      projectRoot: repoA,
      baseDir: join(persistDirA, 'worktrees'),
      persistDir: persistDirA,
      onMainCheckoutViolation: (err) => { violationsA.push(err); },
    });

    repoB = mkdtempSync(join(tmpdir(), 'drift-cycle-repoB-'));
    persistDirB = mkdtempSync(join(tmpdir(), 'drift-cycle-persistB-'));
    violationsB = [];
    await initRepo(repoB, 'main');
    mgrB = new WorktreeManager({
      projectRoot: repoB,
      baseDir: join(persistDirB, 'worktrees'),
      persistDir: persistDirB,
      onMainCheckoutViolation: (err) => { violationsB.push(err); },
    });
  });

  afterEach(() => {
    for (const dir of [repoA, persistDirA, repoB, persistDirB]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('Case A — same-project cycle: ensureEpic + forwardIntegrateEpic + landEpicToMaster never drift the main checkout', async () => {
    await preDirty(repoA);
    const baseline = await probeCheckout(repoA);

    const { caught } = await driveCycle(mgrA, 'master');

    await expectNoMainCheckoutDrift(repoA, baseline, caught);

    // ensure/forward-integrate must not have contributed any violation — only land_epic may.
    for (const v of violationsA) {
      expect(v.opName).toBe('land_epic');
    }
  });

  it('Case B — cross-project targetProject cycle (main-trunk, no master ref) never drifts either repo', async () => {
    await preDirty(repoB);
    const baselineB = await probeCheckout(repoB);
    const baselineA = await probeCheckout(repoA);

    // baseRef literal 'master' — repoB has no master ref, so resolveBase() falls through to
    // detectBaseBranch() and resolves 'main' (mirrors coordinator-land.ts:721-723 dispatch).
    const { caught, landResult } = await driveCycle(mgrB, 'master');

    await expectNoMainCheckoutDrift(repoB, baselineB, caught);

    if (!caught) {
      expect(landResult?.baseRef).toBe('main');
    }

    for (const v of violationsB) {
      expect(v.opName).toBe('land_epic');
      expect(v.projectRoot).toBe(repoB);
      expect(v.projectRoot).not.toBe(repoA);
    }

    // The cross-project instance touched only its own root — Case A's repo is unchanged.
    await expectNoMainCheckoutDrift(repoA, baselineA, null);
  });
});
