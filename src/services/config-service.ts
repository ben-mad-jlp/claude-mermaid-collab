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

// ---------------------------------------------------------------------------
// Judgment LLM config (the daemon's swappable reasoning provider)
// ---------------------------------------------------------------------------

import type { JudgmentConfig, JudgmentProvider } from './judgment-llm.ts';
import { getTierOverride, type TierScope } from './tier-override-store.ts';

/** The xAI model the triage classifier has always used — the default when no
 *  JUDGMENT_MODEL is configured. Keep in sync with grok-triage.ts's xAI path. */
export const DEFAULT_JUDGMENT_MODEL = 'grok-build-0.1';

const JUDGMENT_PROVIDERS: JudgmentProvider[] = ['xai', 'openai', 'anthropic'];

const JUDGMENT_KEY_BY_PROVIDER: Record<JudgmentProvider, string> = {
  xai: 'XAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/**
 * Resolve the daemon's judgment LLM config from config/secrets. Defaults to
 * today's xAI/grok behaviour when nothing is set:
 *  - provider ← JUDGMENT_PROVIDER (default 'xai'; unknown values fall back to 'xai')
 *  - model    ← JUDGMENT_MODEL    (default DEFAULT_JUDGMENT_MODEL)
 *  - apiKey   ← getSecret(per-provider key) — Secrets UI authoritative.
 */
export function getJudgmentConfig(): JudgmentConfig {
  const rawProvider = getConfig('JUDGMENT_PROVIDER', 'xai');
  const provider: JudgmentProvider = JUDGMENT_PROVIDERS.includes(rawProvider as JudgmentProvider)
    ? (rawProvider as JudgmentProvider)
    : 'xai';
  const model = getConfig('JUDGMENT_MODEL', DEFAULT_JUDGMENT_MODEL) ?? DEFAULT_JUDGMENT_MODEL;
  const apiKey = getSecret(JUDGMENT_KEY_BY_PROVIDER[provider]) ?? '';
  return { provider, model, apiKey };
}

// --- Triage as a tier-matrix role (epic 4b81ca59 / L4) ---------------------
//
// Triage (escalation classification) is now a swappable role on the SAME device as
// worker phases: a per-scope `tier_override` row with phase='triage' (set from the
// TieringEditor), or a global WORKER_PROVIDER_TRIAGE/WORKER_MODEL_TRIAGE config key,
// overrides the model. Falls back to the flat JUDGMENT_* config (getJudgmentConfig)
// so existing setups + the zero-code opus swap keep working. We deliberately do NOT
// make 'triage' a worker SubloopRole (it isn't a build phase) — tier_override keys
// `phase` as a free string, so triage rides the same store without polluting the
// worker recipe types. The JudgmentLLM port stays the call surface.

/** Default judgment model per provider when an override names a provider but no model. */
const DEFAULT_MODEL_BY_JUDGMENT: Record<JudgmentProvider, string | null> = {
  xai: DEFAULT_JUDGMENT_MODEL,
  anthropic: 'claude-opus-4-8',
  openai: null, // no safe default — require an explicit WORKER_MODEL_TRIAGE / override model
};

/** Map a worker-tier ProviderId (or a raw provider string) to a JudgmentProvider. */
function providerIdToJudgment(pid: string | undefined): JudgmentProvider | null {
  switch (pid) {
    case 'claude': case 'anthropic': return 'anthropic';
    case 'grok-build': case 'grok': case 'xai': return 'xai';
    case 'codex': case 'openai': return 'openai';
    default: return null;
  }
}

function judgmentFromProvider(jp: JudgmentProvider, model: string | null | undefined): JudgmentConfig | null {
  const m = model || DEFAULT_MODEL_BY_JUDGMENT[jp];
  if (!m) return null; // provider named but no model we can default — skip this tier
  return { provider: jp, model: m, apiKey: getSecret(JUDGMENT_KEY_BY_PROVIDER[jp]) ?? '' };
}

/** Resolve the triage classifier's LLM config for a scope. epic > project > level
 *  > global (WORKER_*_TRIAGE) > flat JUDGMENT_* default. */
export function resolveTriageRoute(ctx: { project?: string; epicId?: string; level?: string } = {}): JudgmentConfig {
  const PHASE = 'triage';
  const fromScope = (scope: TierScope, scopeId?: string): JudgmentConfig | null => {
    if (!scopeId) return null;
    const o = getTierOverride(scope, scopeId, PHASE);
    const jp = providerIdToJudgment(o?.provider);
    return o && jp ? judgmentFromProvider(jp, o.model) : null;
  };
  const global = (): JudgmentConfig | null => {
    const jp = providerIdToJudgment(getConfig('WORKER_PROVIDER_TRIAGE') ?? undefined);
    return jp ? judgmentFromProvider(jp, getConfig('WORKER_MODEL_TRIAGE')) : null;
  };
  return (
    fromScope('epic', ctx.epicId) ??
    fromScope('project', ctx.project) ??
    fromScope('level', ctx.level) ??
    global() ??
    getJudgmentConfig()
  );
}
