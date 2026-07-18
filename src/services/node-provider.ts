// Per-node provider resolution for the leaf-executor (PR-2 wiring of the GrokNodeInvoker).
//
// Per-NODE hybrid routing: each headless node (blueprint/implement/review/…) can run on
// a different provider — the validated sweet spot is "strong model plans + reviews, grok
// builds" (design: per-node-hybrid-provider-routing). A node is dispatched to Claude or
// Grok based on config, with TWO hard rules:
//   1. MCP-FORCED CLAUDE — any node whose allowlist contains an `mcp__` tool (report,
//      driveexec, the reviewer variant) MUST run on Claude; Grok has no MCP. This is a
//      per-NODE guard (the rest of the leaf still runs on grok) — strictly better than the
//      v1 whole-leaf rejection.
//   2. DEFAULT CLAUDE — absent any config, every node resolves to 'claude' → zero behaviour
//      change. A node only goes to grok when explicitly configured.
//
// Resolution precedence (highest first):
//   1. mcp__ in allowlist → 'claude' (hard guard — Grok has no MCP)
//   2. per-(project,kind) DB override   (node_profile_override.provider — the UI matrix)
//   3. per-project DB default            (orchestrator_config.nodeProvider — the UI toggle)
//   4. per-kind env/config knob          (MERMAID_NODE_PROVIDER_<KIND>)
//   5. project env/config knob           (MERMAID_NODE_PROVIDER)
//   6. 'claude'                          (default → zero behaviour change)
// DB (UI) wins over the env/config knobs; the knobs remain for headless/experiment use.
// All DB reads are DEFENSIVE (a missing store → skip, never throw into the run).

import { getConfig } from './config-file';
import { kindDefaultGrokModel, type GrokNodeKind, GROK_NODE_KINDS } from '../agent/grok-model';
import { getProjectNodeProvider, getProjectEffort, listNodeProfileOverrides } from './orchestrator-config';
import { isModelForProvider, GROK_BUILD_MODELS } from './provider-model';
import { ORCHESTRATION_NODE_PROFILE, type OrchestrationNodeKind } from './node-kinds';
import type { EffortLevel } from '../agent/contracts';

export type NodeProvider = 'claude' | 'grok-build' | 'grok-api';

function asProvider(v: string | null | undefined): NodeProvider | null {
  const t = v?.trim();
  return t === 'grok-build' || t === 'claude' || t === 'grok-api' ? t : null;
}

/** config.json / env knob value, or null. */
function cfg(key: string): string | null {
  const c = getConfig(key);
  if (c != null && c !== '') return c;
  const e = process.env[key];
  return e != null && e !== '' ? e : null;
}

/** Per-kind DB override (defensive). */
function dbKindProvider(project: string | undefined, kind: string): NodeProvider | null {
  if (!project) return null;
  try { return asProvider(listNodeProfileOverrides(project)[kind]?.provider); } catch { return null; }
}

/** Per-project DB default (defensive). */
function dbProjectProvider(project: string | undefined): NodeProvider | null {
  if (!project) return null;
  try { return asProvider(getProjectNodeProvider(project)); } catch { return null; }
}

/**
 * Resolve the provider for ONE node. See the precedence table at the top of the file.
 */
export function resolveNodeProvider(project: string | undefined, kind: string, allowedTools: string | undefined): NodeProvider {
  if ((allowedTools ?? '').includes('mcp__')) return 'claude'; // MCP-forced, never grok
  return (
    dbKindProvider(project, kind) ??
    dbProjectProvider(project) ??
    asProvider(cfg(`MERMAID_NODE_PROVIDER_${kind.toUpperCase()}`)) ??
    asProvider(cfg('MERMAID_NODE_PROVIDER')) ??
    'claude'
  );
}

/** True when ANY node provider (DB or env/config) is grok-build — drives the leaf-entry
 *  auth pre-flight so a mixed leaf fails fast (rather than stranding after the cheap grok
 *  work). Defensive on DB access. */
export function anyGrokNodeConfigured(project?: string): boolean {
  if (dbProjectProvider(project) === 'grok-build') return true;
  if (project) {
    try {
      for (const ov of Object.values(listNodeProfileOverrides(project))) {
        if (asProvider(ov.provider) === 'grok-build') return true;
      }
    } catch { /* no store → skip */ }
  }
  if (asProvider(cfg('MERMAID_NODE_PROVIDER')) === 'grok-build') return true;
  for (const k of GROK_NODE_KINDS) {
    if (asProvider(cfg(`MERMAID_NODE_PROVIDER_${k.toUpperCase()}`)) === 'grok-build') return true;
  }
  return false;
}

/** True when ANY node provider (DB or env/config) is grok-api — drives the leaf-entry auth
 *  pre-flight for the xAI-API lane (XAI_API_KEY), separate from grok-build's OIDC pre-flight. */
