import { homedir } from 'os';
import { join } from 'path';

/**
 * XDG Base Directory layer for NEW mermaid-collab artifacts (Linux P3).
 *
 * Per the Linux-port decision (04de0e95): the existing SQLite DBs and the
 * supervisor/steward workspaces STAY at `~/.mermaid-collab` — there is NO
 * migration. This module is ONLY for artifacts introduced going forward, so a
 * Linux install can honor `$XDG_CONFIG_HOME` / `$XDG_DATA_HOME` /
 * `$XDG_CACHE_HOME` (and the freedesktop fallbacks) instead of dumping
 * everything under a single dotdir.
 *
 * The functions take an injectable `env`/`home` so they're unit-testable and so
 * platform branching stays in one place. On Linux they follow the XDG spec; on
 * macOS / Windows they honor an explicitly-set XDG var (some tools set them) but
 * otherwise fall back to the platform-native app dir — so behavior on macOS is
 * unchanged for anything that doesn't opt in.
 */

const APP_DIR = 'mermaid-collab';

export interface XdgOpts {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/** First non-empty, absolute candidate; otherwise the provided fallback. */
function firstAbs(candidate: string | undefined, fallback: string): string {
  if (candidate && candidate.startsWith('/')) return candidate;
  // Windows absolute paths (C:\...) — accept as-is when non-empty.
  if (candidate && /^[A-Za-z]:[\\/]/.test(candidate)) return candidate;
  return fallback;
}

/** `$XDG_CONFIG_HOME` or the platform default (Linux: `~/.config`). */
export function xdgConfigHome(opts?: XdgOpts): string {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? homedir();
  const platform = opts?.platform ?? process.platform;
  const explicit = env.XDG_CONFIG_HOME;
  if (explicit) return firstAbs(explicit, join(home, '.config'));
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming');
  return join(home, '.config');
}

/** `$XDG_DATA_HOME` or the platform default (Linux: `~/.local/share`). */
export function xdgDataHome(opts?: XdgOpts): string {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? homedir();
  const platform = opts?.platform ?? process.platform;
  const explicit = env.XDG_DATA_HOME;
  if (explicit) return firstAbs(explicit, join(home, '.local', 'share'));
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  return join(home, '.local', 'share');
}

/** `$XDG_CACHE_HOME` or the platform default (Linux: `~/.cache`). */
export function xdgCacheHome(opts?: XdgOpts): string {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? homedir();
  const platform = opts?.platform ?? process.platform;
  const explicit = env.XDG_CACHE_HOME;
  if (explicit) return firstAbs(explicit, join(home, '.cache'));
  if (platform === 'darwin') return join(home, 'Library', 'Caches');
  if (platform === 'win32') return join(xdgDataHome(opts), 'Cache');
  return join(home, '.cache');
}

/** Per-app config dir for NEW artifacts: `<xdgConfigHome>/mermaid-collab`. */
export function mcConfigDir(opts?: XdgOpts): string {
  return join(xdgConfigHome(opts), APP_DIR);
}

/** Per-app data dir for NEW artifacts: `<xdgDataHome>/mermaid-collab`. */
export function mcDataDir(opts?: XdgOpts): string {
  return join(xdgDataHome(opts), APP_DIR);
}

/** Per-app cache dir for NEW artifacts: `<xdgCacheHome>/mermaid-collab`. */
export function mcCacheDir(opts?: XdgOpts): string {
  return join(xdgCacheHome(opts), APP_DIR);
}

/**
 * The LEGACY home — `~/.mermaid-collab`. The existing DBs and the
 * supervisor/steward workspaces live here and STAY here (no migration). New
 * code that needs those should keep using this, NOT the XDG dirs above.
 */
export function mcLegacyHome(opts?: XdgOpts): string {
  const home = opts?.home ?? homedir();
  return join(home, '.mermaid-collab');
}
