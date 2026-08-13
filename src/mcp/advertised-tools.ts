/**
 * MCP Tool Registry and Advertisement Order
 *
 * Exports GROUP_REGISTRY (named tool groups), ADVERTISED_ORDER (the exact tool sequence
 * as originally advertised in setup.ts), and buildAdvertisedTools (resolves the order
 * against a groups map, throwing on unresolved names).
 *
 * This module moves the complex interlaced tool-spreading logic from setup.ts's
 * ListToolsRequestSchema handler into a declarative data structure + resolver,
 * pinning the sequence by construction while avoiding hardcoded indices.
 */

import { requestUserInputSchema } from './tools/request-user-input.js';
import { notifyToolListChanged } from './tool-registry-notifier.js';

// Lazy imports to avoid circular dependency issues at module load time
let _groupRegistry: Record<string, Array<{ name: string; [k: string]: any }>> | null = null;

function getGroupRegistry(): Record<string, Array<{ name: string; [k: string]: any }>> {
  if (_groupRegistry) return _groupRegistry;

  // Lazy load all TOOL_DEFS to avoid circular imports
  // These are imported here (not at module top) so they're only loaded on first access
  const MISSION_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./mission-tools.js');
    return m.MISSION_TOOL_DEFS;
  })();
  const WORKGRAPH_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./workgraph-tools.js');
    return m.WORKGRAPH_TOOL_DEFS;
  })();
  const SNIPPET_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./snippet-tools.js');
    return m.SNIPPET_TOOL_DEFS;
  })();
  const EMBED_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./embed-tools.js');
    return m.EMBED_TOOL_DEFS;
  })();
  const IMAGE_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./image-tools.js');
    return m.IMAGE_TOOL_DEFS;
  })();
  const ARTIFACT_SEND_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./artifact-send-tools.js');
    return m.ARTIFACT_SEND_TOOL_DEFS;
  })();
  const DOCUMENT_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./document-tools.js');
    return m.DOCUMENT_TOOL_DEFS;
  })();
  const BROWSER_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./browser-tools.js');
    return m.BROWSER_TOOL_DEFS;
  })();
  const SPREADSHEET_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./spreadsheet-tools.js');
    return m.SPREADSHEET_TOOL_DEFS;
  })();
  const DIAGRAM_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./diagram-tools.js');
    return m.DIAGRAM_TOOL_DEFS;
  })();
  const DESIGN_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./design-tools.js');
    return m.DESIGN_TOOL_DEFS;
  })();
  const SUPERVISOR_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./supervisor-tools.js');
    return m.SUPERVISOR_TOOL_DEFS;
  })();
  const EPIC_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./epic-tools.js');
    return m.EPIC_TOOL_DEFS;
  })();
  const DECISION_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./decision-tools.js');
    return m.DECISION_TOOL_DEFS;
  })();
  const SYSTEM_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./system-tools.js');
    return m.SYSTEM_TOOL_DEFS;
  })();
  const SESSION_TOOL_DEFS = (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('./session-tools.js');
    return m.SESSION_TOOL_DEFS;
  })();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const desktopToolsMod = require('./desktop-tools.js');

  _groupRegistry = {
    SESSION: SESSION_TOOL_DEFS,
    DIAGRAM: DIAGRAM_TOOL_DEFS,
    DOCUMENT: DOCUMENT_TOOL_DEFS,
    DESIGN: DESIGN_TOOL_DEFS,
    SYSTEM: SYSTEM_TOOL_DEFS,
    BROWSER: BROWSER_TOOL_DEFS,
    get DESKTOP() {
      return desktopToolsMod.getDesktopToolDefs();
    },
    SUPERVISOR: SUPERVISOR_TOOL_DEFS,
    EPIC: EPIC_TOOL_DEFS,
    DECISION: DECISION_TOOL_DEFS,
    MISSION: MISSION_TOOL_DEFS,
    WORKGRAPH: WORKGRAPH_TOOL_DEFS,
    SPREADSHEET: SPREADSHEET_TOOL_DEFS,
    SNIPPET: SNIPPET_TOOL_DEFS,
    EMBED: EMBED_TOOL_DEFS,
    IMAGE: IMAGE_TOOL_DEFS,
    ARTIFACT_SEND: ARTIFACT_SEND_TOOL_DEFS,
  };

  return _groupRegistry;
}

