/**
 * Whether the `tmux` binary is reachable on the current PATH.
 *
 * The collab terminal hosts every session in a tmux session, so when tmux is
 * missing the PTY shell exits immediately and the terminal pane opens dead. This
 * is most common when the desktop app is launched from the GUI/login-items with
 * a minimal PATH that omits Homebrew's `/opt/homebrew/bin` (where tmux lives).
 * Callers use this to fail loudly with a clear message instead of returning a
 * fake-success terminal.
 *
 * Cached after the first successful probe — tmux doesn't get uninstalled mid-run,
 * and a negative result is left uncached so a PATH fix (or install) is picked up
 * on the next attempt.
 */
// Import the argv builder from the LEAF module (no deps) — NOT the `mux`
// singleton from ./session-mux/index — so we don't form the cycle
// tmux-availability → index → TmuxSessionMux → tmux-availability (TmuxSessionMux's
// `available()` delegates here). This is the NATIVE tmux probe; the WSL backend
// overrides `available()` with its own `wsl tmux -V` probe (P2).
import { argvVersion } from './session-mux/tmux-argv.ts';

let cachedAvailable = false;

export async function isTmuxAvailable(): Promise<boolean> {
  if (cachedAvailable) return true;
  try {
    const proc = Bun.spawn(argvVersion(), { stdout: 'ignore', stderr: 'ignore' });
    const ok = (await proc.exited) === 0;
    if (ok) cachedAvailable = true;
    return ok;
  } catch {
    // ENOENT (not on PATH) or otherwise unspawnable.
    return false;
  }
}

/** User-facing message shown when tmux can't be found. */
export const TMUX_UNAVAILABLE_MESSAGE =
  'tmux was not found on the server PATH. The collab terminal needs tmux to host sessions. ' +
  'Install it (e.g. `brew install tmux`) or relaunch the app, then try again.';
