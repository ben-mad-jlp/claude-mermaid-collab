import type { RuntimeMode } from '../agent/contracts';
import { manifestProfile, inferTypeFromManifest } from './project-manifest';

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
  /** What the worker is ALLOWED to do — tools/permissions/model behaviour — as a
   *  small global taxonomy, decoupled from the routing `type`. The routing `type`
   *  (frontend/backend/…) is only a pool-placement hint; `capability` is the real
   *  permission axis. Omitted → resolves to the default (`edit`). See
   *  {@link Capability} / {@link resolveCapability}. */
  capability?: Capability;
}

export type AgentProfileType = 'default' | 'frontend' | 'backend' | 'api' | 'ui' | 'library';

/**
 * Capability — the ONE small global taxonomy worth having (per e8fddf63): what a
 * worker is allowed to do (tools / permissions / model behaviour), kept strictly
 * SEPARATE from the routing `type` string. A todo's `type` (frontend/backend/…)
 * only hints which pool runs it; its `capability` decides what it can touch.
 *
 *  - `edit`     — the default worker: full edit surface (Bash/Edit/Write/Read +
 *                 MCP) at `runtimeMode: 'edit'`.
 *  - `reviewer` — read-only: review/inspection tools, no Edit/Write/Bash,
 *                 `runtimeMode: 'read-only'`.
 *  - `headless` — opt-in bypass (`--dangerously-skip-permissions`,
 *                 `runtimeMode: 'bypass'`). Gated by constraint 64f813bd
 *                 ("no headless bypass by default"): NEVER auto-selected — only
 *                 resolves when explicitly requested AND marked trusted.
 */
export type Capability = 'edit' | 'reviewer' | 'headless';

export const DEFAULT_CAPABILITY: Capability = 'edit';

// Allow ALL mermaid MCP tools without per-tool prompts. The server is registered
// as `mermaid` in the project .mcp.json (tools are mcp__mermaid__*), so the
// server-level `mcp__mermaid` token is what actually matches a spawned worker's
// tool calls (get_todo/complete_todo/etc.). The plugin-namespaced form is kept as
// a belt-and-suspenders match for contexts where the server is namespaced.
const MCP = 'mcp__mermaid mcp__plugin_mermaid-collab_mermaid';

// Pre-authorize the collab system's OWN skills so an autonomous worker never
// stalls on a "Use skill mermaid-collab:…?" permission prompt (the dominant cause
// of wedged workers, observed live: 3/3 workers frozen 20-40min on the vibe-active
// prompt, holding their slots). Surgical, not a blanket bypass — only the trusted
// first-party collab skills are allowed; arbitrary tools still gate per
// runtimeMode. Honors constraint 64f813bd (no headless bypass by default).
const SKILLS = 'Skill(mermaid-collab:*)';

/**
 * The registry. `default` (≈ "full") is the fallback. Domain profiles narrow the
 * tool surface where it makes sense; all can edit + run since a worker must do
 * real work (vary hard limits via runtimeMode, not by removing Edit/Write).
 */
export const AGENT_PROFILES: Record<AgentProfileType, AgentProfile> = {
  default:  { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
  frontend: { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
  backend:  { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
  api:      { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
  ui:       { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
  library:  { allowedTools: `Bash Edit Write Read ${MCP} ${SKILLS}`, runtimeMode: 'edit' },
};

export const DEFAULT_PROFILE_TYPE: AgentProfileType = 'default';

/**
 * Capability registry — maps each capability to the launch params it grants.
 * This is the permission axis, independent of the routing `type` table above.
 * `headless` carries the bypass runtimeMode; whether it is ever *selected* is
 * gated separately in {@link resolveCapability} (constraint 64f813bd).
 */
export const CAPABILITIES: Record<Capability, Pick<AgentProfile, 'allowedTools' | 'runtimeMode'>> = {
  edit:     { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'edit' },
  reviewer: { allowedTools: `Read Grep Glob ${MCP}`, runtimeMode: 'read-only' },
  headless: { allowedTools: `Bash Edit Write Read ${MCP}`, runtimeMode: 'bypass' },
};

/**
 * Resolve a worker's capability — independent of its routing `type`. Unknown or
 * missing requests fall back to {@link DEFAULT_CAPABILITY} (`edit`).
 *
 * `headless` is NEVER auto-selected (constraint 64f813bd "no headless bypass by
 * default"): it resolves ONLY when explicitly requested AND `opts.trusted` is
 * true. A `headless` request without trust is downgraded to `edit`.
 */
export function resolveCapability(
  requested?: string | null,
  opts?: { trusted?: boolean; allowHeadless?: boolean },
): Capability {
  if (requested === 'reviewer') return 'reviewer';
  if (requested === 'headless') {
    // headless requires an explicit trust opt-in (either is accepted) — never auto.
    const trusted = opts?.trusted === true || opts?.allowHeadless === true;
    return trusted ? 'headless' : 'edit';
  }
  return DEFAULT_CAPABILITY;
}

/** Look up the launch params (tools + runtimeMode) granted by a capability. */
export function capabilitySpec(capability: Capability): Pick<AgentProfile, 'allowedTools' | 'runtimeMode'> {
  return CAPABILITIES[capability];
}

/** Resolve a todo `type` to its profile. Unknown/missing types fall back to `default`.
 *
 *  When `project` is given, the project's `.collab/project.json` manifest is
 *  consulted and any profile it declares for `type` is MERGED OVER the global
 *  hard-coded profile (manifest fields win; omitted fields keep the global). This
 *  is how a project ships its own profile (e.g. build123d's `cad`) without collab
 *  knowing anything about it. The no-manifest / no-project path returns the exact
 *  global profile object by reference (callers + tests rely on that identity). */
export function resolveProfile(type?: string | null, project?: string, capability?: Capability): AgentProfile {
  const base = (type && type in AGENT_PROFILES)
    ? AGENT_PROFILES[type as AgentProfileType]
    : AGENT_PROFILES[DEFAULT_PROFILE_TYPE];
  // An explicit, already-trust-resolved capability applies OVER any routing type:
  // it brings the capability's own tool surface + runtimeMode (reviewer ⇒ read-only,
  // headless ⇒ bypass). Decoupled from the manifest path below; the no-capability
  // no-project call still returns the global object by reference (identity tests).
  if (capability) return { ...base, ...capabilitySpec(capability), capability };
  if (!project) return base;
  const override = manifestProfile(project, type);
  if (!override) return base;
  // Merge: manifest fields override the global base; undefined fields keep base.
  // Capability is resolved independently of the routing `type` and defaults to
  // `edit`; `headless` only takes effect if the manifest also marks it trusted
  // (constraint 64f813bd — no headless bypass by default).
  const resolvedCap = resolveCapability(override.capability, { trusted: override.trusted });
  return {
    allowedTools: override.allowedTools ?? base.allowedTools,
    model: override.model ?? base.model,
    runtimeMode: override.runtimeMode ?? base.runtimeMode,
    contextPrompt: override.contextPrompt ?? base.contextPrompt,
    capability: resolvedCap,
  };
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
