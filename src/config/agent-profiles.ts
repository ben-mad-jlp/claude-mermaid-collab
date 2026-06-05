import type { RuntimeMode } from '../agent/contracts';
import { manifestProfile, inferTypeFromManifest } from './project-manifest';

// Allow ALL mermaid MCP tools without per-tool prompts. The server is registered
// as `mermaid` in the project .mcp.json (tools are mcp__mermaid__*), so the
// server-level `mcp__mermaid` token is what actually matches a spawned worker's
// tool calls (get_todo/complete_todo/etc.). The plugin-namespaced form is kept as
// a belt-and-suspenders match for contexts where the server is namespaced.
const MCP = 'mcp__mermaid mcp__plugin_mermaid-collab_mermaid';

/**
 * Agent-profile registry (PCS Phase 3). A todo's `type` resolves to a profile
 * that parameterizes the worker launch: which tools, which model, which skill,
 * and the runtime permission mode. Keep this SMALL — vary permissions via
 * `runtimeMode`, not bespoke tool strings. The taxonomy starts with the common
 * web-app roles + a `default` fallback; the Coordinator resolves a todo's type
 * → profile → launch params.
 *
 * `type` assignment (which profile a todo gets) is a separate concern: inferred
 * from a blueprint task's files at sync time (open-problem #8) and stored on the
 * task-graph entry, NOT on the generic todo schema. This module is just the
 * type→params lookup.
 */
export interface AgentProfile {
  /** Space-separated allowedTools string passed to the worker launch. */
  allowedTools: string;
  /** Optional model override (e.g. a cheaper model for mechanical work). */
  model?: string;
  /** Runtime permission mode for the worker's CLI. */
  runtimeMode?: RuntimeMode;
  /** Optional domain context injected into the worker's CLI as an appended
   *  system prompt (SEAM·collab). Lets a project declare "here's how to work in
   *  this repo" WITH the repo (.collab/project.json) so the worker starts warm —
   *  no cold start, no learning collab has to ship. Global profiles leave this
   *  unset; only a per-project manifest typically populates it. */
  contextPrompt?: string;
  /** Capability dimension (Profile L1) — the small GLOBAL taxonomy of what a
   *  worker is permitted to DO (tools / permissions / model behaviour),
   *  deliberately DECOUPLED from the routing `type` string (frontend/backend/…
   *  stay a pool-routing hint only). Omitted ⇒ the `edit` default; `headless` is
   *  never auto-selected. See {@link Capability}. */
  capability?: Capability;
}

export type AgentProfileType = 'default' | 'frontend' | 'backend' | 'api' | 'ui' | 'library';

/**
 * Capability layer (Profile L1, per e8fddf63). The ONLY thing worth a small
 * GLOBAL taxonomy is *capability* — the tools / permissions / model behaviour a
 * worker is granted — kept separate from the routing `type` (which is just a
 * pool-routing hint). Three capabilities cover the real axes:
 *
 *  - `edit`     — the default worker: Bash/Edit/Write/Read at runtimeMode=edit.
 *  - `reviewer` — read-only + review tools; cannot mutate the tree (read-only).
 *  - `headless` — opt-in `--dangerously-skip` (runtimeMode=bypass), permitted
 *                 ONLY when a caller explicitly trusts the run. Gated by
 *                 constraint 64f813bd ("no headless bypass by default"): it is
 *                 NEVER auto-selected — {@link resolveCapability} returns it only
 *                 when both named AND `allowHeadless` is passed.
 */
export type Capability = 'edit' | 'reviewer' | 'headless';

/** The launch params a capability grants — the same shape an AgentProfile carries
 *  for tools/permissions, so it can be merged over a routing profile. */
export interface CapabilitySpec {
  allowedTools: string;
  runtimeMode: RuntimeMode;
}

/** The default capability when none is explicitly requested. Stays `edit` — a
 *  worker must be able to do real work, and `headless` must never be the default. */
export const DEFAULT_CAPABILITY: Capability = 'edit';

/** The global capability registry: capability → tool/permission surface. This is
 *  intentionally tiny (three entries). Routing `type` does NOT appear here. */