export function invalidateAdvertisedToolsCache(): void {
  _groupRegistry = null;
  notifyToolListChanged('advertised-tools-cache-invalidated');
}

/**
 * Map of group label to its tool definitions array.
 * Labels match the module export names (e.g., 'SESSION', 'MISSION', 'EPIC').
 * Lazy-initialized on first access to avoid circular import issues.
 */
export const GROUP_REGISTRY = new Proxy({}, {
  get(target, prop) {
    const registry = getGroupRegistry();
    return (registry as any)[prop];
  },
}) as Record<string, Array<{ name: string; [k: string]: any }>>;

/**
 * An OrderEntry describes how a tool or group appears in the advertised sequence:
 * - {group: string, name: string}: resolve ONE named tool from the group
 * - {group: string}: expand the ENTIRE group in array order (no name key)
 * - {name, description, inputSchema, ...}: a literal tool def (no group key)
 */
export type OrderEntry =
  | { group: string; name: string }
  | { group: string }
  | { name: string; description: string; inputSchema: any; [k: string]: any };

/**
 * The exact advertised tool order from setup.ts ListToolsRequestSchema handler,
 * transcribed from lines 204-265. Preserved byte-and-order identical via the
 * snapshot test; when buildAdvertisedTools() is called, it emits the same
 * tool-name sequence the original spreads did.
 */
