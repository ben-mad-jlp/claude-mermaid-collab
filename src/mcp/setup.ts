/**
 * MCP Server Setup
 *
 * Shared MCP server configuration used by both stdio and HTTP transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { dismissUI, dismissUISchema } from './tools/dismiss-ui.js';
import {
  requestUserInput,
  requestUserInputSchema,
  type RequestUserInputArgs,
} from './tools/request-user-input.js';
import { userInputBridge } from '../agent/user-input-bridge.js';
import { getAgentRegistry } from '../agent/agent-registry-manager.js';
import { updateUI, updateUISchema } from './tools/update-ui.js';
import { renderUISchema } from './tools/render-ui.js';
import { ToolRegistry, type ToolCtx } from './tools/registry.js';
import { API_BASE_URL, buildUrl, asJson, type AnyJson, sessionParamsDesc, apiFetch } from './tools/http-util.js';
// NOTE: the registry refactor (6066b12a) extracted byte-identical copies of the
// document handlers into ./tools/documents.ts, but the originals below are still
// the ones wired into the dispatch switch. Importing them too caused a duplicate
// declaration conflict on the integration merge; keep the working locals and don't
// import the extracted copies. Completing the extraction (route through the module,
// derive ListTools from documentToolDefs) stays tracked under 6066b12a.
import {
  getSessionState,
  updateSessionState,
  archiveSession,
} from './tools/collab-state.js';
import {
  handleListProjects,
  handleRegisterProject,
  handleUnregisterProject,
  listProjectsSchema,
  registerProjectSchema,
  unregisterProjectSchema,
} from './tools/projects.js';
import { getWebSocketHandler } from '../services/ws-handler-manager.js';
import { projectRegistry } from '../services/project-registry.js';
import * as supervisorStore from '../services/supervisor-store.js';
import { resolveReconcile } from '../services/planner-reconcile-live.js';
import { SERVER_VERSION } from './server.js';
import { getTodo, completeGatesForDecision, deriveTodoViews } from '../services/todo-store.js';
import { MISSION_TOOL_DEFS, handleMissionTool } from './mission-tools.js';
import { WORKGRAPH_TOOL_DEFS, handleWorkgraphTool } from './workgraph-tools.js';
import { SNIPPET_TOOL_DEFS, handleSnippetTool } from './snippet-tools.js';
import { EMBED_TOOL_DEFS, handleEmbedTool } from './embed-tools.js';
import { IMAGE_TOOL_DEFS, handleImageTool } from './image-tools.js';
import {
  DOCUMENT_TOOL_DEFS, handleDocumentTool,
  listDocuments, getDocument, createDocument,
} from './document-tools.js';
import { coerceArrayArg } from './arg-coercion.js';
import { BROWSER_TOOL_DEFS, handleBrowserTool } from './browser-tools.js';
import { SPREADSHEET_TOOL_DEFS, handleSpreadsheetTool, listSpreadsheets } from './spreadsheet-tools.js';
import {
  DIAGRAM_TOOL_DEFS, handleDiagramTool,
  listDiagrams, getDiagram, createDiagram,
} from './diagram-tools.js';
import { DESIGN_TOOL_DEFS, handleDesignTool } from './design-tools.js';
import { SUPERVISOR_TOOL_DEFS, handleSupervisorTool } from './supervisor-tools.js';
import { EPIC_TOOL_DEFS, handleEpicTool } from './epic-tools.js';
import { DECISION_TOOL_DEFS, handleDecisionTool } from './decision-tools.js';
import { SYSTEM_TOOL_DEFS, handleSystemTool } from './system-tools.js';
import { SESSION_TOOL_DEFS, handleSessionTool } from './session-tools.js';
import { DESKTOP_TOOL_DEFS, handleDesktopTool } from './desktop-tools.js';
// BUG 7fb16985: orchestrator_status and system_status MUST derive running/level/
// projects from ONE source of truth. system_status reaches getOrchestratorHealth
// via system-status.js → './orchestrator-live.js'; the daemon lifecycle in
// server.ts starts it via './services/orchestrator-live.js'. orchestrator_status
// previously used a dynamic `await import(...'.js')` multi-path loop that, under
// Bun, could resolve a SECOND module record with its own `timer`/`lastTickAt`
// state — so the two tools disagreed (one saw running:false/[], the other
// running:true/level). Import the IDENTICAL specifier statically so both read the
// same module instance (same `timer`, same level rows).
import { getConfig } from '../services/config-service.js';
import {
  handleCreateSnippet,
  handleUpdateSnippet,
  handleGetSnippet,
  handleListSnippets,
  handleDeleteSnippet,
  handleExportSnippet,
} from './tools/snippet.js';
import {
  addLessonSchema,
  listLessonsSchema,
} from './tools/lessons.js';
import {
  recordFrictionSchema,
  listFrictionSchema,
  reportDogfoodSchema,
} from './tools/friction.js';
import {
  listSessionTodosSchema,
  updateSessionTodoSchema,
  toggleSessionTodoSchema,
  removeSessionTodoSchema,
  clearCompletedSessionTodosSchema,
  reorderSessionTodosSchema,
  completeLinkedTodosSchema,
  assignSessionTodoSchema,
} from './tools/session-todos.js';


// Configuration (API_BASE_URL, buildUrl, asJson, AnyJson, sessionParamsDesc
// now live in ./tools/http-util.js — imported above).

// SERVER_VERSION is imported from server.ts (single source of truth, synced by
// the `npm version` hook) — see the import near the top of this file.

// ============= Document Tools =============

/** Append a supervisor decision/action to the durable audit log AND broadcast a
 *  supervisor_decision WS event (for live UI + the System Map / observability). */
