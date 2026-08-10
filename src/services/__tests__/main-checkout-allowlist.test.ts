import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  isSanctionedResidue,
  readMainCheckoutHead,
  withMainCheckoutInvariant,
  type GitRunner,
} from '../main-checkout-invariant';

describe('isSanctionedResidue matcher', () => {
  describe('A. unit tests: porcelain parsing and segment-boundary matching', () => {
    test('git-collapsed dir form: ?? .collab/agent-sessions/worktrees/pool-lane-live/', () => {
      // Git reports untracked dirs with a trailing `/` (porcelain collapse form)
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live/';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live'];
      expect(isSanctionedResidue(line, prefixes)).toBe(true);
    });

    test('file sibling of prefix is NOT sanctioned', () => {
      // The .json file is a sibling of the dir, not under it — different residue type
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live.json';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live'];
      expect(isSanctionedResidue(line, prefixes)).toBe(false);
    });

    test('file under the prefix is sanctioned', () => {
      // A file inside the sanctioned dir is also sanctioned
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live/notes.txt';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live'];
      expect(isSanctionedResidue(line, prefixes)).toBe(true);
    });

    test('shared string prefix without segment boundary is NOT sanctioned', () => {
      // pool-lane-live-extra/ shares a prefix but is a different path
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live-extra/x';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live'];
      expect(isSanctionedResidue(line, prefixes)).toBe(false);
    });

    test('ancestor path is NOT sanctioned (fail closed)', () => {
      // The ancestor dir .../worktrees/ is reported instead of the actual prefix
      const line = '?? .collab/agent-sessions/worktrees/';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live'];
      expect(isSanctionedResidue(line, prefixes)).toBe(false);
    });

    test('empty allowlist is NOT sanctioned', () => {
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live/';
      expect(isSanctionedResidue(line, [])).toBe(false);
    });

    test('empty or whitespace-only line is NOT sanctioned', () => {
      expect(isSanctionedResidue('', [])).toBe(false);
      expect(isSanctionedResidue('   ', [])).toBe(false);
      expect(isSanctionedResidue('\t', [])).toBe(false);
    });

    test('line with no space is NOT sanctioned', () => {
      const line = '??';
      expect(isSanctionedResidue(line, ['anything'])).toBe(false);
    });

    test('prefix with trailing slash is normalized', () => {
      // Prefixes should be normalized the same way paths are
      const line = '?? .collab/agent-sessions/worktrees/pool-lane-live/';
      const prefixes = ['.collab/agent-sessions/worktrees/pool-lane-live/'];
      expect(isSanctionedResidue(line, prefixes)).toBe(true);
    });
  });

  describe('B. integration: allowlist filters residue before quarantine', () => {
    let fixtureRoot: string;
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync('allowlist-test-');
      fixtureRoot = mkdtempSync(join(tempDir, 'repo-'));
      // Initialize a git repo with one file and a commit
      execFileSync('git', ['init'], { cwd: fixtureRoot, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: fixtureRoot,
        stdio: 'ignore',
      });
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

    test('sanctioned residue does NOT trigger throw and quarantineDir is not created', async () => {
      // Real git runner using execFileSync.
      const realGitRunner: GitRunner = async (cwd: string, args: string[]) => {
        try {
          const stdout = execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return { code: 0, stdout, stderr: '' };
        } catch (err: any) {
          return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
        }
      };

      const quarantineDir = join(tempDir, 'quarantine-test');
      const allowedWtDir = join(fixtureRoot, '.worktrees', 'session-1');

      // Call withMainCheckoutInvariant with a fn that creates only the allowlisted residue
      const result = await withMainCheckoutInvariant(
        fixtureRoot,
        realGitRunner,
        async () => {
          // Create a dir that matches the allowed path (exactly as declared)
          execFileSync('mkdir', ['-p', allowedWtDir], { stdio: 'ignore' });
          writeFileSync(join(allowedWtDir, 'test.txt'), 'allowed content\n', 'utf8');
          return 'success';
        },
        {
          opName: 'test_allowlist',
          quarantineDir,
          allowedResidue: ['.worktrees/session-1'],
        },
      );

      // Must not throw
      expect(result).toBe('success');

      // Quarantine dir must NOT be created (proof the allowlist filtered the residue)
      expect(existsSync(quarantineDir)).toBe(false);

      // The residue dir itself should still exist (it was allowed, not quarantined)
      expect(existsSync(allowedWtDir)).toBe(true);
    });
  });
});
