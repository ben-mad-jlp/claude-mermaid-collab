import { describe, it, beforeAll, afterAll, expect } from 'bun:test';
import { mkdtempSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isTransientProjectPath } from '../project-registry';

describe('isTransientProjectPath', () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    // Save the current value of MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG
    savedEnv = process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    // Delete it so the function operates in the widened mode
    delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
  });

  afterAll(() => {
    // Restore the saved value (or delete it again if it was originally unset)
    if (savedEnv === undefined) {
      delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    } else {
      process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = savedEnv;
    }
  });

  describe('widened behavior (hatch unset)', () => {
    it('returns true for /tmp/junk-proj, an mkdtemp path, and its realpath form', () => {
      expect(isTransientProjectPath('/tmp/junk-proj')).toBe(true);

      const mkdtempPath = mkdtempSync(join(tmpdir(), 'mc-test-'));
      expect(isTransientProjectPath(mkdtempPath)).toBe(true);

      const realPath = realpathSync(mkdtempPath);
      expect(isTransientProjectPath(realPath)).toBe(true);
    });

    it('returns false for a real project path and for /home/u/tmpfoo', () => {
      expect(isTransientProjectPath('/Users/x/Code/real-repo')).toBe(false);
      expect(isTransientProjectPath('/home/u/tmpfoo')).toBe(false);
    });

    it('returns true for .collab/agent-sessions worktree paths', () => {
      expect(isTransientProjectPath('/repo/.collab/agent-sessions/worktrees/lane-1')).toBe(true);
    });
  });

  describe('with the hatch set to 1, only the .collab/agent-sessions path reads true', () => {
    it('restricts transient check to worktree paths only', () => {
      // Set the hatch to narrow the behavior
      process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

      // /tmp paths should now return false (hatch restricts to worktree only)
      expect(isTransientProjectPath('/tmp/junk-proj')).toBe(false);

      const mkdtempPath = mkdtempSync(join(tmpdir(), 'mc-test-'));
      expect(isTransientProjectPath(mkdtempPath)).toBe(false);

      // But worktree paths should still return true
      expect(isTransientProjectPath('/repo/.collab/agent-sessions/worktrees/lane-1')).toBe(true);

      // Restore for other tests in this file
      delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
    });
  });
});
