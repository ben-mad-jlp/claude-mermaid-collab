/**
 * Reads the desktop app's persisted server fleet (`servers.json`) so the node
 * server's pairing route can hand the phone every server the desktop knows
 * about, not just itself.
 *
 * Pure-node, sync, no electron / no `desktop/` import — the node server is a
 * separate package from `desktop/`, so `desktop/src/main/connection-store.ts`
 * is only ever MIRRORED here, never imported.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface FleetServer {
  id: string;
  label: string;
  host: string;
  port: number;
  token?: string;
}

/** Raw shape persisted by desktop/src/main/connection-store.ts writeToDisk(). */
interface PersistedFleetFile {
  entries?: unknown[];
  forgotten?: string[];
}

/** Mirrors connection-store.ts's `join(userDataDir, 'servers.json')` per-platform default. */
function defaultServersFilePath(): string {
  const appDirName = 'mermaid-collab-desktop';
  let userDataDir: string;
  if (process.platform === 'darwin') {
    userDataDir = join(homedir(), 'Library', 'Application Support', appDirName);
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    userDataDir = join(appData, appDirName);
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    userDataDir = join(xdgConfig, appDirName);
  }
  return join(userDataDir, 'servers.json');
}

function resolveServersFilePath(): string {
  const override = process.env.MERMAID_DESKTOP_SERVERS_FILE;
  if (override && override.length > 0) return override;
  return defaultServersFilePath();
}

function coerceEntry(raw: unknown): FleetServer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { id, label, host, port, token } = r;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof label !== 'string' || label.length === 0) return null;
  if (typeof host !== 'string' || host.length === 0) return null;
  if (typeof port !== 'number' || !Number.isFinite(port)) return null;
  const entry: FleetServer = { id, label, host, port };
  if (typeof token === 'string' && token.length > 0) entry.token = token;
  return entry;
}

/**
 * Reads the desktop fleet's persisted `servers.json` and returns the rows
 * that parse as valid `FleetServer`s. NEVER throws — any failure (missing
 * file, EACCES, malformed JSON, non-array `entries`) yields `[]`.
 */
export function readDesktopFleet(): FleetServer[] {
  try {
    const path = resolveServersFilePath();
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as PersistedFleetFile;
    if (!Array.isArray(parsed.entries)) return [];
    const out: FleetServer[] = [];
    for (const entry of parsed.entries) {
      const fs = coerceEntry(entry);
      if (fs) out.push(fs);
    }
    return out;
  } catch {
    return [];
  }
}
