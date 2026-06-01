import type { RuntimeMode } from '../agent/contracts';

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
}

export type AgentProfileType = 'default' | 'frontend' | 'backend' | 'api' | 'ui' | 'library';

const MCP = 'mcp__plugin_mermaid-collab_mermaid';

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

/** Resolve a todo `type` to its profile. Unknown/missing types fall back to `default`. */
export function resolveProfile(type?: string | null): AgentProfile {
  if (type && type in AGENT_PROFILES) return AGENT_PROFILES[type as AgentProfileType];
  return AGENT_PROFILES[DEFAULT_PROFILE_TYPE];
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
