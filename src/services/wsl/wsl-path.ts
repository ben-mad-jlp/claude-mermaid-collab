/**
 * Windows → WSL path translation. Used by the sidecar-launch command builder to
 * translate the (Windows-side) env vars that carry a filesystem path — chiefly
 * the repo path — into their `/mnt/c/…` WSL equivalent before they cross into
 * `wsl.exe`.
 *
 * (Formerly lived in `session-mux/wsl-path.ts`, shared with the tmux-backed
 * `WslTmuxSessionMux`; that backend was removed with the tmux/terminal stack —
 * Phase 4 — so this pure helper moved here, its one remaining consumer.)
 */

/** Matches a Windows absolute path: a drive letter + `:` + `\` or `/`. */
const WIN_ABS_PATH = /^[A-Za-z]:[\\/]/;

/**
 * `C:\Users\ben\proj` → `/mnt/c/Users/ben/proj`. Lowercases the drive letter,
 * flips backslashes to forward slashes. Returns the input unchanged if it isn't a
 * Windows absolute path (so it's safe to map over every argv token).
 */
export function winToWslPath(p: string): string {
  if (!WIN_ABS_PATH.test(p)) return p;
  const drive = p[0].toLowerCase();
  const rest = p.slice(2).replace(/\\/g, '/');
  return `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
}
