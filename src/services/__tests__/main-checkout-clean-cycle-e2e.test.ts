/**
 * Clean main checkout end-to-end test: forward-integrate + land of an epic
 * touching an existing test file, with zero residue after landing.
 *
 * Pins the "clean arm" of the post-land sync gate (worktree-manager.ts:2216-2218),
 * where realDirty.length === 0 → git reset --hard masterSha (treeSynced: 'reset-hard').
 * The existing test at main-checkout-drift-cycle.test.ts only pins the pre-dirtied
 * checkout; this test ensures the clean path works end-to-end.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module. Mirrors main-checkout-drift-cycle.test.ts:31-32.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-clean-cycle-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import {
  runGit,
  EXISTING_TEST_FILE,
  initCycleRepo,
  makeManager,
  buildEpicTouchingExistingTestFile,
  probeMainCheckout,
} from './fixtures/main-checkout-cycle-harness';

const EPIC = 'epic-clean-cycle';

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('clean main checkout — forward-integrate + land cycle', () => {
  let repo: string;
  let persistDir: string;
  let mgrState: { mgr: any; violations: any[] };

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'clean-cycle-repo-'));
    persistDir = mkdtempSync(join(tmpdir(), 'clean-cycle-persist-'));
    await initCycleRepo(repo, 'master');
    mgrState = await makeManager(repo, persistDir);
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

  it('clean main checkout survives forward-integrate + land of an epic touching an existing test file', async () => {
    const mgr = mgrState.mgr;
    const violations = mgrState.violations;

    const { editedContent } = await buildEpicTouchingExistingTestFile(mgr, EPIC, 'master');
    const before = await probeMainCheckout(repo);

    await mgr.forwardIntegrateEpic(EPIC, 'master');
    const land = await mgr.landEpicToMaster(EPIC, { baseRef: 'master' });

    expect(land.landed).toBe(true);
    expect(land.treeSynced).toBe('reset-hard');

    const after = await probeMainCheckout(repo);

    // File must exist and contain the modified content
    expect(existsSync(join(repo, EXISTING_TEST_FILE))).toBe(true);
    const onDiskContent = readFileSync(join(repo, EXISTING_TEST_FILE), 'utf8');
    expect(onDiskContent).toBe(editedContent);

    // Main checkout must be clean
    expect(after.porcelain).toBe('');
    expect(after.stagedNameStatus).toBe('');

    // No deleted files in staged
    const stagedLines = after.stagedNameStatus
      .split('\n')
      .filter((line) => line.trim() !== '');
    for (const line of stagedLines) {
      const code = line.split('\t')[0];
      expect(code!.startsWith('D')).toBe(false);
    }

    // Refs and branch match expectations
    expect(after.sha).toBe(land.masterSha);
    expect(after.branch).toBe(before.branch);

    // No violations
    expect(violations.length).toBe(0);
  });
});
