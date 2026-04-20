/**
 * Thin Bun.spawn wrappers around git commands for checkpoint/revert flows.
 */

export interface GitOps {
  /**
   * Create a stash commit object via `git stash create`.
   * Returns the SHA of the stash commit, or empty string if there are no changes.
   * The `message` parameter is informational only (logged) — `git stash create`
   * does not record a message on its own. To persist, caller can pair with
   * `git stash store -m <msg> <sha>`.
   */
  stashCreate(cwd: string, message: string): Promise<string>;
  /** `git reset --hard <ref>` (default HEAD). */
  resetHard(cwd: string, ref?: string): Promise<void>;
  /** `git checkout <sha> -- .` — restore worktree contents from a commit/stash SHA. */
  checkoutAll(cwd: string, sha: string): Promise<void>;
  /**
   * `git clean -fd` — delete untracked files and directories inside the given
   * worktree. Scoped to `cwd` (i.e. the per-session worktree); NOT run globally
   * across the project. Respects `.gitignore` (no `-x`).
   */
  cleanUntracked(cwd: string): Promise<void>;
  /** `git rev-parse --is-inside-work-tree` — true if cwd is inside a git working tree. */
  isGitRepo(cwd: string): Promise<boolean>;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGit(cwd: string, args: string[]): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ['git', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function runGitOrThrow(cwd: string, args: string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await runGit(cwd, args);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

export function createGitOps(): GitOps {
  return {
    async stashCreate(cwd: string, message: string): Promise<string> {
      // message param is informational-only for `git stash create`.
      void message;
      const stdout = await runGitOrThrow(cwd, ['stash', 'create']);
      const trimmed = stdout.trim();
      // Coerce empty stdout ("no local changes") to the 'HEAD' sentinel so
      // downstream sentinel checks for "no-op restore" match uniformly
      // regardless of git version output quirks (see review I5).
      return trimmed === '' ? 'HEAD' : trimmed;
    },

    async resetHard(cwd: string, ref: string = 'HEAD'): Promise<void> {
      await runGitOrThrow(cwd, ['reset', '--hard', ref]);
    },

    async checkoutAll(cwd: string, sha: string): Promise<void> {
      await runGitOrThrow(cwd, ['checkout', sha, '--', '.']);
    },

    async cleanUntracked(cwd: string): Promise<void> {
      // Scoped to the provided cwd (per-session worktree). `-f` force, `-d`
      // include directories. No `-x`, so gitignored files are preserved.
      await runGitOrThrow(cwd, ['clean', '-fd']);
    },

    async isGitRepo(cwd: string): Promise<boolean> {
      const { exitCode, stdout } = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      return exitCode === 0 && stdout.trim() === 'true';
    },
  };
}
