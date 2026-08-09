import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  readMainCheckoutHead,
  withMainCheckoutInvariant,
  MainCheckoutResidueError,
  type GitRunner,
} from '../../services/main-checkout-invariant';
import { quarantineAndRestoreMainCheckout } from '../../services/worktree-write-leak';

/** Real git runner using execFileSync. */
const realGitRunner: GitRunner = async (cwd: string, args: string[]) => {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err: any) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
};

describe('worktree epic provision (no-leak)', () => {
  let fixtureRoot: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync('worktree-epic-provision-');
    fixtureRoot = mkdtempSync(join(tempDir, 'repo-'));
    // Initialize a git repo with one file and a commit
    execFileSync('git', ['init'], { cwd: fixtureRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fixtureRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: fixtureRoot, stdio: 'ignore' });
    writeFileSync(join(fixtureRoot, 'initial.txt'), 'initial content\n', 'utf8');
    execFileSync('git', ['add', 'initial.txt'], { cwd: fixtureRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: fixtureRoot, stdio: 'ignore' });
  });

  afterEach(() => {
    if (existsSync(fixtureRoot)) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('clean-repo passthrough leaves porcelain identical before and after', async () => {
    // Capture baseline porcelain
    const before = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const beforePortrayal = before.residue.join('\n');

    // Call withMainCheckoutInvariant with a no-op fn
    const result = await withMainCheckoutInvariant(
      fixtureRoot,
      realGitRunner,
      async () => 'success',
      {
        opName: 'test_clean_repo',
        quarantineDir: join(tempDir, 'quarantine-1'),
      },
    );

    // Verify it succeeded
    expect(result).toBe('success');

    // Capture post-call porcelain
    const after = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const afterPortrayal = after.residue.join('\n');

    // Both should be identical (clean)
    expect(beforePortrayal).toBe(afterPortrayal);
    expect(beforePortrayal).toBe('');
  });

  test('write-leak fixture is quarantined and the main checkout is restored to identical porcelain', async () => {
    const quarantineDir = join(tempDir, 'quarantine-2');

    // Capture baseline porcelain
    const before = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const beforePortrayal = before.residue.join('\n');

    // Call withMainCheckoutInvariant with a fn that modifies a tracked file and creates an untracked file
    let error: MainCheckoutResidueError | undefined;
    try {
      await withMainCheckoutInvariant(
        fixtureRoot,
        realGitRunner,
        async () => {
          // Simulate the leaked writes:
          // 1. Modify tracked file
          writeFileSync(join(fixtureRoot, 'initial.txt'), 'modified content\n', 'utf8');
          // 2. Create untracked file
          writeFileSync(join(fixtureRoot, 'new-untracked.txt'), 'untracked content\n', 'utf8');
          return 'fn-completed';
        },
        {
          opName: 'test_write_leak',
          quarantineDir,
        },
      );
    } catch (err) {
      error = err as MainCheckoutResidueError;
    }

    // Must have thrown
    expect(error).toBeDefined();
    expect(error!.name).toBe('MainCheckoutResidueError');

    // Error message should contain the quarantine dir
    expect(error!.message).toContain(quarantineDir);

    // (ii) Post-call porcelain should be identical to pre-call (restored)
    const after = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const afterPortrayal = after.residue.join('\n');
    expect(afterPortrayal).toBe(beforePortrayal);
    expect(afterPortrayal).toBe(''); // Should be clean again

    // (iii) Both leaked files' original content should be recoverable in quarantine
    const modifiedContent = readFileSync(join(quarantineDir, 'initial.txt'), 'utf8');
    expect(modifiedContent).toBe('modified content\n');

    const untrackedContent = readFileSync(join(quarantineDir, 'new-untracked.txt'), 'utf8');
    expect(untrackedContent).toBe('untracked content\n');

    // The files in the main checkout should be restored: initial.txt back to original, new-untracked.txt gone
    const restoredInitial = readFileSync(join(fixtureRoot, 'initial.txt'), 'utf8');
    expect(restoredInitial).toBe('initial content\n');
    expect(existsSync(join(fixtureRoot, 'new-untracked.txt'))).toBe(false);
  });

  test('without a quarantineDir the same write-leak fixture leaves porcelain changed (mutation proof)', async () => {
    // Capture baseline porcelain
    const before = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const beforePortrayal = before.residue.join('\n');
    expect(beforePortrayal).toBe(''); // Start clean

    // Call withMainCheckoutInvariant with NO quarantineDir and the same write-leak fn
    let error: MainCheckoutResidueError | undefined;
    try {
      await withMainCheckoutInvariant(
        fixtureRoot,
        realGitRunner,
        async () => {
          // Same leaked writes as previous test
          writeFileSync(join(fixtureRoot, 'initial.txt'), 'modified content\n', 'utf8');
          writeFileSync(join(fixtureRoot, 'new-untracked.txt'), 'untracked content\n', 'utf8');
          return 'fn-completed';
        },
        {
          opName: 'test_no_quarantine',
          // NO quarantineDir this time
        },
      );
    } catch (err) {
      error = err as MainCheckoutResidueError;
    }

    // Must have thrown
    expect(error).toBeDefined();

    // Post-call porcelain should NOW DIFFER (NOT restored)
    const after = await readMainCheckoutHead(fixtureRoot, realGitRunner);
    const afterPortrayal = after.residue.join('\n');

    // Should be different (still contains the leaked residue)
    expect(afterPortrayal).not.toBe(beforePortrayal);
    // And should not be empty (residue present)
    expect(afterPortrayal.length).toBeGreaterThan(0);

    // The leaked files should still be in the main checkout
    expect(readFileSync(join(fixtureRoot, 'initial.txt'), 'utf8')).toBe('modified content\n');
    expect(readFileSync(join(fixtureRoot, 'new-untracked.txt'), 'utf8')).toBe('untracked content\n');
  });
});