export function anyXaiApiNodeConfigured(project?: string): boolean {
  if (dbProjectProvider(project) === 'grok-api') return true;
  if (project) {
    try {
      for (const ov of Object.values(listNodeProfileOverrides(project))) {
        if (asProvider(ov.provider) === 'grok-api') return true;
      }
    } catch { /* no store → skip */ }
  }
  if (asProvider(cfg('MERMAID_NODE_PROVIDER')) === 'grok-api') return true;
  for (const k of GROK_NODE_KINDS) {
    if (asProvider(cfg(`MERMAID_NODE_PROVIDER_${k.toUpperCase()}`)) === 'grok-api') return true;
  }
  return false;
}

/** True when at least one of the GIVEN node kinds resolves to grok-build for this project —
 *  the kind-scoped pre-flight so a grok override on a retired/dead kind can't gate a leaf whose
 *  live kinds are all claude (bug 3764675c). Reuses the full resolveNodeProvider precedence. */
export function grokNeededForKinds(project: string | undefined, kinds: readonly string[]): boolean {
  return kinds.some((k) => resolveNodeProvider(project, k, undefined) === 'grok-build');
}

/** grok-api (xAI API) analogue of grokNeededForKinds — kind-scoped XAI_API_KEY pre-flight. */
export function xaiApiNeededForKinds(project: string | undefined, kinds: readonly string[]): boolean {
  return kinds.some((k) => resolveNodeProvider(project, k, undefined) === 'grok-api');
}

/** The model recorded in the ledger for a grok-api node — the flagship reasoner. */
export function xaiApiLedgerModel(_kind: string): string {
  return 'grok-4.3';
}

/** The OPAQUE model recorded in the ledger for a grok node (contract A — not the CLI id).
 *  kindDefaultGrokModel returns the CLI id; we keep the same value for the ledger row so
 *  the per-node provider+model is legible. */
export function grokLedgerModel(kind: string): string {
  return kindDefaultGrokModel((GROK_NODE_KINDS as readonly string[]).includes(kind) ? (kind as GrokNodeKind) : undefined);
}

/** Dedup set for provider/model mismatch warnings to avoid spam in hot loops. */
const warnedMismatches = new Set<string>();

/** The model to run for (kind, provider), honoring the per-kind DB override ONLY when it
 *  belongs to the provider's family. A stale/bad row must never brick the daemon: warn
 *  loudly, naming both sides, and fall back to the provider's default for the kind. */
export function resolveNodeModel(
  project: string | undefined,
  kind: string,
  provider: NodeProvider,
  claudeDefault: string,
): string {
  // Default per provider.
  const getDefault = (): string => {
    if (provider === 'grok-build') return grokLedgerModel(kind);
    if (provider === 'grok-api') return xaiApiLedgerModel(kind);
    return claudeDefault;
  };

  // Read override defensively.
  let override: string | null = null;
  if (project) {
    try {
      override = listNodeProfileOverrides(project)[kind]?.model ?? null;
    } catch {
      return getDefault();
    }
  }

  const v = override?.trim();
  if (!v) return getDefault();

  // Check if override belongs to provider's family.
  if (isModelForProvider(provider, v)) return v;

  // Mismatch: warn once per (project, kind, provider, model) and fall back to default.
  const warnKey = `${project}/${kind}/${provider}/${v}`;
  if (!warnedMismatches.has(warnKey)) {
    warnedMismatches.add(warnKey);
    console.warn(`[node-provider] provider/model mismatch: kind=${kind} provider=${provider} model=${v} — ignoring the override and running ${getDefault()}. Fix the node_profile_override row.`);
  }
  return getDefault();
}

/** Effort resolution for an orchestration node (forge/conductor/planner): per-kind
 *  override → per-project blanket (getProjectEffort) → the kind's ORCHESTRATION_NODE_PROFILE
 *  default. Mirrors leaf-executor's per-leaf-kind effort precedence so orchestration nodes
 *  finally honour the project-wide effort knob. Defensive on DB access: a missing override
 *  store falls through to the project/default tiers, never throws. */
export function resolveOrchestrationEffort(project: string | undefined, kind: OrchestrationNodeKind): EffortLevel {
  let override: EffortLevel | null = null;
  if (project) {
    try { override = listNodeProfileOverrides(project)[kind]?.effort ?? null; } catch { /* fall through */ }
  }
  const projectEffort = project ? getProjectEffort(project) : null;
  return override ?? projectEffort ?? ORCHESTRATION_NODE_PROFILE[kind].effort;
}

/** Resolve the grok CLI model for a node, HONORING the per-kind DB model override (UI matrix)
 *  when it names a real grok model, else the kind default. Without this, every grok node was
 *  pinned to its kind default — e.g. `implement` was forced to grok-composer-2.5-fast (the fast
 *  model), so you could NOT route implement to grok-build (grok-build-0.1, xAI's agentic coding
 *  model). A claude alias (opus/sonnet) set on a grok row is ignored → kind default. Defensive
 *  on DB access. */
export function grokModelForKind(project: string | undefined, kind: string): string {
  return resolveNodeModel(project, kind, 'grok-build', grokLedgerModel(kind));
}