export function recordSupervisorDecision(kind: string, project: string, session: string, detail?: string | null, serverId?: string): void {
  try {
    const entry = supervisorStore.recordSupervisorAudit({ kind, project, session, detail, serverId });
    getWebSocketHandler()?.broadcast({ type: 'supervisor_decision', project, session, kind, detail: entry.detail, ts: entry.ts });
  } catch { /* audit must never break the action it records */ }
}

// ============= MCP Elicitation =============

// Pending MCP elicitation requests — keyed by elicitationId
const _pendingElicitations = new Map<string, {
  resolve: (values: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}>();

/** Resolve a pending MCP elicitation (called by dispatcher on agent_mcp_elicit_respond) */
export function resolveElicitation(elicitationId: string, values: Record<string, unknown>): boolean {
  const pending = _pendingElicitations.get(elicitationId);
  if (!pending) return false;
  _pendingElicitations.delete(elicitationId);
  pending.resolve(values);
  return true;
}

/** Create a pending MCP elicitation and return a promise that resolves when answered */
export function createElicitationRequest(
  elicitationId: string,
  timeoutMs = 300_000,
): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    _pendingElicitations.set(elicitationId, { resolve, reject });
    setTimeout(() => {
      if (_pendingElicitations.has(elicitationId)) {
        _pendingElicitations.delete(elicitationId);
        reject(new Error(`MCP elicitation ${elicitationId} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
  });
}

// ============= Server Setup =============

export async function setupMCPServer(): Promise<Server> {
  const server = new Server(
    { name: 'mermaid-diagram-server', version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Session params description (shared across tools)
  const sessionParamsDesc = {
    project: {
      type: 'string',
      description: 'Absolute path to the project root directory',
    },
    session: {
      type: 'string',
      description: 'Session name (e.g., "bright-calm-river").',
    },
  };

  // Resources - none currently registered
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    throw new Error(`Unknown resource: ${uri}`);
  });

  // Tools list
  // Every advertised tool def is now co-located with its handler in a domain
  // module (*_TOOL_DEFS). They are spread here at their ordinal positions; the
  // only literals left are request_user_input and submit_reconcile_result, which
  // have no owning module (their handlers live inline in this file). The order
  // below is pinned byte-and-order identical by list-tools-snapshot.test.ts.
  // NOTE: add_session_todo is intentionally NOT advertised (a deprecated
  // migration-guidance stub kept in SESSION_TOOL_DEFS only for its handler/error
  // path — see tool-defs-advertised-parity.test.ts DELIBERATELY_UNADVERTISED),
  // so SESSION_TOOL_DEFS is spread as slices/indices that skip index 32.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...SESSION_TOOL_DEFS.slice(0, 7),        // generate_session_name..unregister_project
      ...DIAGRAM_TOOL_DEFS,
      ...DOCUMENT_TOOL_DEFS,
      ...SESSION_TOOL_DEFS.slice(7, 9),        // generate_session_summary, validate_session_links
      ...DESIGN_TOOL_DEFS,
      ...SESSION_TOOL_DEFS.slice(9, 12),       // render_ui, update_ui, dismiss_ui
      {
        name: 'request_user_input',
        description: 'Ask the user a question and wait for their response. Returns the user-provided value.',
        inputSchema: requestUserInputSchema,
      },
      ...SESSION_TOOL_DEFS.slice(12, 14),      // get_ui_response, register_claude_session
      ...SYSTEM_TOOL_DEFS.slice(0, 2),         // check_server_health, fleet_status
      ...SESSION_TOOL_DEFS.slice(14, 18),      // get_install_path, clear_session_artifacts, archive_session, archive_by_prefix
      ...SESSION_TOOL_DEFS.slice(20, 22),      // consult_grok, consult_codex
      // Browser tools (CDP via VS Code debug session)
      ...BROWSER_TOOL_DEFS,
      // Desktop (Electron) tools — empty when electron-agent-bridge is absent
      ...DESKTOP_TOOL_DEFS,
      ...SESSION_TOOL_DEFS.slice(22, 29),      // update_task_status..record_friction
      SESSION_TOOL_DEFS[30],                   // list_friction (module order: report_dogfood before list_friction)
      SESSION_TOOL_DEFS[29],                   // report_dogfood
      SESSION_TOOL_DEFS[31],                   // list_session_todos
      ...SESSION_TOOL_DEFS.slice(33, 38),      // update/toggle/remove/clear/reorder_session_todos (skips add_session_todo@32)
      SESSION_TOOL_DEFS[39],                   // complete_linked_todos (module order: assign before complete)
      SESSION_TOOL_DEFS[38],                   // assign_session_todo
      ...SUPERVISOR_TOOL_DEFS.slice(0, 7),
      ...EPIC_TOOL_DEFS.slice(0, 1),           // land_epic
      SYSTEM_TOOL_DEFS[2],                     // deploy_self
      ...SUPERVISOR_TOOL_DEFS.slice(7, 15),
      ...EPIC_TOOL_DEFS.slice(1, 11),          // inbox..forward_integrate_epic
      SYSTEM_TOOL_DEFS[3],                     // instance_topology
      SYSTEM_TOOL_DEFS[4],                     // launch_remote_server
      SYSTEM_TOOL_DEFS[8],                     // orchestrator_off
      SYSTEM_TOOL_DEFS[7],                     // friction_trends
      ...EPIC_TOOL_DEFS.slice(11, 17),         // reset_todo..create_gate
      ...SUPERVISOR_TOOL_DEFS.slice(15, 17),   // checkpoint_ready, supervisor_clear_session
      { name: 'submit_reconcile_result', description: 'A reconcile session reports its merged plan graph back to the waiting reconciliation request. Call this at the END of the reconcile skill with the id you were given.', inputSchema: { type: 'object', properties: { reconcileId: { type: 'string' }, mergedGraph: { type: 'array', description: 'The merged PlanNode[] ({id, dependsOn[], parentId?, title?}).', items: { type: 'object' } }, newConstraints: { type: 'array', description: 'Optional new constraints surfaced by the merge ({title, rationale?}).', items: { type: 'object' } } }, required: ['reconcileId', 'mergedGraph'] } },
      ...DECISION_TOOL_DEFS.slice(0, 12),       // create_decision_record..decide_requirement
      ...SUPERVISOR_TOOL_DEFS.slice(17, 20),    // supervisor_pause, supervisor_resume, supervisor_pause_status
      DECISION_TOOL_DEFS[12],                   // check_graph_drift
      ...SUPERVISOR_TOOL_DEFS.slice(20, 21),    // supervisor_audit_list
      SYSTEM_TOOL_DEFS[10],                     // orchestrator_status
      SYSTEM_TOOL_DEFS[5],                      // system_status
      SYSTEM_TOOL_DEFS[6],                      // daemon_status
      ...EPIC_TOOL_DEFS.slice(17, 19),          // leaf_inspect, leaf_failures
      SYSTEM_TOOL_DEFS[9],                      // runtime_config
      ...SYSTEM_TOOL_DEFS.slice(11, 13),        // set_watchdog_threshold, set_context_recycle
      ...SUPERVISOR_TOOL_DEFS.slice(21, 23),    // supervisor_watchdog_scan, set_node_profile_override
      ...MISSION_TOOL_DEFS,
      ...WORKGRAPH_TOOL_DEFS,
      SYSTEM_TOOL_DEFS[13],                     // context_usage
      ...SPREADSHEET_TOOL_DEFS,
      ...SNIPPET_TOOL_DEFS,
      ...EMBED_TOOL_DEFS,
      ...IMAGE_TOOL_DEFS,
      ...SESSION_TOOL_DEFS.slice(18, 20),       // deprecate_artifact, set_artifact_metadata
    ],
  }));

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      // Tools that need to return a full CallToolResult (e.g. to set isError
      // based on runtime outcome rather than thrown errors) short-circuit here.
      if (name === 'request_user_input') {
        const registry = getAgentRegistry();
        if (!registry) {
          throw new Error('Agent registry not initialized');
        }
        const ruiArgs = (args ?? {}) as unknown as RequestUserInputArgs;
        const res = await requestUserInput(
          {
            bridge: userInputBridge,
            eventSink: {
              // Route through recordAndDispatch so the event is persisted via
              // EventLog AND broadcast to live WS subscribers (see review C3).
              emit: (ev) => { registry.recordAndDispatch(ev.sessionId, ev); },
            },
          },
          ruiArgs,
        );
        return res as any;
      }

      const result = await (async () => {
        // Mission tool group lives in ./mission-tools.ts; delegate by name.
        // Returns null for non-mission tools → fall through to the switch below.
        const missionResult = await handleMissionTool(name, args);
        if (missionResult !== null) return missionResult;

        // Work-graph constructor group lives in ./workgraph-tools.ts; delegate by name.
        // Returns null for non-workgraph tools → fall through to the switch below.
        const workgraphResult = await handleWorkgraphTool(name, args);
        if (workgraphResult !== null) return workgraphResult;

        // Snippet tool group lives in ./snippet-tools.ts; delegate by name.
        // Returns null for non-snippet tools → fall through to the switch below.
        const snippetResult = await handleSnippetTool(name, args);
        if (snippetResult !== null) return snippetResult;

        // Embed tool group lives in ./embed-tools.ts; delegate by name.
        const embedResult = await handleEmbedTool(name, args);
        if (embedResult !== null) return embedResult;

        // Image tool group lives in ./image-tools.ts; delegate by name.
        const imageResult = await handleImageTool(name, args);
        if (imageResult !== null) return imageResult;

        // Document tool group lives in ./document-tools.ts; delegate by name.
        const documentResult = await handleDocumentTool(name, args);
        if (documentResult !== null) return documentResult;

        // Browser tool group lives in ./browser-tools.ts; delegate by name.
        const browserResult = await handleBrowserTool(name, args);
        if (browserResult !== null) return browserResult;

        // Spreadsheet tool group lives in ./spreadsheet-tools.ts; delegate by name.
        const spreadsheetResult = await handleSpreadsheetTool(name, args);
        if (spreadsheetResult !== null) return spreadsheetResult;

        // Diagram tool group lives in ./diagram-tools.ts; delegate by name.
        const diagramResult = await handleDiagramTool(name, args);
        if (diagramResult !== null) return diagramResult;

        // Design tool group lives in ./design-tools.ts; delegate by name.
        const designResult = await handleDesignTool(name, args);
        if (designResult !== null) return designResult;

        // Supervisor tool group lives in ./supervisor-tools.ts; delegate by name.
        const supervisorResult = await handleSupervisorTool(name, args);
        if (supervisorResult !== null) return supervisorResult;

        // Epic-lifecycle tool group lives in ./epic-tools.ts; delegate by name.
        const epicResult = await handleEpicTool(name, args);
        if (epicResult !== null) return epicResult;

        // Decision/spec/cartographer tool group lives in ./decision-tools.ts; delegate by name.
        const decisionResult = await handleDecisionTool(name, args);
        if (decisionResult !== null) return decisionResult;

        // System/orchestrator/daemon status tool group lives in ./system-tools.ts; delegate by name.
        const systemResult = await handleSystemTool(name, args);
        if (systemResult !== null) return systemResult;

        // Session/project/todos/artifacts/UI/consult tool group lives in ./session-tools.ts; delegate by name.
        const sessionResult = await handleSessionTool(name, args);
        if (sessionResult !== null) return sessionResult;

        // Desktop (Electron) tool group lives in ./desktop-tools.ts; delegate by name.
        const desktopResult = await handleDesktopTool(name, args);
        if (desktopResult !== null) return desktopResult;
        switch (name) {
          case 'submit_reconcile_result': {
            const { reconcileId, mergedGraph, newConstraints } = args as { reconcileId: string; mergedGraph: unknown[]; newConstraints?: unknown[] };
            const coercedMergedGraph = coerceArrayArg(mergedGraph, 'mergedGraph');
            const coercedNewConstraints = coerceArrayArg(newConstraints, 'newConstraints');
            if (!reconcileId || !Array.isArray(coercedMergedGraph)) throw new Error('Missing required: reconcileId, mergedGraph');
            const accepted = resolveReconcile(reconcileId, { mergedGraph: coercedMergedGraph as any, newConstraints: coercedNewConstraints as any });
            return JSON.stringify({ accepted, reason: accepted ? undefined : 'no-pending-request (timed out or unknown id)' }, null, 2);
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      })();

      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
