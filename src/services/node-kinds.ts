/** Orchestration node registry — forge/conductor/planner. These run ABOVE the per-leaf
 *  pipeline (not per-leaf) and are deliberately kept OUT of LeafNodeKind/LEAF_NODE_KINDS
 *  (leaf-executor.ts) so they never participate in the leaf pipeline's per-kind dispatch. */
import type { EffortLevel } from '../agent/contracts';

export type OrchestrationNodeKind = 'forge' | 'conductor' | 'planner';

export const ORCHESTRATION_NODE_KINDS: OrchestrationNodeKind[] = ['forge', 'conductor', 'planner'];

export const ORCHESTRATION_NODE_PROFILE: Record<OrchestrationNodeKind, { model: string; allowedTools: string; effort: EffortLevel }> = {
  forge: { model: 'opus', allowedTools: 'Read Grep Glob Bash', effort: 'high' },
  conductor: {
    model: 'opus',
    allowedTools: [
      'Read', 'Grep', 'Glob', 'Bash',
      'mcp__mermaid__get_mission', 'mcp__mermaid__get_task_graph', 'mcp__mermaid__get_todo',
      'mcp__mermaid__plan_mission_criterion', 'mcp__mermaid__file_to_bucket',
      'mcp__mermaid__set_mission_criterion', 'mcp__mermaid__add_mission_criterion',
      'mcp__mermaid__escalation_list', 'mcp__mermaid__epic_land_readiness', 'mcp__mermaid__verify_epic',
      'mcp__mermaid__land_epic', 'mcp__mermaid__consult_grok',
      // Stuck-build awareness + authority to break a retry loop: read a todo's
      // build attempts (leaf_inspect), park a repeatedly-failing todo (reset_todo —
      // the conductor is the in-server reset authority), and close a handled card.
      'mcp__mermaid__leaf_inspect', 'mcp__mermaid__reset_todo', 'mcp__mermaid__escalation_resolve',
    ].join(' '),
    effort: 'high',
  },
  planner: {
    model: 'opus',
    allowedTools: 'Read Grep Glob Bash mcp__mermaid__get_task_graph mcp__mermaid__get_todo mcp__mermaid__get_mission',
    effort: 'high',
  },
};

export const ORCHESTRATION_NODE_DESCRIPTIONS: Record<OrchestrationNodeKind, string> = {
  forge: "Derives a mission's acceptance criteria from a design doc.",
  conductor: 'Drives a mission to done — plans, builds, verifies, lands.',
  planner: 'Decomposes a mission criterion into one epic and its leaves.',
};
