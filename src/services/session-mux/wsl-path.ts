/**
 * Windows ↔ WSL path translation for the `drive-wsl-tmux` backend (sidecar runs
 * natively on Windows and shells out to `wsl.exe`). Only the args that carry a
 * Windows path cross the boundary — chiefly `new-session -c <cwd>` — so the
 * transform rewrites any token that looks like a Windows absolute path and leaves
 * everything else (tmux verbs, flags, format strings) untouched.
 *
 * NOTE: when the sidecar runs INSIDE WSL (the preferred topology, decision
 * 588c6df1), there is no boundary and `TmuxSessionMux` is used directly — this
 * module is only for the Windows-native fallback.
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