export const ADVERTISED_ORDER: OrderEntry[] = [
  { group: 'SESSION', name: 'generate_session_name' },
  { group: 'SESSION', name: 'get_datetime' },
  { group: 'SESSION', name: 'list_sessions' },
  { group: 'SESSION', name: 'recommend_session_cleanup' },
  { group: 'SESSION', name: 'list_projects' },
  { group: 'SESSION', name: 'register_project' },
  { group: 'SESSION', name: 'unregister_project' },
  { group: 'DIAGRAM' },
  { group: 'DOCUMENT' },
  { group: 'SESSION', name: 'generate_session_summary' },
  { group: 'SESSION', name: 'validate_session_links' },
  { group: 'DESIGN' },
  { group: 'SESSION', name: 'render_ui' },
  { group: 'SESSION', name: 'update_ui' },
  { group: 'SESSION', name: 'dismiss_ui' },
  {
    name: 'request_user_input',
    description: 'Ask the user a question and wait for their response. Returns the user-provided value.',
    inputSchema: requestUserInputSchema,
  },
  { group: 'SESSION', name: 'get_ui_response' },
  { group: 'SESSION', name: 'register_claude_session' },
  { group: 'SYSTEM', name: 'check_server_health' },
  { group: 'SYSTEM', name: 'fleet_status' },
  { group: 'SESSION', name: 'get_install_path' },
  { group: 'SESSION', name: 'clear_session_artifacts' },
  { group: 'SESSION', name: 'archive_session' },
  { group: 'SESSION', name: 'archive_by_prefix' },
  { group: 'SESSION', name: 'consult_grok' },
  { group: 'SESSION', name: 'consult_codex' },
  { group: 'BROWSER' },
  { group: 'DESKTOP' },
  { group: 'SESSION', name: 'update_task_status' },
  { group: 'SESSION', name: 'update_tasks_status' },
  { group: 'SESSION', name: 'get_task_graph' },
  { group: 'SESSION', name: 'sync_task_graph' },
  { group: 'SESSION', name: 'add_lesson' },
  { group: 'SESSION', name: 'list_lessons' },
  { group: 'SESSION', name: 'record_friction' },
  { group: 'SESSION', name: 'list_friction' },
  { group: 'SESSION', name: 'retract_friction' },
  { group: 'SESSION', name: 'report_dogfood' },
  { group: 'SESSION', name: 'list_session_todos' },
  { group: 'SESSION', name: 'update_session_todo' },
  { group: 'SESSION', name: 'toggle_session_todo' },
  { group: 'SESSION', name: 'remove_session_todo' },
  { group: 'SESSION', name: 'clear_completed_session_todos' },
  { group: 'SESSION', name: 'reorder_session_todos' },
  { group: 'SESSION', name: 'complete_linked_todos' },
  { group: 'SESSION', name: 'assign_session_todo' },
  { group: 'SUPERVISOR', name: 'supervisor_list_supervised' },
  { group: 'SUPERVISOR', name: 'supervisor_nudge' },
  { group: 'SUPERVISOR', name: 'supervisor_reconcile' },
  { group: 'SUPERVISOR', name: 'read_last_assistant_turn' },
  { group: 'SUPERVISOR', name: 'escalation_list' },
  { group: 'SUPERVISOR', name: 'escalation_history' },
  { group: 'SUPERVISOR', name: 'escalation_resolve' },
  { group: 'EPIC', name: 'land_epic' },
  { group: 'SYSTEM', name: 'deploy_self' },
  { group: 'SUPERVISOR', name: 'escalation_create' },
  { group: 'SUPERVISOR', name: 'await_human_decision' },
  { group: 'SUPERVISOR', name: 'supervisor_next_decision' },
  { group: 'SUPERVISOR', name: 'supervisor_resolve_decision' },
  { group: 'SUPERVISOR', name: 'subscribe' },
  { group: 'SUPERVISOR', name: 'unsubscribe' },
  { group: 'SUPERVISOR', name: 'update_zen_summary' },
  { group: 'SUPERVISOR', name: 'list_subscriptions' },
  { group: 'EPIC', name: 'inbox' },
  { group: 'EPIC', name: 'get_todo' },
  { group: 'EPIC', name: 'complete_todo' },
  { group: 'EPIC', name: 'gate_status' },
  { group: 'EPIC', name: 'invariant_check' },
  { group: 'EPIC', name: 'epic_branch_status' },
  { group: 'EPIC', name: 'epic_land_readiness' },
  { group: 'EPIC', name: 'land_telemetry_report' },
  { group: 'EPIC', name: 'verify_epic' },
  { group: 'EPIC', name: 'forward_integrate_epic' },
  { group: 'SYSTEM', name: 'instance_topology' },
  { group: 'SYSTEM', name: 'launch_remote_server' },
  { group: 'SYSTEM', name: 'orchestrator_off' },
  { group: 'SYSTEM', name: 'friction_trends' },
  { group: 'EPIC', name: 'reset_todo' },
  { group: 'EPIC', name: 'override_accept_todo' },
  { group: 'EPIC', name: 'settle_dup_of_landed' },
  { group: 'EPIC', name: 'edit_contract_field' },
  { group: 'EPIC', name: 'edit_leaf_requirement' },
  { group: 'EPIC', name: 'create_gate' },
  { group: 'SUPERVISOR', name: 'checkpoint_ready' },
  { group: 'SUPERVISOR', name: 'supervisor_clear_session' },
  {
    name: 'submit_reconcile_result',
    description: 'A reconcile session reports its merged plan graph back to the waiting reconciliation request. Call this at the END of the reconcile skill with the id you were given.',
    inputSchema: {
      type: 'object',
      properties: {
        reconcileId: { type: 'string' },
        mergedGraph: { type: 'array', description: 'The merged PlanNode[] ({id, dependsOn[], parentId?, title?}).', items: { type: 'object' } },
        newConstraints: { type: 'array', description: 'Optional new constraints surfaced by the merge ({title, rationale?}).', items: { type: 'object' } },
      },
      required: ['reconcileId', 'mergedGraph'],
    },
  },
  { group: 'DECISION', name: 'create_decision_record' },
  { group: 'DECISION', name: 'list_decision_records' },
  { group: 'DECISION', name: 'approve_decision_record' },
  { group: 'DECISION', name: 'supersede_decision_record' },
  { group: 'DECISION', name: 'get_active_constraints' },
  { group: 'DECISION', name: 'get_active_requirements' },
  { group: 'DECISION', name: 'spec_coverage' },
  { group: 'DECISION', name: 'cartographer_health' },
  { group: 'DECISION', name: 'cartographer_sync' },
  { group: 'DECISION', name: 'list_system_objects' },
  { group: 'DECISION', name: 'system_object_bom' },
  { group: 'DECISION', name: 'decide_requirement' },
  { group: 'SUPERVISOR', name: 'supervisor_pause' },
  { group: 'SUPERVISOR', name: 'supervisor_resume' },
  { group: 'SUPERVISOR', name: 'supervisor_pause_status' },
  { group: 'DECISION', name: 'check_graph_drift' },
  { group: 'SUPERVISOR', name: 'supervisor_audit_list' },
  { group: 'SYSTEM', name: 'orchestrator_status' },
  { group: 'SYSTEM', name: 'system_status' },
  { group: 'SYSTEM', name: 'daemon_status' },
  { group: 'EPIC', name: 'leaf_inspect' },
  { group: 'EPIC', name: 'leaf_failures' },
  { group: 'EPIC', name: 'adopt_branch_as_epic' },
  { group: 'EPIC', name: 'invalidate_base_gate' },
  { group: 'EPIC', name: 'mutation_probe' },
  { group: 'SYSTEM', name: 'runtime_config' },
  { group: 'SYSTEM', name: 'set_watchdog_threshold' },
  { group: 'SYSTEM', name: 'set_context_recycle' },
  { group: 'SUPERVISOR', name: 'supervisor_watchdog_scan' },
  { group: 'SUPERVISOR', name: 'set_node_profile_override' },
  { group: 'SUPERVISOR', name: 'get_bridge_snapshot' },
  { group: 'SUPERVISOR', name: 'escalation_get' },
  { group: 'MISSION' },
  { group: 'WORKGRAPH' },
  { group: 'SYSTEM', name: 'context_usage' },
  { group: 'SYSTEM', name: 'list_conductor_passes' },
  { group: 'SYSTEM', name: 'get_job' },
  { group: 'SYSTEM', name: 'host_load' },
  { group: 'SPREADSHEET' },
  { group: 'SNIPPET' },
  { group: 'EMBED' },
  { group: 'IMAGE' },
  { group: 'SESSION', name: 'deprecate_artifact' },
  { group: 'SESSION', name: 'set_artifact_metadata' },
  { group: 'ARTIFACT_SEND', name: 'send_artifact' },
];

