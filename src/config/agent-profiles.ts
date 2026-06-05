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
}

export type AgentProfileType = 'default' | 'frontend' | 'backend' | 'api' | 'ui' | 'library';

// Allow ALL mermaid MCP tools without per-tool prompts. The server is registered
// as `mermaid` in the project .mcp.json (tools are mcp__mermaid__*), so the
// server-level `mcp__mermaid` token is what actually matches a spawned worker's
// tool calls (get_todo/complete_todo/etc.). The plugin-namespaced form is kept as
// a belt-and-suspenders match for contexts where the server is namespaced.
const MCP = 'mcp__mermaid mcp__plugin_mermaid-collab_mermaid';

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
export function resolveProfile(type?: string | null, project?: string): AgentProfile {
  const base = (type && type in AGENT_PROFILES)
    ? AGENT_PROFILES[type as AgentProfileType]
    : AGENT_PROFILES[DEFAULT_PROFILE_TYPE];
  if (!project) return base;
  const override = manifestProfile(project, type);
  if (!override) return base;
  // Merge: manifest fields override the global base; undefined fields keep base.
  return {
    allowedTools: override.allowedTools ?? base.allowedTools,
    model: override.model ?? base.model,
    runtimeMode: override.runtimeMode ?? base.runtimeMode,
    contextPrompt: override.contextPrompt ?? base.contextPrompt,
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
