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
import { getProjectNodeProvider, listNodeProfileOverrides } from './orchestrator-config';

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

/** Valid grok CLI model ids selectable per-kind (the UI matrix model column for grok rows). */
const GROK_CLI_MODELS = new Set(['grok-build', 'grok-build-0.1', 'grok-composer-2.5-fast']);

/** Resolve the grok CLI model for a node, HONORING the per-kind DB model override (UI matrix)
 *  when it names a real grok model, else the kind default. Without this, every grok node was
 *  pinned to its kind default — e.g. `implement` was forced to grok-composer-2.5-fast (the fast
 *  model), so you could NOT route implement to grok-build (grok-build-0.1, xAI's agentic coding
 *  model). A claude alias (opus/sonnet) set on a grok row is ignored → kind default. Defensive
 *  on DB access. */
export function grokModelForKind(project: string | undefined, kind: string): string {
  const override = project
    ? (() => { try { return listNodeProfileOverrides(project)[kind]?.model ?? null; } catch { return null; } })()
    : null;
  const v = override?.trim();
  if (v && GROK_CLI_MODELS.has(v)) return v;
  return grokLedgerModel(kind);
}
