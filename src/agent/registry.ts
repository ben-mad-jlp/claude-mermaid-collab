/**
 * WorkerAgent registry (PAW P1) — ProviderId → WorkerAgent.
 *
 * The coordinator resolves the worker provider through this registry instead of
 * hard-importing an adapter, so a second provider can be added later WITHOUT
 * editing the launch/stall/fleet code paths. Today it registers ONLY `claude`,
 * and the kill-switch keeps it that way:
 *
 *   WORKER_AGENT_REGISTRY=claude-only   (the default & the safe floor)
 *
 * `claude` resolves to AnthropicOwnHarness, the in-process (no tmux) worker —
 * the interactive tmux-backed ClaudeCodeAgent adapter was removed with the
 * tmux/terminal stack (Phase 4).
 *
 * The env var is read once at module load. Any value other than an explicit
 * future opt-in collapses the registry to claude-only — i.e. claude is the floor
 * the kill-switch can never remove. There is intentionally no public mutator;
 * adding a provider means registering it here behind its own flag.
 */
import { GrokOwnHarness, AnthropicOwnHarness } from './adapters/grok-own';
import { runConformance, GROK_PANE_FIXTURES, GROK_LIVENESS_FIXTURES } from './__tests__/conformance';
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
  reg.set('claude', AnthropicOwnHarness);
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

// ---------------------------------------------------------------------------
// PAW P4: the 'grok-build' provider (GrokOwnHarness) — registered DORMANT.
//
// The kill-switch keeps the DEFAULT registry (resolveWorkerAgent / the pool
// slot-tagging) claude-only, so default behavior is byte-identical and
// registeredProviders() stays ['claude']. The grok adapter is reached ONLY via
// resolveGrokAgent(), used by launchWorker's explicit `provider === 'grok-build'`
// branch — and ONLY after it passes the SAME conformance suite the Claude adapter
// must pass (its own recorded grok-loop fixtures). A non-conformant adapter throws
// rather than ever launching. The verification runs once and is cached.
// ---------------------------------------------------------------------------

let grokConformanceChecked = false;

/** Run the grok-own conformance suite against GrokOwnHarness. Returns the list of
 *  mismatches (empty = conformant). Exposed so a vitest spec can assert it too. */
export function checkGrokConformance(): ReturnType<typeof runConformance> {
  return runConformance(GrokOwnHarness, GROK_PANE_FIXTURES, GROK_LIVENESS_FIXTURES);
}

/** Resolve the grok-build WorkerAgent, GATED on conformance. Throws (fail-closed)
 *  if the adapter does not collapse its recorded lifecycle panes into the expected
 *  normalized booleans — a non-conformant provider must NEVER launch. The check is
 *  memoized after the first success. */
export function resolveGrokAgent(): WorkerAgent {
  if (!grokConformanceChecked) {
    const failures = checkGrokConformance();
    if (failures.length > 0) {
      throw new Error(
        `GrokOwnHarness failed conformance (${failures.length} mismatch(es)) — refusing to register grok-build: ` +
          JSON.stringify(failures),
      );
    }
    grokConformanceChecked = true;
  }
  return GrokOwnHarness;
}

/** Read-only accessor to the GrokOwnHarness singleton for inspection (live
 *  transcript / injection routes). Unlike resolveGrokAgent() this is NOT gated on
 *  conformance — it only exposes the harness's read/steer methods (getTranscript /
 *  injectFollowup / isAlive), which are inert for sessions that are not live grok
 *  lanes. The lane map is the single source of truth, so a claude session simply
 *  has no lane and these calls return [] / false. */
export function getGrokHarnessForInspection(): typeof GrokOwnHarness {
  return GrokOwnHarness;
}

// ---------------------------------------------------------------------------
// In-process Claude worker (AnthropicOwnHarness) — the daemon-native replacement
// for the legacy `claude` CLI (ClaudeCodeAgent). Reached ONLY via the claude-in-
// process flag in launchWorker (parallel-run vs the CLI), conformance-gated like
// grok. Reuses the grok fixtures since it shares the exact detector machinery.
// ---------------------------------------------------------------------------

let anthropicCoreConformanceChecked = false;

/** Run conformance against AnthropicOwnHarness (same detectors as grok). */
export function checkAnthropicCoreConformance(): ReturnType<typeof runConformance> {
  return runConformance(AnthropicOwnHarness, GROK_PANE_FIXTURES, GROK_LIVENESS_FIXTURES);
}

/** Resolve the in-process Claude worker, GATED on conformance (fail-closed). */
export function resolveAnthropicCoreAgent(): WorkerAgent {
  if (!anthropicCoreConformanceChecked) {
    const failures = checkAnthropicCoreConformance();
    if (failures.length > 0) {
      throw new Error(
        `AnthropicOwnHarness failed conformance (${failures.length} mismatch(es)) — refusing in-process claude: ` +
          JSON.stringify(failures),
      );
    }
    anthropicCoreConformanceChecked = true;
  }
  return AnthropicOwnHarness;
}

/** Read-only accessor to the AnthropicOwnHarness singleton for inspection
 *  (transcript / inject routes) — not conformance-gated, inert for non-claude-core lanes. */
export function getAnthropicCoreHarnessForInspection(): typeof AnthropicOwnHarness {
  return AnthropicOwnHarness;
}
