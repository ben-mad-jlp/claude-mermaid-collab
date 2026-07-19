import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Minimal config/secrets read layer — pure fs, NO sqlite/heavy deps.
 *
 * Split out of config-service.ts so import-light modules (notably src/auth.ts,
 * which is loaded under vitest where `bun:sqlite` is unavailable) can read the
 * bearer token / config without dragging in the judgment/tier-override stores.
 * config-service.ts re-exports everything here, so existing importers are
 * unchanged.
 *
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

// ---------------------------------------------------------------------------
// Bearer auth token lifecycle (phone-pairing seam)
// ---------------------------------------------------------------------------
//
// The bearer token that `checkAuth` (src/auth.ts) enforces. Resolution is
// config-AUTHORITATIVE (getSecret: config.json-first, env fallback): a rotate
// writes config.json, so the running sidecar honours it WITHOUT being relaunched
// — and a stale launch-time MERMAID_AUTH_TOKEN env var can't shadow a freshly
// rotated token. The env var is only a BOOTSTRAP mechanism (see
// migrateEnvAuthToken). Empty string = auth disabled (today's open-localhost
// behaviour). NOTE: remote-launch.ts keeps its OWN generateAuthToken for the
// SSH-launch path (it synthesises the start command before any config exists).

const AUTH_TOKEN_KEY = 'MERMAID_AUTH_TOKEN';

/** Resolve the active bearer token (config-first, env fallback). '' when unset. */
export function getAuthToken(): string {
  return getSecret(AUTH_TOKEN_KEY) ?? '';
}

const REQUIRE_AUTH_ON_LOOPBACK_KEY = 'MERMAID_REQUIRE_AUTH_ON_LOOPBACK';

/** True when loopback peers (desktop UI, local MCP) must also present the
 *  bearer token — i.e. only a genuinely-remote-free localhost is trusted
 *  tokenless. Default false (today's open-localhost behavior). Read via
 *  getConfig (env-first, deploy-time flag, not a Secrets-UI value). */
export function getRequireAuthOnLoopback(): boolean {
  return getConfig(REQUIRE_AUTH_ON_LOOPBACK_KEY) === 'true';
}

/** Generate a fresh random bearer token (48 hex chars). */
export function generateAuthToken(): string {
  return randomBytes(24).toString('hex');
}

/** Persist a bearer token to config.json (rotate / first-provision). */
export function setAuthToken(token: string): void {
  setConfig({ [AUTH_TOKEN_KEY]: token });
}

/**
 * One-time startup migration so config becomes the single source of truth.
 * - env set, no config token  → copy env → config ('migrated')
 * - env set, config differs   → leave config authoritative, caller warns ('diverged')
 * - otherwise                 → 'noop'
 * Reads the FILE layer directly (not getSecret) so we compare env vs persisted.
 */
export function migrateEnvAuthToken(): 'migrated' | 'diverged' | 'noop' {
  const env = process.env[AUTH_TOKEN_KEY];
  if (!env) return 'noop';
  const fileVal = loadFile()[AUTH_TOKEN_KEY];
  const cfg = typeof fileVal === 'string' ? fileVal : '';
  if (cfg === '') { setAuthToken(env); return 'migrated'; }
  if (cfg !== env) return 'diverged';
  return 'noop';
}

// ---------------------------------------------------------------------------
// Server port resolution
// ---------------------------------------------------------------------------

const PORT_KEY = 'port';

/** Unconfigured default server port (also the desktop app's fixed canonical port). */
export const DEFAULT_MERMAID_PORT = 9002;

/**
 * Resolve the configured server port: process.env.PORT → config.json 'port'
 * key → DEFAULT_MERMAID_PORT (9002). Range-validates any explicit value (env
 * or file) the same way config.ts's old validatePort() did; throws on
 * invalid/out-of-range so a bad value fails loudly at startup instead of
 * silently falling back.
 *
 * Reads env under the 'PORT' key and the file layer under the lowercase
 * 'port' key directly (not via getConfig/getSecret) since those helpers use
 * ONE key name for both layers, and the env var name ('PORT') and the
 * documented config.json key ('port') differ in case.
 */
export function getConfiguredPort(): number {
  const envVal = process.env.PORT;
  const raw = envVal !== undefined && envVal !== ''
    ? envVal
    : (() => {
        const fileVal = getConfigEntries()[PORT_KEY];
        return typeof fileVal === 'string' ? fileVal : undefined;
      })();
  if (raw === undefined) return DEFAULT_MERMAID_PORT;
  const port = Number.parseInt(raw, 10);
  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT value: "${raw}" is not a valid number`);
  }
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${port} is out of valid range (0-65535)`);
  }
  return port;
}

/** Persist the port to config.json (Settings UI / CLI port override). */
export function setConfiguredPort(port: number): void {
  setConfig({ [PORT_KEY]: String(port) });
}
