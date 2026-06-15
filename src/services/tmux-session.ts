/**
 * Self-healing for tmux sessions whose working directory drifted from the
 * project. A tmux session created before the `-c <project>` fix (or by an older
 * build) starts in whatever cwd the server happened to have — e.g. the desktop
 * app's read-only Resources dir. Because session creation is guarded by
 * `has-session`, that wrong-dir session is reused forever and `claude`/`git`
 * keep running against the wrong folder. This kills such a session so the next
 * `new-session -c <project>` recreates it in the right place.
 */
import { isTmuxAvailable } from './tmux-availability.ts';
import { mux } from './session-mux/index.ts';

async function tmuxOut(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(mux.cmd(['tmux', ...args]), { stdout: 'pipe', stderr: 'ignore' });
  const out = (await new Response(p.stdout).text()).trim();
  return { code: await p.exited, out };
}

/**
 * If `base` exists but was created in a directory other than `cwd`, kill it and
 * return true (a later has-session/new-session recreates it correctly). No-op
 * (returns false) when the session is absent, already in `cwd`, or tmux is
 * unavailable.
 *
 * Uses `pane_start_path` — the directory the session's first pane was created in
 * — which tmux fixes at creation and does NOT update when the user `cd`s. That
 * makes it safe: navigating inside a session never triggers a (destructive)
 * recreate; only a genuine creation-dir mismatch does.
 *
 * EXCEPTION — worker isolation: when `MERMAID_WORKER_ISOLATION` is on, a worker
 * legitimately runs in a git worktree at `<cwd>/.collab/agent-sessions/worktrees/
 * <lane>`, so its `pane_start_path` is SUPPOSED to differ from the project root.
 * Treating that as stale was killing the live worker on every click-to-view and
 * respawning a bare shell at the root (correct tmux name, empty console). We
 * therefore spare any session whose start path is under the project's own
 * worktree dir — the heal still reaps sessions parked somewhere genuinely wrong
 * (e.g. the desktop app's Resources dir), which is its only real purpose.
 */
export async function healStaleTmuxSession(base: string, cwd: string): Promise<boolean> {
  if (!(await isTmuxAvailable())) return false;
  if ((await tmuxOut(['has-session', '-t', base])).code !== 0) return false;
  const start = (await tmuxOut(['display-message', '-p', '-t', base, '#{pane_start_path}'])).out;
  const worktreeRoot = `${cwd}/.collab/agent-sessions/worktrees/`;
  if (start && start !== cwd && !start.startsWith(worktreeRoot)) {
    await tmuxOut(['kill-session', '-t', base]);
    return true;
  }
  return false;
}