/**
 * Resolve ADVERTISED_ORDER against a groups map, emitting tools by name and expanding
 * group-only entries.
 *
 * @param groups - Override GROUP_REGISTRY for testing (e.g., with reordered arrays)
 * @returns { tools: ToolDef[] } matching the MCP handler's return shape
 * @throws Error if a {group, name} entry's tool is not found in the group
 */
export function buildAdvertisedTools(groups: typeof GROUP_REGISTRY = GROUP_REGISTRY): { tools: any[] } {
  const tools: any[] = [];

  for (const entry of ADVERTISED_ORDER) {
    if ('inputSchema' in entry && !('group' in entry)) {
      // Literal tool def (request_user_input or submit_reconcile_result)
      tools.push(entry);
    } else if ('name' in entry) {
      // Named tool: resolve from group
      const groupEntry = entry as { group: string; name: string };
      const groupDefs = groups[groupEntry.group];
      if (!groupDefs) {
        throw new Error(`buildAdvertisedTools: group "${groupEntry.group}" not found in groups registry`);
      }
      const toolDef = groupDefs.find((d) => d.name === groupEntry.name);
      if (!toolDef) {
        throw new Error(`buildAdvertisedTools: tool "${groupEntry.name}" not found in group "${groupEntry.group}"`);
      }
      tools.push(toolDef);
    } else {
      // Group-only entry: expand all defs in that group
      const groupEntry = entry as { group: string };
      const groupDefs = groups[groupEntry.group];
      if (!groupDefs) {
        throw new Error(`buildAdvertisedTools: group "${groupEntry.group}" not found in groups registry`);
      }
      tools.push(...groupDefs);
    }
  }

  return { tools };
}
