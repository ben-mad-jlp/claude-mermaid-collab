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
// Config source mirrors the inflight-limiter: config.json FIRST (hot, UI/Secrets-settable,
// survives restart), env fallback. Knobs (value must be 'claude' or 'grok-build'):
//   MERMAID_NODE_PROVIDER_<KIND>   per-kind override (e.g. MERMAID_NODE_PROVIDER_IMPLEMENT)
//   MERMAID_NODE_PROVIDER          project-wide default for all selectable kinds
// The per-kind knob is what drives the controlled experiment (implement→grok, rest claude).

import { getConfig } from './config-file';
import { kindDefaultGrokModel, type GrokNodeKind, GROK_NODE_KINDS } from '../agent/grok-model';

export type NodeProvider = 'claude' | 'grok-build';

function asProvider(v: string | null | undefined): NodeProvider | null {
  const t = v?.trim();
  return t === 'grok-build' || t === 'claude' ? t : null;
}

/** config.json first, then env. */
function cfg(key: string): string | null {
  const c = getConfig(key);
  if (c != null && c !== '') return c;
  const e = process.env[key];
  return e != null && e !== '' ? e : null;
}

/**
 * Resolve the provider for ONE node. Precedence:
 *   mcp__ in allowlist → 'claude' (hard guard) → per-kind config → project default → 'claude'.
 */
export function resolveNodeProvider(kind: string, allowedTools: string | undefined): NodeProvider {
  if ((allowedTools ?? '').includes('mcp__')) return 'claude'; // MCP-forced, never grok
  const perKind = asProvider(cfg(`MERMAID_NODE_PROVIDER_${kind.toUpperCase()}`));
  if (perKind) return perKind;
  const projectDefault = asProvider(cfg('MERMAID_NODE_PROVIDER'));
  if (projectDefault) return projectDefault;
  return 'claude';
}

/** True when ANY node provider is configured to grok-build — drives the leaf-entry auth
 *  pre-flight so a mixed leaf fails fast (rather than stranding after the cheap grok work). */
export function anyGrokNodeConfigured(): boolean {
  if (asProvider(cfg('MERMAID_NODE_PROVIDER')) === 'grok-build') return true;
  for (const k of GROK_NODE_KINDS) {
    if (asProvider(cfg(`MERMAID_NODE_PROVIDER_${k.toUpperCase()}`)) === 'grok-build') return true;
  }
  return false;
}

/** The OPAQUE model recorded in the ledger for a grok node (contract A — not the CLI id).
 *  kindDefaultGrokModel returns the CLI id; we keep the same value for the ledger row so
 *  the per-node provider+model is legible. */
export function grokLedgerModel(kind: string): string {
  return kindDefaultGrokModel((GROK_NODE_KINDS as readonly string[]).includes(kind) ? (kind as GrokNodeKind) : undefined);
}
