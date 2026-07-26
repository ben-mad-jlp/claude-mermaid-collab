/**
 * Mutation probe for the post-land tree/index restore sync block (worktree-manager.ts:2196-2237).
 * Verifies that neutering the restore via injectable spawn wrapper reveals the corruption
 * it prevents: (A) stranded staged deletions when reset --hard is neutered, and
 * (B) silently discarded index-only work when the staged probe is neutered.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-restore-probe-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import {
  runGit,
  EXISTING_TEST_FILE,
  initCycleRepo,
  makeManager,
  buildEpicTouchingExistingTestFile,
  probeMainCheckout,
  assertCleanMainCheckout,
} from './fixtures/main-checkout-cycle-harness';
import { withMainCheckoutInvariant, MainCheckoutResidueError } from '../main-checkout-invariant';

const EPIC = 'epic-restore-probe';

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('post-land tree/index restore — mutation probe', () => {
  let repo: string;
  let persistDir: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'restore-probe-repo-'));
    persistDir = mkdtempSync(join(tmpdir(), 'restore-probe-persist-'));
    await initCycleRepo(repo, 'master');
  });

  afterEach(() => {
    for (const dir of [repo, persistDir]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('neutered reset --hard strands staged deletion and triggers MainCheckoutResidueError via invariant wrapper', async () => {
    // Setup per blueprint: remove file from master, then create (not modify) it on epic branch.
    // After land with neutered reset, index shows D<EXISTING_TEST_FILE>.
    await runGit(repo, ['rm', '-q', EXISTING_TEST_FILE]);
    await runGit(repo, ['commit', '-q', '-m', 'remove test file from master']);
    const beforeProbe = await probeMainCheckout(repo);
    expect(beforeProbe.porcelain.trim()).toBe('');

    // Create manager with reset --hard neutered.
    // spawnFn is called as spawnFn(['git', '-C', cwd, ...args], {cwd, ...})
    const resetNeuteredSpawn = (cmd: string[], opts: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      const isResetHard =
        args.length > 3 &&
        args[0] === 'git' &&
        args[1] === '-C' &&
        args[3] === 'reset' &&
        args.includes('--hard') &&
        opts.cwd === repo;

      if (isResetHard) {
        return {
          stdout: null,
          stderr: null,
          exited: Promise.resolve(0),
          kill() {},
        };
      }

      return (globalThis as any).Bun.spawn(cmd, opts);
    };

    const { mgr, violations } = await makeManager(repo, persistDir, { spawn: resetNeuteredSpawn });

    // Build epic by creating the file (not modifying; it doesn't exist in master).
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');

    const fs = await import('node:fs');
    const testFilePath = join(epic.path, EXISTING_TEST_FILE);
    const fileContent = 'export const test = () => true;\n';
    fs.mkdirSync(join(epic.path, 'src', 'services', '__tests__'), { recursive: true });
    fs.writeFileSync(testFilePath, fileContent);
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: recreate test file']);

    // Forward-integrate.
    await mgr.forwardIntegrateEpic(EPIC, 'master');

    // Verify clean state before land.
    const beforeLandProbe = await probeMainCheckout(repo);
    expect(beforeLandProbe.porcelain.trim()).toBe('');

    // Land wrapped with withMainCheckoutInvariant. The inner .catch swallows the manager's own throw
    // so the OUTER wrapper is what is graded.
    const landErr = await withMainCheckoutInvariant(
      repo,
      runGit,
      async () => {
        try {
          return await mgr.landEpicToMaster(EPIC, { baseRef: 'master' });
        } catch {
          return undefined;
        }
      },
      { opName: 'land_epic' },
    ).catch((err: any) => err);

    // The invariant wrapper should reject with MainCheckoutResidueError.
    expect(landErr).toBeInstanceOf(MainCheckoutResidueError);
    expect((landErr as MainCheckoutResidueError).addedResidue.some(r => r.includes(EXISTING_TEST_FILE))).toBe(true);
    expect((landErr as MainCheckoutResidueError).message).toContain(EXISTING_TEST_FILE);

    // Probing the neutered state should reveal staged deletion.
    const afterProbe = await probeMainCheckout(repo);
    const stagedLines = afterProbe.stagedNameStatus
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const deletedLines = stagedLines.filter((l) => l.split('\t')[0]!.startsWith('D'));
    expect(deletedLines.some((l) => l.includes(EXISTING_TEST_FILE))).toBe(true);

    // Invert the assertion from the e2e: assertCleanMainCheckout should reject.
    await expect(assertCleanMainCheckout(afterProbe)).rejects.toThrow(EXISTING_TEST_FILE);
  });

  it('neutered diff --cached --name-only silently discards index-only work while intact arm catches it', async () => {
    // NEUTERED ARM: diff --cached is neutered.
    // spawnFn is called as spawnFn(['git', '-C', cwd, ...args], {cwd, ...})
    const diffNeuteredSpawn = (cmd: string[], opts: any) => {
      const args = Array.isArray(cmd) ? cmd : [];
      const isDiffCached =
        args.length > 3 &&
        args[0] === 'git' &&
        args[1] === '-C' &&
        args[3] === 'diff' &&
        args.includes('--cached') &&
        args.includes('--name-only') &&
        opts.cwd === repo;

      if (isDiffCached) {
        return {
          stdout: null,
          stderr: null,
          exited: Promise.resolve(0),
          kill() {},
        };
      }

      return (globalThis as any).Bun.spawn(cmd, opts);
    };

    const { mgr: neuteredMgr } = await makeManager(repo, persistDir, { spawn: diffNeuteredSpawn });

    // Build epic that modifies the file first (on the epic branch, doesn't affect main checkout).
    const { editedContent } = await buildEpicTouchingExistingTestFile(neuteredMgr, EPIC, 'master');
    await neuteredMgr.forwardIntegrateEpic(EPIC, 'master');

    // Pre-land setup: stage an index-only edit to EXISTING_TEST_FILE.
    // Get current content, modify it, add to index, then restore working tree.
    const testFilePath = join(repo, EXISTING_TEST_FILE);
    const currentContent = readFileSync(testFilePath, 'utf8');
    const stagedContent = currentContent + '// staged comment\n';

    // Write and stage the modification
    writeFileSync(testFilePath, stagedContent);
    await runGit(repo, ['add', EXISTING_TEST_FILE]);

    // Restore working tree to HEAD content. Use git show + write to avoid
    // `git checkout` which resets the index.
    const headContent = (await runGit(repo, ['show', `HEAD:${EXISTING_TEST_FILE}`, '--no-filter'])).stdout;
    writeFileSync(testFilePath, headContent);

    // Verify: both staged and unstaged show M (index differs from HEAD,
    // working tree differs from index, but working tree matches HEAD for the union probe).
    const preLandProbe = await probeMainCheckout(repo);
    expect(preLandProbe.stagedNameStatus.trim()).toContain('M');
    expect(preLandProbe.unstagedNameStatus.trim()).toContain('M');

    // NEUTERED ARM: land with diff --cached neutered.
    // Since the working tree is clean and diff --cached is neutered (returns empty),
    // the union probe finds no residue, so reset --hard is called and succeeds.
    // The staged modification is silently destroyed.
    const neuteredLandResult = await neuteredMgr.landEpicToMaster(EPIC, { baseRef: 'master' });

    expect(neuteredLandResult.landed).toBe(true);
    expect(neuteredLandResult.treeSynced).toBe('reset-hard');

    // Verify staged work was silently destroyed.
    const afterNeuteredProbe = await probeMainCheckout(repo);
    expect(afterNeuteredProbe.stagedNameStatus.trim()).toBe('');

    // INTACT CONTROL ARM: same setup, no spawn wrapper, should detect and reject.
    rmSync(repo, { recursive: true, force: true });
    rmSync(persistDir, { recursive: true, force: true });
    repo = mkdtempSync(join(tmpdir(), 'restore-probe-case-b-intact-'));
    persistDir = mkdtempSync(join(tmpdir(), 'restore-probe-case-b-intact-persist-'));
    await initCycleRepo(repo, 'master');

    const { mgr: intactCtlMgr, violations: intactCtlViolations } = await makeManager(repo, persistDir);

    // Build epic that modifies the file first.
    const { editedContent: __ } = await buildEpicTouchingExistingTestFile(intactCtlMgr, EPIC, 'master');
    await intactCtlMgr.forwardIntegrateEpic(EPIC, 'master');

    // Recreate state with the new repo path.
    const intactTestFilePath = join(repo, EXISTING_TEST_FILE);
    const intactCurrentContent = readFileSync(intactTestFilePath, 'utf8');
    const intactStagedContent = intactCurrentContent + '// staged comment\n';

    // Write, stage, and restore working tree (without resetting index).
    writeFileSync(intactTestFilePath, intactStagedContent);
    await runGit(repo, ['add', EXISTING_TEST_FILE]);
    const intactHeadContent = (await runGit(repo, ['show', `HEAD:${EXISTING_TEST_FILE}`, '--no-filter'])).stdout;
    writeFileSync(intactTestFilePath, intactHeadContent);

    const intactPreProbe = await probeMainCheckout(repo);
    expect(intactPreProbe.stagedNameStatus.trim()).toContain('M');
    expect(intactPreProbe.unstagedNameStatus.trim()).toContain('M');

    const intactLandResult = await intactCtlMgr.landEpicToMaster(EPIC, {
      baseRef: 'master',
    }).catch((err: any) => err);

    // INTACT ARM: MainCheckoutResidueError is thrown because diff --cached detects the staged M.
    expect(intactLandResult).toBeInstanceOf(MainCheckoutResidueError);
    expect((intactLandResult as MainCheckoutResidueError).addedResidue.some(r => r.includes(EXISTING_TEST_FILE))).toBe(true);

    // Violations should have captured it.
    expect(intactCtlViolations.length).toBeGreaterThan(0);

    // Verify staged work was preserved (not destroyed).
    const afterIntactProbe = await probeMainCheckout(repo);
    expect(afterIntactProbe.stagedNameStatus.trim()).toContain('M');
  });
});