export const CAPABILITIES: Record<Capability, CapabilitySpec> = {
  // The default worker: full edit surface.
  edit:     { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  // Read-only review: can read/search/run checks but never mutate the tree.
  reviewer: { allowedTools: `Bash Read Grep Glob ${MCP}`, runtimeMode: 'read-only' },
  // Trusted headless: bypass permissions. Same tools as edit; the difference is
  // the runtime mode. Only reachable via an explicit opt-in (see resolveCapability).
  headless: { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'bypass' },
};

/**
 * Resolve a requested capability INDEPENDENT of the routing type. Missing /
 * unknown ⇒ the `edit` default. `headless` is special: it is NEVER auto-selected
 * — even when explicitly named it is only honoured when the caller also passes
 * `allowHeadless: true` (the explicit-trust opt-in that satisfies constraint
 * 64f813bd "no headless bypass by default"); otherwise it falls back to `edit`.
 */
export function resolveCapability(
  requested?: string | null,
  opts?: { allowHeadless?: boolean },
): Capability {
  if (requested === 'reviewer') return 'reviewer';
  if (requested === 'headless') return opts?.allowHeadless ? 'headless' : DEFAULT_CAPABILITY;
  // 'edit', unknown, or missing → the default. `headless` is unreachable here, so
  // it can never be auto-selected from an arbitrary/inferred string.
  return DEFAULT_CAPABILITY;
}

/** The launch params for a resolved capability. */
export function capabilitySpec(capability: Capability): CapabilitySpec {
  return CAPABILITIES[capability];
}

/**
 * The registry. `default` (≈ "full") is the fallback. Domain profiles narrow the
 * tool surface where it makes sense; all can edit + run since a worker must do
 * real work (vary hard limits via runtimeMode, not by removing Edit/Write).
 */
export const AGENT_PROFILES: Record<AgentProfileType, AgentProfile> = {
  default:  { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  frontend: { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  backend:  { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  api:      { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  ui:       { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  library:  { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
};

export const DEFAULT_PROFILE_TYPE: AgentProfileType = 'default';

/** Resolve a todo `type` to its profile. Unknown/missing types fall back to `default`.
 *
 *  When `project` is given, the project's `.collab/project.json` manifest is
 *  consulted and any profile it declares for `type` is MERGED OVER the global
 *  hard-coded profile (manifest fields win; omitted fields keep the global). This
 *  is how a project ships its own profile (e.g. build123d's `cad`) without collab
 *  knowing anything about it. The no-manifest / no-project path returns the exact
 *  global profile object by reference (callers + tests rely on that identity). */
export function resolveProfile(
  type?: string | null,
  project?: string,
  capability?: Capability,
): AgentProfile {
  const baseProfile = (type && type in AGENT_PROFILES)
    ? AGENT_PROFILES[type as AgentProfileType]
    : AGENT_PROFILES[DEFAULT_PROFILE_TYPE];
  const override = project ? manifestProfile(project, type) : null;
  // Identity contract: with no manifest override AND no capability requested, the
  // routing-type path returns the exact global profile object by reference
  // (callers + tests rely on that identity). Only build a new object when a
  // manifest override or an explicit capability actually changes something.
  if (!override && !capability) return baseProfile;
  // Merge: manifest fields override the global base; undefined fields keep base.
  const merged: AgentProfile = {
    allowedTools: override?.allowedTools ?? baseProfile.allowedTools,
    model: override?.model ?? baseProfile.model,
    runtimeMode: override?.runtimeMode ?? baseProfile.runtimeMode,
    contextPrompt: override?.contextPrompt ?? baseProfile.contextPrompt,
  };
  // Capability (Profile L1) is decoupled from the routing type: when requested it
  // dictates the tool/permission surface, layered OVER whatever the type+manifest
  // produced. This is what lets `reviewer`/`headless` apply to ANY routing type.
  if (capability) {
    const spec = CAPABILITIES[capability];
    merged.allowedTools = spec.allowedTools;
    merged.runtimeMode = spec.runtimeMode;
    merged.capability = capability;
  }
  return merged;
}

/**
 * Path-rules: infer a profile type from a task's touched files (open-problem #8).
 * Ordered, first-match-wins per file. If the files map to MORE THAN ONE domain,
 * the task spans domains → `default` (full). No files / no match → `default`.
 */
const PATH_RULES: Array<{ type: AgentProfileType; test: RegExp }> = [
  { type: 'ui', test: /\.(tsx|jsx|css|scss)$|(^|\/)(ui|components|views|pages)\// },
  { type: 'frontend', test: /(^|\/)(ui|web|client|frontend)\// },
  { type: 'api', test: /(^|\/)(routes|api|controllers|endpoints)\/|\.route\.|\bapi\b/ },
  { type: 'backend', test: /(^|\/)(services|server|backend|db|models|migrations)\//i },
  { type: 'library', test: /(^|\/)(lib|libs|packages|shared|utils|common)\// },
];

export function inferProfileType(files: string[] | undefined | null): AgentProfileType {
  if (!files || files.length === 0) return DEFAULT_PROFILE_TYPE;
  const matched = new Set<AgentProfileType>();
  for (const f of files) {
    for (const rule of PATH_RULES) {
      if (rule.test.test(f)) { matched.add(rule.type); break; } // first-match-wins per file
    }
  }
  if (matched.size === 1) return [...matched][0];
  return DEFAULT_PROFILE_TYPE; // multi-domain or unmatched → full
}
