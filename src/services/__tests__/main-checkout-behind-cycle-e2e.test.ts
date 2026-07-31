/**
 * Behind main checkout end-to-end test: forward-integrate + land of an epic
 * whose branch is genuinely behind master (master advanced after the epic
 * branch was cut), with zero residue after landing.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module. Mirrors main-checkout-clean-cycle-e2e.test.ts:16-17.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-behind-cycle-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import {
  runGit,
  EXISTING_TEST_FILE,
  initCycleRepo,
  makeManager,
  buildEpicTouchingExistingTestFile,
  advanceMasterWithCommit,
  probeMainCheckout,
  assertCleanMainCheckout,
} from './fixtures/main-checkout-cycle-harness';

const EPIC = 'epic-behind-cycle';

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('behind main checkout — forward-integrate + land cycle', () => {
  let repo: string;
  let persistDir: string;
  let mgrState: { mgr: any; violations: any[] };

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'behind-cycle-repo-'));
    persistDir = mkdtempSync(join(tmpdir(), 'behind-cycle-persist-'));
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

  it('behind>0 forward-integrate + land leaves the main checkout clean', async () => {
    const mgr = mgrState.mgr;
    const violations = mgrState.violations;

    const { editedContent } = await buildEpicTouchingExistingTestFile(mgr, EPIC, 'master');
    await advanceMasterWithCommit(repo, 'src/trunk-advance.txt', 'trunk advance\n');

    const epicBranch = mgr.epicBranchName(EPIC);
    const behindBefore = await runGit(repo, ['rev-list', '--count', `${epicBranch}..master`]);
    expect(parseInt(behindBefore.stdout.trim(), 10)).toBeGreaterThan(0);

    await mgr.forwardIntegrateEpic(EPIC, 'master');
    const land = await mgr.landEpicToMaster(EPIC, { baseRef: 'master' });

    expect(land.landed).toBe(true);

    const after = await probeMainCheckout(repo);

    // File must exist and contain the modified content
    expect(existsSync(join(repo, EXISTING_TEST_FILE))).toBe(true);
    const onDiskContent = readFileSync(join(repo, EXISTING_TEST_FILE), 'utf8');
    expect(onDiskContent).toBe(editedContent);

    // Trunk-added file must still be present after the land cycle
    expect(existsSync(join(repo, 'src/trunk-advance.txt'))).toBe(true);

    // Main checkout must be clean
    await assertCleanMainCheckout(after);

    // Refs and branch match expectations
    expect(after.sha).toBe(land.masterSha);
    expect(after.branch).toBe('master');

    // No violations
    expect(violations.length).toBe(0);
  });
});
