// The pure-fs config/secrets primitives + bearer-token lifecycle now live in
// config-file.ts (sqlite-free so import-light modules like src/auth.ts can read
// the token under vitest). Re-exported here so every existing importer of
// config-service is unchanged.
export {
  getConfig,
  getSecret,
  getConfigEntries,
  setConfig,
  _resetConfigCache,
  getAuthToken,
  generateAuthToken,
  setAuthToken,
  migrateEnvAuthToken,
} from './config-file.ts';
import { getConfig, getSecret } from './config-file.ts';

// ---------------------------------------------------------------------------
// Judgment LLM config (the daemon's swappable reasoning provider)
// ---------------------------------------------------------------------------

import type { JudgmentConfig, JudgmentProvider } from './judgment-llm.ts';
import { getTierOverride, type TierScope } from './tier-override-store.ts';

/** The xAI model the triage classifier has always used — the default when no
 *  JUDGMENT_MODEL is configured. Keep in sync with grok-triage.ts's xAI path. */
export const DEFAULT_JUDGMENT_MODEL = 'grok-build-0.1';

const JUDGMENT_PROVIDERS: JudgmentProvider[] = ['xai', 'openai', 'anthropic', 'claude'];

const JUDGMENT_KEY_BY_PROVIDER: Record<JudgmentProvider, string> = {
  xai: 'XAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  claude: '', // subscription (`claude -p`) — no API key
};

/**
 * Resolve the daemon's judgment LLM config from config/secrets. Defaults to
 * today's xAI/grok behaviour when nothing is set:
 *  - provider ← JUDGMENT_PROVIDER (default 'xai'; unknown values fall back to 'xai')
 *  - model    ← JUDGMENT_MODEL    (default DEFAULT_JUDGMENT_MODEL)
 *  - apiKey   ← getSecret(per-provider key) — Secrets UI authoritative.
 */
export function getJudgmentConfig(): JudgmentConfig {
  // Default to the SUBSCRIPTION provider (`claude -p`) — same auth as the leaf-executor,
  // no API key needed — so triage works out of the box. Keyed providers (xai/openai/
  // anthropic) only when explicitly selected via JUDGMENT_PROVIDER.
  const rawProvider = getConfig('JUDGMENT_PROVIDER', 'claude');
  const provider: JudgmentProvider = JUDGMENT_PROVIDERS.includes(rawProvider as JudgmentProvider)
    ? (rawProvider as JudgmentProvider)
    : 'claude';
  const model = getConfig('JUDGMENT_MODEL') ?? (provider === 'claude' ? 'sonnet' : DEFAULT_JUDGMENT_MODEL) ?? DEFAULT_JUDGMENT_MODEL;
  const apiKey = provider === 'claude' ? '' : (getSecret(JUDGMENT_KEY_BY_PROVIDER[provider]) ?? '');
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
  claude: 'sonnet', // subscription `claude -p` model alias
};

/** Map a worker-tier ProviderId (or a raw provider string) to a JudgmentProvider. */
function providerIdToJudgment(pid: string | undefined): JudgmentProvider | null {
  switch (pid) {
    case 'claude': return 'claude';        // subscription (`claude -p`) — no API key
    case 'anthropic': return 'anthropic';  // Anthropic API (keyed) — explicit opt-in
    case 'grok-build': case 'grok': case 'xai': return 'xai';
    case 'codex': case 'openai': return 'openai';
    default: return null;
  }
}

function judgmentFromProvider(jp: JudgmentProvider, model: string | null | undefined): JudgmentConfig | null {
  const m = model || DEFAULT_MODEL_BY_JUDGMENT[jp];
  if (!m) return null; // provider named but no model we can default — skip this tier
  const apiKey = jp === 'claude' ? '' : (getSecret(JUDGMENT_KEY_BY_PROVIDER[jp]) ?? '');
  return { provider: jp, model: m, apiKey };
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
  const cfg =
    fromScope('epic', ctx.epicId) ??
    fromScope('project', ctx.project) ??
    fromScope('level', ctx.level) ??
    global() ??
    getJudgmentConfig();
  // The 'claude' (subscription) provider spawns `claude -p` and needs a TRUSTED cwd — run
  // it in the project being triaged so the CLI trusts the folder.
  return ctx.project ? { ...cfg, cwd: ctx.project } : cfg;
}
