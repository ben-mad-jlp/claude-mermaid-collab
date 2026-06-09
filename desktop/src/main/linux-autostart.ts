import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Linux autostart (Linux P3).
 *
 * Drops a freedesktop `~/.config/autostart/mermaid-collab.desktop` so the
 * Electron app launches on login. It is SAFE to autostart even when a headless
 * systemd unit already owns :9002: the app's ServerSupervisor performs the P0
 * take-over-or-attach handshake (attaches to a healthy server on the canonical
 * port instead of double-binding), so the autostart entry never needs to know
 * whether systemd is running — it just launches the GUI and the handshake sorts
 * out ownership.
 *
 * Gating that DOES live here:
 *  - Linux only (no-op on darwin / win32 — those have their own login-item
 *    mechanisms and macOS behavior must stay unchanged).
 *  - Idempotent + non-clobbering: if the user has disabled the entry
 *    (`X-GNOME-Autostart-enabled=false`) we leave it alone, so we don't
 *    re-enable something they turned off.
 *
 * The path/content builders take injectable env/home and are pure, so they're
 * unit-testable without touching the real filesystem.
 */

const ENTRY_NAME = 'mermaid-collab.desktop';

export interface AutostartOpts {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** `$XDG_CONFIG_HOME/autostart` or `~/.config/autostart`. */
export function autostartDir(opts?: AutostartOpts): string {
  const env = opts?.env ?? process.env;
  const home = opts?.home ?? os.homedir();
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/')
    ? env.XDG_CONFIG_HOME
    : path.join(home, '.config');
  return path.join(base, 'autostart');
}

/** Full path to the autostart .desktop entry. */
export function autostartFilePath(opts?: AutostartOpts): string {
  return path.join(autostartDir(opts), ENTRY_NAME);
}

export interface DesktopEntryOpts {
  /** Command to launch the app (e.g. process.execPath, or the installed wrapper). */
  exec: string;
  /** Icon name registered by the package (deb installs `mermaid-collab`). */
  icon?: string;
}

/** Render the freedesktop .desktop entry body. */
export function desktopEntryContent(opts: DesktopEntryOpts): string {
  const icon = opts.icon ?? 'mermaid-collab';
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Mermaid Collab',
    'Comment=Collaborative Mermaid diagrams & UI designs',
    `Exec=${opts.exec}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Development;',
    'X-GNOME-Autostart-enabled=true',
  ].join('\n') + '\n';
}

/** True when the entry exists AND the user explicitly disabled it. */
function userDisabled(existing: string): boolean {
  return /X-GNOME-Autostart-enabled\s*=\s*false/i.test(existing);
}

export interface InstallAutostartOpts extends AutostartOpts {
  exec: string;
  icon?: string;
  platform?: NodeJS.Platform;
  /** Injectable fs (tests). */
  fsImpl?: Pick<typeof fs, 'existsSync' | 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;
}

export type InstallResult = 'installed' | 'updated' | 'skipped-disabled' | 'skipped-not-linux' | 'unchanged';

/**
 * Install (or refresh) the autostart entry. Returns what it did so callers can
 * log it. No-ops off Linux; respects a user-disabled entry; rewrites only when
 * the Exec/content actually changed (so we don't churn the file every launch).
 */
export function installLinuxAutostart(opts: InstallAutostartOpts): InstallResult {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'linux') return 'skipped-not-linux';

  const f = opts.fsImpl ?? fs;
  const filePath = autostartFilePath(opts);
  const content = desktopEntryContent({ exec: opts.exec, icon: opts.icon });

  let prior: string | null = null;
  try {
    if (f.existsSync(filePath)) prior = f.readFileSync(filePath, 'utf8');
  } catch {
    prior = null;
  }

  if (prior != null && userDisabled(prior)) return 'skipped-disabled';
  if (prior === content) return 'unchanged';

  try {
    f.mkdirSync(autostartDir(opts), { recursive: true });
    f.writeFileSync(filePath, content, { mode: 0o644 });
  } catch {
    // best-effort: a read-only or missing ~/.config shouldn't crash app boot.
    return 'unchanged';
  }
  return prior == null ? 'installed' : 'updated';
}
