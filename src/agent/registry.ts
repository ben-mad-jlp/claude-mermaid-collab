/**
 * WorkerAgent registry (PAW P1) — ProviderId → WorkerAgent.
 *
 * The coordinator resolves the worker provider through this registry instead of
 * hard-importing the Claude adapter, so a second provider can be added later
 * WITHOUT editing the launch/stall/fleet code paths. Today it registers ONLY
 * `claude`, and the kill-switch keeps it that way:
 *
 *   WORKER_AGENT_REGISTRY=claude-only   (the default & the safe floor)
 *
 * The env var is read once at module load. Any value other than an explicit
 * future opt-in collapses the registry to claude-only — i.e. claude is the floor
 * the kill-switch can never remove. There is intentionally no public mutator;
 * adding a provider means registering it here behind its own flag.
 */
import { ClaudeCodeAgent } from './adapters/claude-code';
import type { ProviderId, WorkerAgent } from './worker-agent';

/** True when the registry is pinned to claude-only. Default (unset) is claude-only
 *  — the kill-switch's safe floor; only an explicit future flag opts additional
 *  providers in. */
function claudeOnly(): boolean {
  const v = (process.env.WORKER_AGENT_REGISTRY ?? 'claude-only').trim().toLowerCase();
  // Anything not explicitly opting a multi-provider mode in stays claude-only.
  return v === '' || v === 'claude-only' || v === 'claude';
}

/** Build the provider map. Claude is ALWAYS registered (the floor); the
 *  kill-switch only governs whether anything ELSE could ever join — and today
 *  nothing else exists, so the map is claude-only regardless. */
function buildRegistry(): Map<ProviderId, WorkerAgent> {
  const reg = new Map<ProviderId, WorkerAgent>();
  reg.set('claude', ClaudeCodeAgent);
  // Future providers would be registered here, gated on !claudeOnly(). The
  // kill-switch (claude-only) guarantees claude is the only entry today.
  void claudeOnly;
  return reg;
}

const REGISTRY = buildRegistry();

/** Default provider. Always claude — the kill-switch's floor. */
export const DEFAULT_PROVIDER: ProviderId = 'claude';

/** Resolve a worker agent by id (defaults to the claude floor). Throws on an
 *  unregistered id rather than silently degrading — an unknown provider is a
 *  programming error, not a runtime fallback. */
export function resolveWorkerAgent(id: ProviderId = DEFAULT_PROVIDER): WorkerAgent {
  const agent = REGISTRY.get(id);
  if (!agent) {
    throw new Error(`No WorkerAgent registered for provider '${id}' (registry is claude-only)`);
  }
  return agent;
}

/** The set of registered provider ids (today: ['claude']). */
export function registeredProviders(): ProviderId[] {
  return [...REGISTRY.keys()];
}
