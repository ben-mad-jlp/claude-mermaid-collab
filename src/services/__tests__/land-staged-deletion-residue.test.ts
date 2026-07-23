/**
 * Reproduction of the staged-index residue holes in the post-land main-checkout sync gate at
 * `src/agent/worktree-manager.ts:2189-2204`.
 *
 * The gate's original dirtiness probe was a commit↔working-tree diff, blind to index-only state:
 *
 * - Scenario A (the silent-loss defect): a staged edit whose worktree copy matches HEAD ("MM" in
 *   `status --porcelain -uno`) did not appear in the probe, so `git reset --hard <masterSha>`
 *   destroyed the staged blob — and `withMainCheckoutInvariant` raised nothing, because it only
 *   diffs residue that was ADDED, never residue that DISAPPEARS.
 * - Scenario B (escalation 86c252f8's shape): `git rm --cached` / `git rm` residue IS visible to the
 *   worktree probe, so the sync was already skipped. This locks that arm in.
 *
 * In both shapes the land itself is fine — `update-ref` has already advanced the base ref. What must
 * hold is that the main checkout is never silently discarded: either the operation is LOUD
 * (MainCheckoutResidueError naming the residue) or the checkout is byte-identical to its pre-land
 * state. Real git, real WorktreeManager.landEpicToMaster — no mocks of the code under test.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (worktree-manager pulls in the
// main-checkout escalation adapter). Mirrors land-main-checkout-isolation.test.ts:14-15.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-staged-residue-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import {
  MainCheckoutResidueError,
  type MainCheckoutBranchChangedError,
} from '../main-checkout-invariant';

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

/** The three probes that define "the main checkout was not touched". */
interface CheckoutProbes {
  head: string;
  status: string;
  staged: string;
}

async function probeCheckout(repo: string): Promise<CheckoutProbes> {
  const [head, status, staged] = await Promise.all([
    runGit(repo, ['symbolic-ref', '--short', 'HEAD']),
    runGit(repo, ['status', '--porcelain', '--untracked-files=no']),
    runGit(repo, ['diff', '--cached', '--name-status']),
  ]);
  return { head: head.stdout, status: status.stdout, staged: staged.stdout };
}

/** The land is acceptable iff it was LOUD about the residue, OR the checkout is byte-identical
 *  to its pre-land state. Silently resetting over staged work satisfies NEITHER. */
async function expectLoudOrByteIdentical(
  repo: string,
  before: CheckoutProbes,
  err: unknown,
): Promise<void> {
  const loud =
    err instanceof MainCheckoutResidueError &&
    err.opName === 'land_epic' &&
    err.addedResidue.some((r) => r.includes('datum_planes/'));
  if (loud) return;

  const after = await probeCheckout(repo);
  expect(after.head).toBe(before.head);
  expect(after.status).toBe(before.status);
  expect(after.staged).toBe(before.staged);
}

const EPIC = 'epic-staged-residue';

describe('land — staged-index residue in the post-land main-checkout sync', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;
  let violations: Array<MainCheckoutResidueError | MainCheckoutBranchChangedError>;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'staged-residue-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    mkdirSync(join(repo, 'datum_planes'), { recursive: true });
    writeFileSync(join(repo, 'datum_planes', 'a.py'), 'a = 1\n');
    writeFileSync(join(repo, 'datum_planes', 'b.py'), 'b = 2\n');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = mkdtempSync(join(tmpdir(), 'staged-residue-persist-'));
    violations = [];
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(persistDir, 'worktrees'),
      persistDir,
      // Spy: keeps the default escalation sink (which opens the supervisor DB) out of the test.
      onMainCheckoutViolation: (err) => { violations.push(err); },
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(persistDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Real epic branch + worktree carrying a modification and an addition under datum_planes/. */
  async function buildEpic(): Promise<void> {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'datum_planes', 'a.py'), 'a = 1  # epic\n');
    writeFileSync(join(epic.path, 'datum_planes', 'c.py'), 'c = 3\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: datum_planes work']);
  }

  it('Scenario A — index-only staged edit (MM) is not silently reset away by the post-land sync', async () => {
    await buildEpic();

    // Stage a real edit, then restore the HEAD content on disk. `status --porcelain -uno` now
    // reports "MM": the index differs from HEAD but the working tree matches it — invisible to a
    // commit↔working-tree diff.
    writeFileSync(join(repo, 'datum_planes', 'a.py'), 'edited\n');
    await runGit(repo, ['add', 'datum_planes/a.py']);
    writeFileSync(join(repo, 'datum_planes', 'a.py'), 'a = 1\n');
    const preStatus = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    expect(preStatus).toContain('MM datum_planes/a.py');
    // The blindness itself: the commit↔working-tree probe the sync gate used sees NOTHING here.
    expect((await runGit(repo, ['diff', '--name-only', 'HEAD'])).stdout.trim()).toBe('');

    const before = await probeCheckout(repo);

    let caught: unknown = null;
    try {
      await mgr.landEpicToMaster(EPIC);
    } catch (err) {
      caught = err;
    }

    await expectLoudOrByteIdentical(repo, before, caught);

    // The staged blob itself survived — this is the work that was being destroyed.
    const showStaged = await runGit(repo, ['show', ':datum_planes/a.py']);
    expect(showStaged.code).toBe(0);
    expect(showStaged.stdout).toBe('edited\n');
    expect((await runGit(repo, ['diff', '--cached', '--name-status'])).stdout)
      .toContain('M\tdatum_planes/a.py');
  });

  it('Scenario B — escalation 86c252f8 staged-deletion shape stays loud and discards nothing', async () => {
    await buildEpic();

    // The recorded shape: an index-only removal plus a full removal, neither committed.
    await runGit(repo, ['rm', '--cached', '-q', 'datum_planes/a.py']);
    await runGit(repo, ['rm', '-q', 'datum_planes/b.py']);

    const before = await probeCheckout(repo);

    let caught: unknown = null;
    try {
      await mgr.landEpicToMaster(EPIC);
    } catch (err) {
      caught = err;
    }

    await expectLoudOrByteIdentical(repo, before, caught);
    expect(violations.length).toBe(1);
    expect(violations[0]!.name).toBe('MainCheckoutResidueError');

    // Nothing was discarded: both staged deletions are still in the index.
    const staged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    expect(staged).toContain('D\tdatum_planes/a.py');
    expect(staged).toContain('D\tdatum_planes/b.py');

    // And the checkout is still on master.
    expect((await runGit(repo, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim()).toBe('master');
    // base.txt was never touched.
    expect(readFileSync(join(repo, 'base.txt'), 'utf8')).toBe('base\n');
  });
});
