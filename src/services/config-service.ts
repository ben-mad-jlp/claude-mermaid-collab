import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Minimal config/secrets read layer.
 * Precedence: process.env wins, then ~/.mermaid-collab/config.json, then fallback.
 * Reading the global config file from the server process means secrets (e.g.
 * XAI_API_KEY) reach the server regardless of how it was launched (GUI/Dock or
 * CLI) — fixing the case where a Dock-launched desktop sidecar has no env.
 * config.ts's frozen constants are intentionally NOT migrated here yet.
 */
function configPath(): string {
  return process.env.MERMAID_CONFIG_PATH ?? join(homedir(), '.mermaid-collab', 'config.json');
}

let cache: Record<string, unknown> | null = null;

function loadFile(): Record<string, unknown> {
  if (cache) return cache;
  try {
    const p = configPath();
    cache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Precedence: non-empty process.env[key] → non-empty string in config.json → fallback. */
export function getConfig(key: string, fallback?: string): string | undefined {
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  const fileVal = loadFile()[key];
  if (typeof fileVal === 'string' && fileVal !== '') return fileVal;
  return fallback;
}

/**
 * Secret precedence — the INVERSE of getConfig: non-empty config.json[key] →
 * non-empty process.env[key] → fallback.
 *
 * Use this for USER-MANAGED secrets set via the Settings "Secrets" UI (which
 * writes config.json). It makes the UI authoritative even when a STALE ambient
 * env var of the same name is present: the Claude hook `server-check.sh`
 * respawns the collab server inheriting the Claude session's env, so an
 * env-first read would let an old XAI_API_KEY shadow a freshly-updated config
 * value ("I updated the key in Settings but it didn't take"). Genuine
 * deploy-time env vars should keep using getConfig (env-first).
 */
export function getSecret(key: string, fallback?: string): string | undefined {
  const fileVal = loadFile()[key];
  if (typeof fileVal === 'string' && fileVal !== '') return fileVal;
  const env = process.env[key];
  if (env !== undefined && env !== '') return env;
  return fallback;
}

/**
 * Return the full set of config.json keys/values (the file layer only — env
 * overrides are NOT folded in). Used by the Settings "Secrets" UI to show what
 * is currently stored. Returns a shallow copy so callers can't mutate the cache.
 */
export function getConfigEntries(): Record<string, unknown> {
  return { ...loadFile() };
}

/**
 * Persist one or more keys to ~/.mermaid-collab/config.json and refresh the
 * in-memory cache so a subsequent getConfig() (e.g. the next consult_grok call)
 * sees the new value WITHOUT an app restart. Writes atomically (tmp + rename).
 * A key whose value is an empty string is removed from the file. Returns the
 * merged file contents.
 */
export function setConfig(updates: Record<string, string>): Record<string, unknown> {
  const current = loadFile();
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    if (value === '') delete merged[key];
    else merged[key] = value;
  }
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  renameSync(tmp, p);
  // Replace (not mutate) the cache so getConfig re-reads the new values live.
  cache = merged;
  return merged;
}

/** Test helper: drop the cached file so the next getConfig re-reads. */
export function _resetConfigCache(): void { cache = null; }
