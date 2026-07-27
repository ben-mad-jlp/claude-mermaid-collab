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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'generate_session_name',
        description: 'Generate a memorable session name (adjective-adjective-noun format). Use this when creating a new collab session.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_datetime',
        description: "Get the current date and time on the server. Returns ISO-8601 UTC, a human-readable local string, the IANA timezone, and epoch milliseconds. Use this to timestamp observations while monitoring a long-running process — so when fired events are reviewed later (e.g. overnight) the wall-clock time of each is visible.",
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_sessions',
        description: 'List registered collab sessions. Pass `project` to list only sessions in that project (e.g. to pick an assignee for cross-session todos); omit for all projects.',
        inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Absolute project path to filter sessions by (optional).' } } },
      },
      {
        name: 'recommend_session_cleanup',
        description: 'Recommend stale collab sessions for cleanup (read-only). Returns sessions idle longer than `days` (default 30) — excluding any that are live-bound to a running Claude PID or hold in-progress work. Each item carries an age + reason. Clean up a recommended session with archive_session (it copies artifacts to docs/designs/ then optionally deletes). This NEVER deletes anything itself.',
        inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Staleness window in days (default 30).' } } },
      },
      {
        name: 'list_projects',
        description: 'List all registered projects',
        inputSchema: listProjectsSchema,
      },
      {
        name: 'register_project',
        description: 'Register a new project',
        inputSchema: registerProjectSchema,
      },
      {
        name: 'unregister_project',
        description: 'Unregister a project (does not delete files)',
        inputSchema: unregisterProjectSchema,
      },
      ...DIAGRAM_TOOL_DEFS,
      ...DOCUMENT_TOOL_DEFS,
      // Session Summary
      {
        name: 'generate_session_summary',
        description: 'Generate a markdown document summarizing all artifacts (diagrams, documents, designs, spreadsheets) in the current session.',
        inputSchema: {
          type: 'object',
          properties: {
            ...sessionParamsDesc,
            documentName: { type: 'string', description: 'Name for the summary document (default: "Session Summary")' },
          },
          required: ['project'],
        },
      },
      // Cross-Artifact Link Validation
      {
        name: 'validate_session_links',
        description: 'Scan all documents in a session for artifact references ({{diagram:id}}, {{design:id}}, {{spreadsheet:id}}) and validate that referenced artifacts exist.',
        inputSchema: {
          type: 'object',
          properties: sessionParamsDesc,
          required: ['project'],
        },
      },
      ...DESIGN_TOOL_DEFS,
      {
        name: 'render_ui',
        description: 'Push UI to browser. Renders JSON UI definitions to the browser and manages user interactions. Can optionally block until user action is received.',
        inputSchema: renderUISchema,
      },
      {
        name: 'update_ui',
        description: 'Update the currently displayed UI without full re-render by applying a partial patch to the current UI.',
        inputSchema: updateUISchema,
      },
      {
        name: 'dismiss_ui',
        description: 'Dismiss the currently displayed UI in the browser. Called when user responds in terminal to clear the question panel.',
        inputSchema: dismissUISchema,
      },
      {
        name: 'request_user_input',
        description: 'Ask the user a question and wait for their response. Returns the user-provided value.',
        inputSchema: requestUserInputSchema,
      },
      {
        name: 'get_ui_response',
        description: 'Poll for UI response status. Use after render_ui with blocking=false to check if user has responded.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to the project root directory' },
            session: { type: 'string', description: 'Session name (e.g., "bright-calm-river")' },
            uiId: { type: 'string', description: 'UI ID returned from render_ui' },
          },
          required: ['project', 'session', 'uiId'],
        },
      },
      {
        name: 'register_claude_session',
        description: 'Register the current Claude Code session with a collab session for notifications. Before calling this tool, run Bash with command "echo $PPID" to discover the Claude Code process PID, then pass that value as claudePid. The tool reads /tmp/.claude-session-id-<claudePid> (written by the SessionStart hook) to resolve the Claude session ID, writes a binding file, and triggers the initial WebSocket broadcast. Returns { success, claudeSessionId, sessionRole } — sessionRole is the durable role this session resumes into ("conductor" if it owns an active mission, otherwise null); the caller must load the named skill.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            project: { type: 'string', description: 'Project path' },
            session: { type: 'string', description: 'Collab session name' },
            claudePid: { type: 'string', description: 'Claude Code process PID discovered via Bash "echo $PPID" (passed as string or number)' },
          },
          required: ['project', 'session', 'claudePid'],
        },
      },
      {
        name: 'check_server_health',
        description: 'Check if MCP server, HTTP/API backend, and React UI are running',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'fleet_status',
        description: 'Live fleet read-model for a project: per in-progress lane its worker, derived liveness state (working/idle/permission/dead_shell/no_tmux), elapsed time and lease headroom — PLUS a process-headroom block {liveProcs, perUidCap, tmuxSessions, idleSessions} that surfaces the fork-EAGAIN wedge before it hits (uid live procs vs the kern.maxprocperuid cap). Read-only; one ps snapshot per call.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to the project root whose fleet to report' },
          },
          required: ['project'],
        },
      },
      {
        name: 'get_install_path',
        description: 'Get the installation path of the mermaid-collab plugin. Use this to run CLI commands like server start/stop.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'clear_session_artifacts',
        description: 'Delete all artifacts (documents, diagrams, designs, snippets) from a session. Session state and the session folder are preserved.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'archive_session',
        description: 'Archive a collab session by copying documents, diagrams, designs, and spreadsheets to docs/designs/[session]/ and optionally deleting the session folder.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name to archive' },
            delete_session: { type: 'boolean', description: 'Delete the session after archiving (default: true)' },
            timestamp: { type: 'boolean', description: 'Add timestamp to archive folder name (default: false)' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'archive_by_prefix',
        description: 'Archive (copy + deprecate) all artifacts whose name begins with a given prefix. Scans documents, diagrams, designs, and snippets. Each match is copied to "Archive/{slug}/{rest-of-name}" and the original is deprecated. Returns the list of archived items. Useful for clearing out previous "Implementing/" work before generating a new blueprint.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            prefix: { type: 'string', description: 'Name prefix to match (e.g. "Implementing/")' },
            exclude_prefixes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Prefixes to exclude even if they start with `prefix` (e.g. ["Implementing/Ad-hoc/"])',
            },
            extra_names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional artifact names or IDs to include (e.g. ["task-graph"])',
            },
            archive_slug: {
              type: 'string',
              description: 'Slug to use for the Archive/{slug}/ destination. If omitted, derived from the first blueprint:true doc under prefix, or a timestamp.',
            },
          },
          required: ['project', 'session', 'prefix'],
        },
      },
      {
        name: 'consult_grok',
        description: 'Consult Grok (xAI) with a question or prompt. Useful for a second opinion, cross-checking reasoning, or exploring an idea with a different AI model. Requires XAI_API_KEY env var.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question or prompt to send to Grok' },
            system: { type: 'string', description: 'Optional system prompt to set context for Grok' },
            model: { type: 'string', description: 'Grok model to use. Default: grok-build-0.1.' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'consult_codex',
        description: 'Consult Codex (OpenAI) with a question or prompt. A second, independent opinion at design time — the OpenAI-backed peer of consult_grok. Consult both when pressure-testing a design: they are different models with different failure modes. Requires OPENAI_API_KEY (Settings → Secrets).',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The question or prompt to send to Codex' },
            system: { type: 'string', description: 'Optional system prompt to set context' },
            model: { type: 'string', description: 'OpenAI model to use. Default: gpt-5-codex.' },
          },
          required: ['prompt'],
        },
      },
      // Browser tools (CDP via VS Code debug session)
      ...BROWSER_TOOL_DEFS,
      // Desktop (Electron) tools — empty when electron-agent-bridge is absent
      ...DESKTOP_TOOL_DEFS,
  // Task management tools
      {
        name: 'update_task_status',
        description: 'Update a task\'s status and regenerate the task graph. Broadcasts updates via WebSocket.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            taskId: { type: 'string', description: 'Task ID to update' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'failed'],
              description: 'New status for the task',
            },
            minimal: {
              type: 'boolean',
              description: 'If true, return minimal response (just success) to reduce context size. Default: false',
            },
          },
          required: ['project', 'session', 'taskId', 'status'],
        },
      },
      {
        name: 'update_tasks_status',
        description: 'Update multiple tasks\' statuses in a single call. More efficient than multiple update_task_status calls.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
            updates: {
              type: 'array',
              description: 'Array of task updates to apply',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string', description: 'Task ID to update' },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'failed'],
                    description: 'New status for the task',
                  },
                },
                required: ['taskId', 'status'],
              },
            },
            minimal: {
              type: 'boolean',
              description: 'If true, return minimal response (just success and count) to reduce context size. Default: false',
            },
          },
          required: ['project', 'session', 'updates'],
        },
      },
      {
        name: 'get_task_graph',
        description: 'Get the current task graph state without modifications.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
          },
          required: ['project', 'session'],
        },
      },
      {
        name: 'sync_task_graph',
        description: 'Parse blueprint documents in the session and initialize the task graph. Reads blueprint-item-N documents (or task-graph.md if present), performs topological sort into execution waves, and writes batches to session state. Call this after creating blueprint documents to make the task graph available for execution.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Absolute path to project root' },
            session: { type: 'string', description: 'Session name' },
          },
          required: ['project', 'session'],
        },
      },
      // Lessons tools
      {
        name: 'add_lesson',
        description: 'Record a lesson learned during the session. Creates LESSONS.md if it doesn\'t exist.',
        inputSchema: addLessonSchema,
      },
      {
        name: 'list_lessons',
        description: 'Get all lessons from a session.',
        inputSchema: listLessonsSchema,
      },
      // Friction-signal tools (SEAM·collab)
      {
        name: 'record_friction',
        description: 'Record a structured friction note: the retry reason + LAYER (orchestration = collab harness friction like gate format / wrong test command; domain = the project code/API the worker was editing; operational = systemic/dogfood friction any agent can log without a leaf scope). todoId is now optional — operational notes are not leaf-scoped. Persisted per-project to .collab/friction.db so failure attribution is queryable instead of lost in the worker transcript.',
        inputSchema: recordFrictionSchema,
      },
      {
        name: 'list_friction',
        description: 'Query persisted friction notes (newest first). Filter by todoId / session / layer — e.g. layer="domain" answers "which todos hit domain-layer friction and why" without opening each worker\'s private transcript.',
        inputSchema: listFrictionSchema,
      },
      {
        name: 'report_dogfood',
        description: 'Convenience: log a systemic dogfood/operational friction note that ANY agent (worker/daemon/watcher/human) can emit — records an operational-LAYER friction note. Thin wrapper over record_friction with layer="operational" and retryReason=reason; todoId optional (operational notes are not leaf-scoped). Surfaces in list_friction / friction_trends alongside orchestration & domain.',
        inputSchema: reportDogfoodSchema,
      },
      // Session todos tools
      {
        name: 'list_session_todos',
        description: "List per-session todos (checkable list attached to a collab session). Each todo carries a DERIVED claimability view: `status`/`derivedStatus` = the live state (planned/ready/blocked/in_progress/done/dropped), `storedStatus` = the raw persisted value, plus `isClaimable` + `claimReason`. An approved todo reads derivedStatus:'ready' even though storedStatus stays 'planned'. Set includeCompleted=false to filter out completed items. For long-lived sessions with many todos, pass compact=true (slim projection, omits descriptions) to stay under the token cap, or descriptionLimit=N to truncate descriptions. Results are sorted by order ascending.",
        inputSchema: listSessionTodosSchema,
      },
      {
        name: 'update_session_todo',
        description: 'Update a per-session todo. Any combination of text, completed, and order can be provided; omitted fields are left unchanged.',
        inputSchema: updateSessionTodoSchema,
      },
      {
        name: 'toggle_session_todo',
        description: 'Toggle the completed state of a per-session todo. If completed is omitted, the current value is flipped.',
        inputSchema: toggleSessionTodoSchema,
      },
      {
        name: 'remove_session_todo',
        description: 'Remove a per-session todo by id.',
        inputSchema: removeSessionTodoSchema,
      },
      {
        name: 'clear_completed_session_todos',
        description: 'Remove all completed per-session todos for a session. Returns the number of todos removed.',
        inputSchema: clearCompletedSessionTodosSchema,
      },
      {
        name: 'reorder_session_todos',
        description: 'Reorder per-session todos by providing a full permutation of existing todo ids. Assigns new order values (10, 20, 30, ...) in the provided sequence.',
        inputSchema: reorderSessionTodosSchema,
      },
      {
        name: 'complete_linked_todos',
        description: 'Mark completed all session todos linked to a blueprint (and optional taskId). Used to sync linked todos when a Go task finishes.',
        inputSchema: completeLinkedTodosSchema,
      },
      {
        name: 'assign_session_todo',
        description: 'Assign a session todo to a specific session (assigneeSession). Pass null to unassign.',
        inputSchema: assignSessionTodoSchema,
      },
      ...SUPERVISOR_TOOL_DEFS.slice(0, 7),
      ...EPIC_TOOL_DEFS.slice(0, 1),
      { name: 'deploy_self', description: "DEPLOY the running sidecar from its own repo (human-gated, STRICTLY SEPARATE from land). After a self-project epic lands, the live :9002 binary is stale against master; this rebuilds sidecar+UI and restarts the app. Server hard-gates self-project (project must equal the sidecar's MERMAID_PROJECT) AND macOS AND the presence of scripts/deploy-desktop.sh — never deploys another repo. Spawned DETACHED, so it survives killing this very process; returns immediately with a logPath to tail. Reasons: ok | not-self-project | unsupported-platform | deploy-script-missing | spawn-failed.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: "The project to deploy — must be the sidecar's own repo (MERMAID_PROJECT)." } }, required: ['project'] } },
      ...SUPERVISOR_TOOL_DEFS.slice(7, 15),
      ...EPIC_TOOL_DEFS.slice(1, 11),
      { name: 'instance_topology', description: "Read-only map of every live mermaid-collab server this machine knows about, each tagged CANONICAL vs STALE SHADOW. Joins the on-disk instance records (~/.mermaid-collab/instances: port, project/session, pid, version, startedAt), the canonical :9002 ownership lockfile + a live /api/health probe (together identifying the ONE process that actually owns the canonical port), and the in-memory remote-peer registry. The live :9002 owner is tagged `canonical`; any OTHER instance also claiming :9002 is a `shadow` (the 'deploy went cosmetic because a stale source server shadows the desktop sidecar' footgun); a server on its own port is a plain `instance`. `hasShadow:true` is the warning flag. Takes no args.", inputSchema: { type: 'object', properties: {} } },
      { name: 'launch_remote_server', description: "Start a collab server on a REMOTE machine over SSH — the same detect→launch flow the desktop 'Launch' button runs (POST /api/server/detect then /api/server/launch), exposed as one tool so it can be driven/tested headlessly. Runs on THIS sidecar (which owns the system `ssh`). Two phases: (1) DETECT — SSH into the host, probe for bun / a global mermaid-collab / the newest plugin-cache version dir, adopt the server's existing config.json token (or mint one), and synthesize a start command that binds 0.0.0.0 AND sets MERMAID_AUTH_TOKEN (a 0.0.0.0 bind is always auth-required — never an open LAN hole). (2) LAUNCH — SSH again, detach the server (setsid/nohup), and poll the remote /api/health. Pass `command` to skip detect and launch a specific command; pass `detectOnly:true` to only probe+synthesize and NOT launch. `password` is used once for the SSH prompt and never persisted; omit it to use keys/agent (BatchMode). Returns { detect?, launch?, token? } — the token is what a client must present to reach the launched (auth-required) server. NOTE: the host must be a bare host/IP; the SSH user goes in `user`, not baked into `host`.", inputSchema: { type: 'object', properties: { host: { type: 'string', description: 'Bare remote host or IP (NOT user@host). The SSH user goes in `user`.' }, port: { type: 'number', description: 'Port the server should listen on / be probed at (default 9002).' }, user: { type: 'string', description: 'SSH user (blank = ssh default / ~/.ssh/config).' }, password: { type: 'string', description: 'One-time SSH password. Never persisted. Omit to use keys/agent (BatchMode, fails fast).' }, command: { type: 'string', description: 'Explicit start command to launch. If omitted, detect synthesizes one. Ignored when detectOnly is true.' }, token: { type: 'string', description: "Existing bearer token to thread through so detect REUSES it (avoids diverging from the server's config-authoritative token)." }, detectOnly: { type: 'boolean', description: 'Only run the SSH probe + synthesize a command; do NOT launch. Returns { detect }.' } }, required: ['host'] } },
      { name: 'orchestrator_off', description: "STEWARD KILL-SWITCH (one-way): force a project's Orchestrator autonomy level to 'off', stopping the daemon from driving todos. This is the steward's ONLY autonomy control — it can ALWAYS brake but can NEVER raise the level (decision 3bf1292b). It takes no level argument; raising autonomy stays human-only on the Bridge ladder. Reuses the server-side 'off' transition. Optional project (defaults to the server's cwd). Returns the resulting level for confirmation.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project to brake (defaults to the current working directory).' } } } },
      { name: 'friction_trends', description: "Read-only recurrence rollup over the friction store. Groups the most-recent friction notes by LAYER (orchestration vs domain vs operational) with counts, and within each layer by retryReason, so a repeating problem (e.g. tmux-pane accumulation showing up as repeated orchestration friction) surfaces as a high-count reason instead of being buried in list_friction's flat newest-first list. Returns { total, considered, byLayer:[{ layer, count, reasons:[{ retryReason, count, sessions[], lastAt }] }], recurring:[{ layer, retryReason, count }] } — `recurring` is the cross-layer 'what keeps going wrong' shortlist (reasons seen >1, most-recurring first).", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose friction to roll up.' }, layer: { type: 'string', enum: ['orchestration', 'domain', 'operational'], description: 'Optional: restrict to one layer.' }, limit: { type: 'number', description: 'Max most-recent notes to consider (default 100, capped 1000).' } }, required: ['project'] } },
      ...EPIC_TOOL_DEFS.slice(11, 17),
      ...SUPERVISOR_TOOL_DEFS.slice(15, 17),
      { name: 'submit_reconcile_result', description: 'A reconcile session reports its merged plan graph back to the waiting reconciliation request. Call this at the END of the reconcile skill with the id you were given.', inputSchema: { type: 'object', properties: { reconcileId: { type: 'string' }, mergedGraph: { type: 'array', description: 'The merged PlanNode[] ({id, dependsOn[], parentId?, title?}).', items: { type: 'object' } }, newConstraints: { type: 'array', description: 'Optional new constraints surfaced by the merge ({title, rationale?}).', items: { type: 'object' } } }, required: ['reconcileId', 'mergedGraph'] } },
      { name: 'create_decision_record', description: 'Record a planning decision/constraint/assumption/requirement (PCS #9). decisions/assumptions are auto-active; constraints & requirements start "proposed" and need approval. requirements carry a machine-checkable spec {metric,op,target}. epicId null = project-level.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, kind: { type: 'string', enum: ['decision', 'constraint', 'assumption', 'requirement'] }, title: { type: 'string' }, rationale: { type: 'string' }, alternatives: { type: 'array', items: { type: 'string' } }, spec: { type: 'object', description: 'Requirement spec {metric, op, target} — only for kind="requirement".', properties: { metric: { type: 'string' }, op: { type: 'string' }, target: {} } }, linkedTodos: { type: 'array', items: { type: 'string' } }, epicId: { type: 'string', description: 'Epic id, or omit for project-level.' }, authorSession: { type: 'string' } }, required: ['project', 'kind', 'title'] } },
      { name: 'list_decision_records', description: 'List decision records for a project, filterable by epicId / kind / status.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string' }, kind: { type: 'string', enum: ['decision', 'constraint', 'assumption', 'requirement'] }, status: { type: 'string', enum: ['proposed', 'approved', 'active', 'superseded'] } }, required: ['project'] } },
      { name: 'approve_decision_record', description: 'Approve a proposed constraint or requirement (human gate) → active.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, approvedBy: { type: 'string' } }, required: ['project', 'id', 'approvedBy'] } },
      { name: 'supersede_decision_record', description: 'Mark a decision record superseded by another (the superseding record should already exist).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, bySupersedingId: { type: 'string' } }, required: ['project', 'id', 'bySupersedingId'] } },
      { name: 'get_active_constraints', description: 'Active constraints in scope for an epic (epic-level + project-level) — the decision-record half of /focus. Omit epicId for all active constraints.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string' } }, required: ['project'] } },
      { name: 'get_active_requirements', description: 'Active requirements in scope for an epic (epic-level + project-level) — the spec→Planner bridge, peer of get_active_constraints. Omit epicId for all active requirements.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, epicId: { type: 'string' } }, required: ['project'] } },
      { name: 'spec_coverage', description: 'Spec coverage rollup (design-system-object-ui §5): for each durable system object, is it covered/partial/uncovered, derived inline from the Todo.objectRef join (no full-tree walk). Returns { total, covered, partial, uncovered, byObject[] }.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
      { name: 'cartographer_health', description: 'Cartographer spec-health summary (design-cartographer §8, Phase 1): read-only counts { uncoveredRequirements, orphanObjects, staleEdges }. Proposes nothing; never writes.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
      { name: 'cartographer_sync', description: 'Cartographer drift sync (design-cartographer §3/§6, Phase 1): runs the deterministic detectors then ranks (drift > inverse-coverage), dedupes by object, and caps to the top 5 — the pre-write batch sheet the human approves per-line in the Inbox later. ZERO DB writes. Quiet-by-default: nothing drifted → { inSync: true, message: "spec in sync" }.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
      { name: 'list_system_objects', description: 'List the durable system-object tree (instances) + the type registry for a project — the data the Spec Sheet renders.', inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } },
      { name: 'system_object_bom', description: 'Rolled-up bill-of-materials beneath a root object (derived recursive-CTE; never stored): total qty per child type.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, rootId: { type: 'string' } }, required: ['project', 'rootId'] } },
      { name: 'decide_requirement', description: 'Sign/reject/re-sign a requirement promise (reuses the decision-record approve/supersede path). decision: "approve" → active; "reject" → superseded (no replacement); "edit" → creates a fresh proposed requirement carrying the new spec and supersedes the old (the re-sign DIFF). edit requires spec.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject', 'edit'] }, approvedBy: { type: 'string' }, spec: { type: 'object', description: 'New requirement spec {metric, op, target} — required for decision="edit".', properties: { metric: { type: 'string' }, op: { type: 'string' }, target: {} } }, title: { type: 'string' } }, required: ['project', 'id', 'decision'] } },
      ...SUPERVISOR_TOOL_DEFS.slice(17, 20),
      { name: 'check_graph_drift', description: 'Graph↔code drift check: scans the session\'s blueprint task files and flags MISSING dependencies — where one task\'s code imports another task\'s files but the plan graph has no dependsOn. Deterministic (import-edge analysis, no LLM). The supervisor can run this periodically.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      ...SUPERVISOR_TOOL_DEFS.slice(20, 21),
      { name: 'orchestrator_status', description: 'Live orchestrator daemon runtime snapshot: { running, tickMs, lastTickAt, projects:[{project,level}], pool:[{session,type,slot,status,todoId,tmux}], coldStartsInFlight, recentSpawns, recentAutonomousMutations:[{kind,actor,reason,project?,detail?,at}] }. `recentAutonomousMutations` (B6) is the in-memory newest-first log of self-driven mutations — reserve-leaf re-cuts, deploy-gate refusals, and terminal-mission self-heals — scoped to `project` when given (global entries always included), else all. Read-only. Returns running:false cleanly when the daemon is stopped. Thin wrapper over the worker pool + the orchestrator level/health.', inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Scope recentAutonomousMutations to this project (global entries are always included). Omit for all.' } } } },
      { name: 'system_status', description: "THE one-call steward rollup — call this FIRST to ground a decision instead of a stale checkpoint + N bash probes. COMPOSES the four foundational read-models (orchestrator_status: daemon running/level + pool occupancy + cold-starts · fleet_status: worker occupancy + proc-headroom early-warning · invariant_check: work-graph violation count · instance_topology: canonical :9002 confirmation vs stale shadows) PLUS inline: deploy/version drift (live sidecar pid+version+startedAt vs repo package.json version + git HEAD + uncommitted WIP — the 'did the deploy land or go cosmetic?' read), open-escalation + pending-decision counts, and steward/supervisor pause state. Returns a COMPACT summary with `pointers` to the focused tool for full detail behind any field. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project to roll up (work-graph + deploy/git lives here).' } }, required: ['project'] } },
      { name: 'daemon_status', description: "LIVE leaf-executor activity — the piece fleet_status/orchestrator_status are blind to (a leaf run makes no tmux). Returns the leaves RUNNING RIGHT NOW (leafId, current nodeKind, model, attempt, elapsedMs, and a `stale` flag for rows older than 15m = a likely crashed run) + the headless circuit-breaker state (open/closed) + a `state` field (working | blocked-on-decision | claims-suppressed | claimable | idle). When scoped to a project, `state` is one of: working (leaves in flight), blocked-on-decision (a split parent has unapproved children — see `claimSuppression.blockedSplits`), claims-suppressed (ready leaves held by probes/budget/breaker), claimable (leaves ready to claim), or idle (no work). Use this to answer 'what is the daemon doing this second'; pair with orchestrator_status (level/pool/recentSpawns) and leaf_failures (what broke). Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Filter in-flight leaves to this project.' } } } },
      ...EPIC_TOOL_DEFS.slice(17, 19),
      { name: 'runtime_config', description: "Read-only effective CONTROL PLANE in one view — what knobs the daemon is ACTUALLY running with, so the steward doesn't have to read config.json by hand + cross-reference N pause tools. Returns `flags` (the resolved values the running process uses, via each owning module's accessor — workerIsolation (MERMAID_WORKER_ISOLATION), poolSizes per type (MERMAID_POOL_<TYPE>), maxColdStarts (MERMAID_MAX_COLD_STARTS), deadGraceMs (MERMAID_DEAD_GRACE), and the effective context-watchdog threshold) + `overrides` (every pause/level: steward pause+liveness, supervisor pauses, this project's orchestrator autonomy level). COMPACT with `pointers` to the tool that changes each field. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose per-project overrides (watchdog threshold, supervisor pause, orchestrator level) to resolve.' } }, required: ['project'] } },
      { name: 'set_watchdog_threshold', description: 'Set (or clear, with null) a project\'s context-watchdog trigger threshold (%). Overrides the 80% default for supervisor_watchdog_scan on that project. Pass null to revert to the default.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, thresholdPercent: { type: ['number', 'null'], description: 'Percent (1-100) or null to clear.' } }, required: ['project', 'thresholdPercent'] } },
      { name: 'set_context_recycle', description: "Set a project's context-auto-recycle mode — the deterministic server-side driver that keeps a low-context WATCHED session alive by injecting /vibe-checkpoint → /clear → /collab (no LLM supervisor in the loop). 'off' (default) = inert; 'notify' = at the watchdog threshold, inject an advisory nudge and only auto-clear+reload once the session itself saves a fresh checkpoint (assisted); 'force' = server injects the checkpoint too, then clears+reloads (for an unattended autonomous-loop session).", inputSchema: { type: 'object', properties: { project: { type: 'string' }, mode: { type: 'string', enum: ['off', 'notify', 'force'], description: "off | notify | force" } }, required: ['project', 'mode'] } },
      ...SUPERVISOR_TOOL_DEFS.slice(21, 22),
      ...MISSION_TOOL_DEFS,
      ...WORKGRAPH_TOOL_DEFS,
      { name: 'context_usage', description: "Read-only per-session context-window report for a project: each watched session's contextPercent (last reported, with its age), the effective checkpoint threshold (per-project override or the 80% default), and a nearThreshold flag PLUS the watchdog action ('checkpoint'/'clear'/null) it would take this tick — computed from the SAME watchdog selector the supervisor_watchdog_scan uses, so the steward sees who is near a boundary before suggesting /clear. Returns { thresholdPercent, sessions:[{ session, status, contextPercent, contextAgeMs, checkpointReadyAt, nearThreshold, watchdogAction, reason }] }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose sessions to report.' }, thresholdPercent: { type: 'number', description: 'Override the checkpoint threshold % (default: per-project config → 80).' } }, required: ['project'] } },
      ...SPREADSHEET_TOOL_DEFS,
      ...SNIPPET_TOOL_DEFS,
      ...EMBED_TOOL_DEFS,
      ...IMAGE_TOOL_DEFS,
      {
        name: 'deprecate_artifact',
        description: 'Mark an artifact as deprecated (hidden by default) or restore it. Deprecated artifacts remain in the session but are filtered from the default view.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project path' },
            session: { type: 'string', description: 'Session name' },
            id: { type: 'string', description: 'Artifact ID' },
            deprecated: { type: 'boolean', description: 'true to deprecate, false to restore' },
          },
          required: ['project', 'session', 'id', 'deprecated'],
        },
      },
      {
        name: 'set_artifact_metadata',
        description: 'Set metadata flags on an artifact. Use to mark documents as blueprint (locked, shown in Blueprint section), pin/unpin, or set any combination of metadata flags.',
        inputSchema: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project path' },
            session: { type: 'string', description: 'Session name' },
            id: { type: 'string', description: 'Artifact ID' },
            blueprint: { type: 'boolean', description: 'Mark as blueprint (read-only plan document shown in Blueprint section). Also sets locked: true.' },
            locked: { type: 'boolean', description: 'Lock the artifact to prevent editing' },
            pinned: { type: 'boolean', description: 'Pin to top of sidebar list' },
            deprecated: { type: 'boolean', description: 'Hide from default view' },
          },
          required: ['project', 'session', 'id'],
        },
      },
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
