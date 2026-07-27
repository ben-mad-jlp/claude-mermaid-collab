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
import { mkdir, writeFile } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
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
import { sessionRegistry } from '../services/session-registry.js';
import { projectRegistry } from '../services/project-registry.js';
import * as supervisorStore from '../services/supervisor-store.js';
import { selectWatchdogActions, DEFAULT_WATCHDOG_CONFIG } from '../services/context-watchdog.js';
import { listSessionRuntimes } from '../services/session-runtime.js';
import { getFleetStatus } from '../services/fleet-status.js';
import { resolveReconcile } from '../services/planner-reconcile-live.js';
import { SERVER_VERSION } from './server.js';
import { createDecisionRecord, listDecisionRecords, approveDecisionRecord, supersedeDecisionRecord, getActiveConstraints, getActiveRequirements, type DecisionKind, type RequirementSpec } from '../services/decision-record-store.js';
import { listObjects, listTypes } from '../services/system-object-store.js';
import { bom } from '../services/system-object-bom.js';
import { specCoverage, decideRequirement, type RequirementDecision } from '../services/spec-coverage.js';
import { specHealth, syncShortlist } from '../services/cartographer.js';
import { getTodo, completeGatesForDecision, deriveTodoViews } from '../services/todo-store.js';
import type { TodoKind } from '../services/todo-kind.js';
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
// Design service handlers still called directly by non-design flows (clear-artifacts,
// session summary); the design tool group itself lives in ./design-tools.ts.
import { handleCreateDesign, handleGetDesign, handleListDesigns, handleDeleteDesign } from './tools/design.js';
import { instanceTopology } from '../services/instance-topology.js';
import { systemStatus } from '../services/system-status.js';
// BUG 7fb16985: orchestrator_status and system_status MUST derive running/level/
// projects from ONE source of truth. system_status reaches getOrchestratorHealth
// via system-status.js → './orchestrator-live.js'; the daemon lifecycle in
// server.ts starts it via './services/orchestrator-live.js'. orchestrator_status
// previously used a dynamic `await import(...'.js')` multi-path loop that, under
// Bun, could resolve a SECOND module record with its own `timer`/`lastTickAt`
// state — so the two tools disagreed (one saw running:false/[], the other
// running:true/level). Import the IDENTICAL specifier statically so both read the
// same module instance (same `timer`, same level rows).
import { getOrchestratorHealth as getOrchestratorHealthSST } from '../services/orchestrator-live.js';
import { listLeafInflight } from '../services/worker-ledger.js';
import { breakerOpen } from '../services/headless-breaker.js';
import { frictionTrends } from '../services/friction-trends.js';
import { runtimeConfig } from '../services/runtime-config.js';
import { getConfig, getSecret } from '../services/config-service.js';
import { consultCodex } from '../services/consult-openai.js';
import { recordSpend } from '../services/spend-ledger.js';
import { diagnoseClaimSuppression } from '../services/coordinator-live.js';
import { requestSelfDeploy } from '../services/deploy-service.js';
import { updateTaskStatus, updateTasksStatus, getTaskGraph } from './workflow/task-status.js';
import { syncTasksFromTaskGraph, getTaskGraphTasks } from './workflow/task-sync.js';
import { checkGraphDrift, type DriftNode } from '../services/graph-drift.js';
import {
  addLesson,
  listLessons,
  addLessonSchema,
  listLessonsSchema,
} from './tools/lessons.js';
import {
  recordFrictionTool,
  listFrictionTool,
  reportDogfoodTool,
  recordFrictionSchema,
  listFrictionSchema,
  reportDogfoodSchema,
} from './tools/friction.js';
import {
  listSessionTodos,
  addSessionTodo,
  updateSessionTodo,
  toggleSessionTodo,
  removeSessionTodo,
  clearCompletedSessionTodos,
  reorderSessionTodos,
  completeTodosForTask,
  assignSessionTodo,
  listSessionTodosSchema,
  addSessionTodoSchema,
  updateSessionTodoSchema,
  toggleSessionTodoSchema,
  removeSessionTodoSchema,
  clearCompletedSessionTodosSchema,
  reorderSessionTodosSchema,
  completeLinkedTodosSchema,
  assignSessionTodoSchema,
  sessionTodoToolDefs,
  type SessionTodoLink,
} from './tools/session-todos.js';
import {
  handleCreateSnippet,
  handleUpdateSnippet,
  handleGetSnippet,
  handleListSnippets,
  handleDeleteSnippet,
  handleExportSnippet,
} from './tools/snippet.js';

// --- Desktop (Electron) MCP tools ---
// electron-agent-bridge is an OPTIONAL dependency: it drives the Electron
// desktop app over CDP and is only meaningful where that app runs. On headless
// / remote servers the package may be absent, so we load it lazily and degrade
// gracefully (desktop_* tools simply disappear) rather than crashing on boot.
type ElectronDriverT = import('electron-agent-bridge/driver').ElectronDriver;
let _bridge: { ElectronDriver: any; createDesktopTools: any } | null = null;
try {
  const [driverMod, toolsMod] = await Promise.all([
    import('electron-agent-bridge/driver'),
    import('electron-agent-bridge/mcp-tools'),
  ]);
  _bridge = { ElectronDriver: driverMod.ElectronDriver, createDesktopTools: toolsMod.createDesktopTools };
} catch (e) {
  console.warn('[mcp] electron-agent-bridge unavailable — desktop_* tools disabled:', (e as Error).message);
}

const desktopSelectTarget = (t: any) => t.type === 'page' && /Mermaid Collab/i.test(t.title || '');
let _dd: ElectronDriverT | null = null;
async function getDesktopDriver(): Promise<ElectronDriverT> {
  if (!_bridge) throw new Error('Desktop bridge not installed (electron-agent-bridge missing on this host)');
  if (!_dd) {
    try {
      _dd = await _bridge.ElectronDriver.fromDiscovery({ appName: 'mermaid-collab', selectTarget: desktopSelectTarget });
    } catch (e) {
      _dd = null;
      throw new Error('Desktop app not reachable (no discovery file / not running): ' + (e as Error).message);
    }
  }
  return _dd!;
}

/** Drop the memoized driver so the next getDesktopDriver() re-reads discovery. */
function resetDesktopDriver(): void { _dd = null; }

/**
 * True for errors that mean the cached CDP endpoint is dead — typically because
 * the desktop app relaunched on a new free debugging port, leaving the memoized
 * ElectronDriver dialing the old (now closed) port.
 */
function isDesktopConnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|WebSocket|not reachable|connect/i.test(msg);
}

/**
 * Run a desktop-driver operation with one self-healing retry. The driver is
 * connect-per-op, so a stale CDP port only surfaces when the op actually dials.
 * On a connection-style failure we drop the memo (forcing fresh discovery) and
 * retry once — so an app restart no longer strands the driver for the life of
 * the MCP sidecar.
 */
async function withDesktopRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (!isDesktopConnError(e)) throw e;
    resetDesktopDriver();
    return await op();
  }
}
const { defs: desktopDefs, handlers: desktopHandlers }: { defs: any[]; handlers: Record<string, (args: any) => Promise<any>> } =
  _bridge ? _bridge.createDesktopTools(getDesktopDriver) : { defs: [], handlers: {} };
// desktop_screenshot is overridden below to accept optional project/session for saving.
const desktopDefsForList = desktopDefs.filter((d) => d.name !== 'desktop_screenshot');
const desktopScreenshotDef = {
  name: 'desktop_screenshot',
  description: 'Screenshot the desktop app renderer. If project+session given, saves under that session images dir and returns the path; otherwise returns base64.',
  inputSchema: { type: 'object' as const, properties: { format: { type: 'string', enum: ['png', 'jpeg'] }, project: { type: 'string' }, session: { type: 'string' } } },
};
// When the bridge is absent, advertise no desktop_* tools at all (including the
// overridden desktop_screenshot) so clients don't see tools that always error.
const desktopToolDefs = _bridge ? [...desktopDefsForList, desktopScreenshotDef] : [];

// Configuration (API_BASE_URL, buildUrl, asJson, AnyJson, sessionParamsDesc
// now live in ./tools/http-util.js — imported above).

// SERVER_VERSION is imported from server.ts (single source of truth, synced by
// the `npm version` hook) — see the import near the top of this file.

// Word lists for session name generation
const ADJECTIVES = [
  'bright', 'calm', 'swift', 'bold', 'warm', 'cool', 'soft', 'clear',
  'fresh', 'pure', 'wise', 'keen', 'fair', 'true', 'kind', 'brave',
  'deep', 'wide', 'tall', 'light', 'dark', 'loud', 'quiet', 'quick',
  'slow', 'sharp', 'smooth', 'rough', 'wild', 'free', 'open', 'still'
];

const NOUNS = [
  'river', 'mountain', 'forest', 'meadow', 'ocean', 'valley', 'canyon', 'lake',
  'stream', 'hill', 'cliff', 'beach', 'island', 'bridge', 'tower', 'garden',
  'field', 'grove', 'pond', 'spring', 'peak', 'ridge', 'shore', 'delta',
  'harbor', 'bay', 'cape', 'reef', 'dune', 'oasis', 'mesa', 'fjord'
];

function generateSessionName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

// ============= Document Tools =============

/** Append a supervisor decision/action to the durable audit log AND broadcast a
 *  supervisor_decision WS event (for live UI + the System Map / observability). */
export function recordSupervisorDecision(kind: string, project: string, session: string, detail?: string | null, serverId?: string): void {
  try {
    const entry = supervisorStore.recordSupervisorAudit({ kind, project, session, detail, serverId });
    getWebSocketHandler()?.broadcast({ type: 'supervisor_decision', project, session, kind, detail: entry.detail, ts: entry.ts });
  } catch { /* audit must never break the action it records */ }
}




// ============= Spreadsheet Tools =============

// ============= Archive By Prefix =============

interface ArchiveByPrefixResult {
  archived: Array<{ type: string; oldName: string; oldId: string; newName: string; newId: string }>;
  errors: Array<{ type: string; id: string; name: string; error: string }>;
  slug: string;
}

async function deprecateItem(project: string, session: string, id: string): Promise<void> {
  const response = await apiFetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deprecated: true }),
  });
  if (!response.ok) throw new Error(`Failed to deprecate ${id}: ${response.statusText}`);
}

async function deleteArchivedOriginal(
  project: string,
  session: string,
  type: 'document' | 'diagram' | 'design' | 'snippet',
  id: string
): Promise<void> {
  if (type === 'document' || type === 'diagram') {
    const response = await apiFetch(buildUrl(`/api/${type}/${id}`, project, session), {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(`Failed to delete ${type} ${id}: ${response.statusText}`);
  } else if (type === 'design') {
    await handleDeleteDesign(project, session, id);
  } else {
    await handleDeleteSnippet(project, session, id);
  }
}

function rewriteName(oldName: string, prefix: string, slug: string): string {
  // Strip the prefix (with or without trailing slash) and prepend Archive/{slug}/
  const stripped = oldName.startsWith(prefix) ? oldName.slice(prefix.length).replace(/^\/+/, '') : oldName;
  return `Archive/${slug}/${stripped}`;
}

async function archiveByPrefix(
  project: string,
  session: string,
  prefix: string,
  options: { excludePrefixes?: string[]; extraNames?: string[]; archiveSlug?: string } = {}
): Promise<ArchiveByPrefixResult> {
  const excludePrefixes = options.excludePrefixes || [];
  const extraNames = new Set(options.extraNames || []);
  const matches = (name: string) =>
    name.startsWith(prefix) && !excludePrefixes.some(ex => name.startsWith(ex));

  const archived: ArchiveByPrefixResult['archived'] = [];
  const errors: ArchiveByPrefixResult['errors'] = [];

  // Pull all artifact lists in parallel.
  const [docsRaw, diagsRaw, designsRes, snipsRes] = await Promise.all([
    listDocuments(project, session).catch(() => '[]'),
    listDiagrams(project, session).catch(() => '[]'),
    handleListDesigns(project, session).catch(() => ({ designs: [] as any[] })),
    handleListSnippets(project, session).catch(() => ({ snippets: [] as any[] }) as AnyJson),
  ]);

  const parseList = (raw: string, key: string): any[] => {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return parsed?.[key] || [];
  };
  const docs = parseList(docsRaw, 'documents');
  const diagrams = parseList(diagsRaw, 'diagrams');
  const designs = (designsRes as any).designs || [];
  const snippets = (snipsRes as any).snippets || [];

  // Determine slug: prefer caller-provided, else find a doc with blueprint:true under prefix
  let slug = options.archiveSlug || '';
  if (!slug) {
    // Prefer a live blueprint, but fall back to a deprecated one so the
    // archive folder is still named after the work rather than a timestamp.
    const blueprintDoc =
      docs.find(d => d.blueprint && matches(d.name) && !d.deprecated) ||
      docs.find(d => d.blueprint && matches(d.name));
    if (blueprintDoc) {
      const tail = blueprintDoc.name.startsWith(prefix)
        ? blueprintDoc.name.slice(prefix.length).replace(/^\/+/, '')
        : blueprintDoc.name;
      slug = tail.split('/')[0] || `unknown-${Date.now()}`;
    } else {
      slug = `archive-${Date.now()}`;
    }
  }

  // Archive regardless of `deprecated` — a deprecated doc still under
  // `Implementing/` is exactly what we want to move out. Only skip items
  // already in `Archive/` so repeated calls stay idempotent.
  const shouldArchive = (item: any) =>
    !String(item.name).startsWith('Archive/') &&
    (matches(item.name) || extraNames.has(item.name) || extraNames.has(item.id));

  // Documents
  for (const d of docs) {
    if (!shouldArchive(d)) continue;
    try {
      const fullRaw = await getDocument(project, session, d.id);
      const full = JSON.parse(fullRaw);
      const newName = rewriteName(d.name, prefix, slug);
      const createdRaw = await createDocument(project, session, newName, full.content);
      const created = JSON.parse(createdRaw);
      await deprecateItem(project, session, created.id);
      await deleteArchivedOriginal(project, session, 'document', d.id);
      archived.push({ type: 'document', oldName: d.name, oldId: d.id, newName, newId: created.id });
    } catch (err) {
      errors.push({ type: 'document', id: d.id, name: d.name, error: String(err) });
    }
  }

  // Diagrams
  for (const d of diagrams) {
    if (!shouldArchive(d)) continue;
    try {
      const fullRaw = await getDiagram(project, session, d.id);
      const full = JSON.parse(fullRaw);
      const newName = rewriteName(d.name, prefix, slug);
      const createdRaw = await createDiagram(project, session, newName, full.content);
      const created = JSON.parse(createdRaw);
      await deprecateItem(project, session, created.id);
      await deleteArchivedOriginal(project, session, 'diagram', d.id);
      archived.push({ type: 'diagram', oldName: d.name, oldId: d.id, newName, newId: created.id });
    } catch (err) {
      errors.push({ type: 'diagram', id: d.id, name: d.name, error: String(err) });
    }
  }

  // Designs
  for (const d of designs as any[]) {
    if (!shouldArchive(d)) continue;
    try {
      const full = await handleGetDesign(project, session, d.id);
      const newName = rewriteName(d.name || d.id, prefix, slug);
      const created = await handleCreateDesign(project, session, newName, full.content);
      await deprecateItem(project, session, created.id);
      await deleteArchivedOriginal(project, session, 'design', d.id);
      archived.push({ type: 'design', oldName: d.name || d.id, oldId: d.id, newName, newId: created.id });
    } catch (err) {
      errors.push({ type: 'design', id: d.id, name: d.name || d.id, error: String(err) });
    }
  }

  // Snippets
  for (const s of snippets as any[]) {
    if (!shouldArchive(s)) continue;
    try {
      const full = await handleGetSnippet(project, session, s.id);
      const newName = rewriteName(s.name, prefix, slug);
      const created = await handleCreateSnippet(project, session, newName, full.content);
      await deprecateItem(project, session, (created as any).id);
      await deleteArchivedOriginal(project, session, 'snippet', s.id);
      archived.push({ type: 'snippet', oldName: s.name, oldId: s.id, newName, newId: (created as any).id });
    } catch (err) {
      errors.push({ type: 'snippet', id: s.id, name: s.name, error: String(err) });
    }
  }

  return { archived, errors, slug };
}

// ============= Session Tools =============

async function listSessions(project?: string): Promise<string> {
  const url = project
    ? `${API_BASE_URL}/api/sessions?project=${encodeURIComponent(project)}`
    : `${API_BASE_URL}/api/sessions`;
  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  const data = await asJson(response);
  return JSON.stringify(data, null, 2);
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
      ...desktopToolDefs,
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
        switch (name) {
          case 'generate_session_name':
            return JSON.stringify({ name: generateSessionName() }, null, 2);

          case 'get_datetime': {
            const now = new Date();
            return JSON.stringify(
              {
                iso: now.toISOString(),
                local: now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                epochMs: now.getTime(),
              },
              null,
              2,
            );
          }

          case 'list_sessions':
            return await listSessions((args as { project?: string })?.project);

          case 'recommend_session_cleanup': {
            const days = (args as { days?: number })?.days ?? 30;
            const res = await apiFetch(`${API_BASE_URL}/api/maintenance/stale-scan?days=${encodeURIComponent(String(days))}`);
            if (!res.ok) throw new Error(`stale-scan failed: ${res.statusText}`);
            return JSON.stringify(await asJson(res), null, 2);
          }

          case 'list_projects': {
            const result = await handleListProjects();
            return JSON.stringify(result, null, 2);
          }

          case 'register_project': {
            const { path } = args as { path: string };
            if (!path) throw new Error('Missing required: path');
            const result = await handleRegisterProject({ path });
            return JSON.stringify(result, null, 2);
          }

          case 'unregister_project': {
            const { path } = args as { path: string };
            if (!path) throw new Error('Missing required: path');
            const result = await handleUnregisterProject({ path });
            return JSON.stringify(result, null, 2);
          }

          // Session Summary
          case 'generate_session_summary': {
            const { project, session, documentName } = args as { project: string; session: string; documentName?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const [diagramsRaw, documentsRaw, designsResult, spreadsheetsRaw] = await Promise.all([
              listDiagrams(project, session).catch(() => '[]'),
              listDocuments(project, session).catch(() => '[]'),
              handleListDesigns(project, session).catch(() => ({ designs: [], count: 0 })),
              listSpreadsheets(project, session).catch(() => '{"spreadsheets":[]}'),
            ]);
            const diagrams = JSON.parse(diagramsRaw);
            const documents = JSON.parse(documentsRaw);
            const designs = designsResult.designs || [];
            const spreadsheetsList = JSON.parse(spreadsheetsRaw).spreadsheets || [];

            const lines: string[] = ['# Session Summary', ''];
            lines.push(`**Session:** ${session}  `);
            lines.push(`**Generated:** ${new Date().toISOString()}`, '');

            if (diagrams.length > 0) {
              lines.push('## Diagrams', '');
              for (const d of diagrams) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (documents.length > 0) {
              lines.push('## Documents', '');
              for (const d of documents) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (designs.length > 0) {
              lines.push('## Designs', '');
              for (const d of designs) {
                lines.push(`- **${d.name || d.id}** (id: \`${d.id}\`)${d.lastModified ? ` — last modified: ${d.lastModified}` : ''}`);
              }
              lines.push('');
            }

            if (spreadsheetsList.length > 0) {
              lines.push('## Spreadsheets', '');
              for (const s of spreadsheetsList) {
                lines.push(`- **${s.name || s.id}** (id: \`${s.id}\`)${s.lastModified ? ` — last modified: ${s.lastModified}` : ''}`);
              }
              lines.push('');
            }

            lines.push('---', '');
            lines.push(`**Totals:** ${diagrams.length} diagram(s), ${documents.length} document(s), ${designs.length} design(s), ${spreadsheetsList.length} spreadsheet(s)`);

            const markdown = lines.join('\n');
            const summaryName = documentName || 'Session Summary';
            return await createDocument(project, session, summaryName, markdown);
          }

          // Cross-Artifact Link Validation
          case 'validate_session_links': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');

            const [diagramsRaw, documentsRaw, designsResult, spreadsheetsRaw] = await Promise.all([
              listDiagrams(project, session).catch(() => '[]'),
              listDocuments(project, session).catch(() => '[]'),
              handleListDesigns(project, session).catch(() => ({ designs: [], count: 0 })),
              listSpreadsheets(project, session).catch(() => '[]'),
            ]);
            const diagrams = JSON.parse(diagramsRaw);
            const documents = JSON.parse(documentsRaw);
            const designs = designsResult.designs || [];
            const spreadsheets = JSON.parse(spreadsheetsRaw);

            // Build ID sets
            const diagramIds = new Set(diagrams.map((d: any) => d.id));
            const documentIds = new Set(documents.map((d: any) => d.id));
            const designIds = new Set(designs.map((d: any) => d.id));
            const spreadsheetIds = new Set(spreadsheets.map((d: any) => d.id));

            const valid: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];
            const broken: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];

            // Read each document and scan for references
            for (const doc of documents) {
              try {
                const docContent = await getDocument(project, session, doc.id);
                const parsed = JSON.parse(docContent);
                const content = parsed.content || '';

                // Scan for {{diagram:id}}, {{design:id}}, {{spreadsheet:id}} patterns
                const embedRegex = /\{\{(diagram|design|spreadsheet):([^}]+)\}\}/g;
                let match: RegExpExecArray | null;
                while ((match = embedRegex.exec(content)) !== null) {
                  const targetType = match[1];
                  const targetId = match[2];
                  const ref = match[0];
                  const idSet = targetType === 'diagram' ? diagramIds : targetType === 'spreadsheet' ? spreadsheetIds : designIds;
                  const exists = idSet.has(targetId);
                  (exists ? valid : broken).push({ docId: doc.id, ref, targetType, targetId });
                }

                // Also scan for @diagram/id, @design/id, @spreadsheet/id patterns (image embeds)
                const imgRegex = /@(diagram|design|spreadsheet)\/([^\s)]+)/g;
                while ((match = imgRegex.exec(content)) !== null) {
                  const targetType = match[1];
                  const targetId = match[2];
                  const ref = match[0];
                  const idSet = targetType === 'diagram' ? diagramIds : targetType === 'spreadsheet' ? spreadsheetIds : designIds;
                  const exists = idSet.has(targetId);
                  (exists ? valid : broken).push({ docId: doc.id, ref, targetType, targetId });
                }
              } catch {
                // Skip documents that can't be read
              }
            }

            return JSON.stringify({
              success: true,
              valid,
              broken,
              summary: `${valid.length} valid link(s), ${broken.length} broken link(s) across ${documents.length} document(s)`,
            }, null, 2);
          }

          case 'render_ui': {
            const { project, session, ui, blocking } = args as { project: string; session: string; ui: any; blocking?: boolean };
            if (!project || !session || !ui) throw new Error('Missing required: project, session, ui');

            const response = await apiFetch(buildUrl('/api/render-ui', project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ui, blocking }),
            });

            if (!response.ok) {
              const error = await asJson(response);
              throw new Error(`Failed to render UI: ${error.error || response.statusText}`);
            }

            return await response.text();
          }

          case 'update_ui': {
            const { project, session, patch } = args as { project: string; session: string; patch: Record<string, any> };
            if (!project || !session || !patch) throw new Error('Missing required: project, session, patch');
            return await updateUI(project, session, patch);
          }

          case 'dismiss_ui': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            return await dismissUI(project, session);
          }

          case 'get_ui_response': {
            const { project, session, uiId } = args as { project: string; session: string; uiId: string };
            if (!project || !session || !uiId) throw new Error('Missing required: project, session, uiId');

            const response = await apiFetch(
              `${API_BASE_URL}/api/ui-response?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&uiId=${encodeURIComponent(uiId)}`
            );

            if (!response.ok) {
              const error = await asJson(response);
              throw new Error(`Failed to get UI response: ${error.error || response.statusText}`);
            }

            return await response.text();
          }

          case 'register_claude_session': {
            const { project, session, claudePid } = args as { project: string; session: string; claudePid: string | number };
            if (!project || !session || claudePid === undefined || claudePid === null || claudePid === '') {
              return JSON.stringify({ success: false, error: 'Missing required: project, session, claudePid' });
            }
            const pidStr = String(claudePid).trim();
            if (!/^[0-9]+$/.test(pidStr)) {
              return JSON.stringify({ success: false, error: 'claudePid must be a positive integer' });
            }
            const fs = await import('fs');
            const pidFile = `/tmp/.claude-session-id-${pidStr}`;
            let claudeSessionId: string;
            try {
              claudeSessionId = fs.readFileSync(pidFile, 'utf-8').trim();
            } catch (err: any) {
              if (err && err.code === 'ENOENT') {
                return JSON.stringify({ success: false, error: `No Claude session ID file at ${pidFile}. Restart Claude so the SessionStart hook runs.` });
              }
              return JSON.stringify({ success: false, error: `Failed to read ${pidFile}: ${err?.message || String(err)}` });
            }
            if (!claudeSessionId) {
              return JSON.stringify({ success: false, error: `Claude session ID file ${pidFile} is empty. Restart Claude so the SessionStart hook runs.` });
            }
            if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(claudeSessionId)) {
              return JSON.stringify({ success: false, error: `Invalid session id format in ${pidFile} (expected UUID)` });
            }
            // Register in-memory so resolveSessionId works even if file write fails
            try {
              const { registerPidSession } = await import('../services/cdp-session.js');
              registerPidSession(Number(pidStr), session);
            } catch {}
            const bindingFile = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
            const bindingContent = JSON.stringify({
              claudeSessionId,
              project,
              session,
              claudePid: pidStr,
              boundAt: new Date().toISOString(),
            }, null, 2);
            try {
              // Try atomic tmp→rename; if rename fails (sticky-bit cross-user), fall back to direct write
              const bindingTmp = `${bindingFile}.tmp.${process.pid}`;
              fs.writeFileSync(bindingTmp, bindingContent, 'utf-8');
              try {
                fs.renameSync(bindingTmp, bindingFile);
              } catch {
                try { fs.unlinkSync(bindingTmp); } catch {}
                fs.writeFileSync(bindingFile, bindingContent, 'utf-8');
              }
            } catch (err: any) {
              // File write failed but in-memory registration already succeeded
              console.warn(`[register_claude_session] binding file write failed (${err?.message || String(err)}), using in-memory registration only`);
            }
            try {
              const response = await apiFetch(buildUrl('/api/claude-session/register', project, session), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claudeSessionId }),
              });
              if (!response.ok) {
                const text = await response.text().catch(() => '');
                return JSON.stringify({ success: false, error: `Server returned ${response.status}: ${text}` });
              }
              const data = await asJson(response);
              return JSON.stringify(data, null, 2);
            } catch (err: any) {
              return JSON.stringify({ success: false, error: `Failed to reach collab server: ${err?.message || String(err)}. Binding file was still written at ${bindingFile}.` });
            }
          }

          case 'check_server_health': {
            try {
              const response = await apiFetch(`${API_BASE_URL}/api/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
              });
              if (!response.ok) {
                return JSON.stringify({
                  healthy: false,
                  error: `Health check failed: ${response.statusText}`,
                }, null, 2);
              }
              return await response.text();
            } catch (error) {
              return JSON.stringify({
                healthy: false,
                error: error instanceof Error ? error.message : 'Server not responding',
              }, null, 2);
            }
          }

          case 'fleet_status': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify(await getFleetStatus(project), null, 2);
          }

          case 'get_install_path': {
            // Return the directory where this plugin is installed
            // import.meta.dir gives us the directory of this file (src/mcp/)
            // We need to go up two levels to get the plugin root
            const { dirname, join } = await import('path');
            const pluginRoot = dirname(dirname(dirname(import.meta.path)));
            return JSON.stringify({ path: pluginRoot }, null, 2);
          }

          case 'clear_session_artifacts': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');

            const [diagrams, documents, designs, snippets] = await Promise.all([
              apiFetch(buildUrl('/api/diagrams', project, session)).then(r => r.ok ? r.json() as Promise<AnyJson> : ({ diagrams: [] } as AnyJson)),
              apiFetch(buildUrl('/api/documents', project, session)).then(r => r.ok ? r.json() as Promise<AnyJson> : ({ documents: [] } as AnyJson)),
              handleListDesigns(project, session).catch(() => ({ designs: [] }) as AnyJson),
              handleListSnippets(project, session).catch(() => ({ snippets: [] }) as AnyJson),
            ]);

            const diagramIds: string[] = ((diagrams as AnyJson).diagrams || []).map((d: any) => d.id);
            const documentIds: string[] = ((documents as AnyJson).documents || []).map((d: any) => d.id);
            const designIds: string[] = ((designs as AnyJson).designs || []).map((d: any) => d.id);
            const snippetIds: string[] = ((snippets as AnyJson).snippets || []).map((s: any) => s.id);

            await Promise.all([
              ...diagramIds.map(id => apiFetch(buildUrl(`/api/diagram/${id}`, project, session), { method: 'DELETE' })),
              ...documentIds.map(id => apiFetch(buildUrl(`/api/document/${id}`, project, session), { method: 'DELETE' })),
              ...designIds.map(id => handleDeleteDesign(project, session, id).catch(() => {})),
              ...snippetIds.map(id => handleDeleteSnippet(project, session, id).catch(() => {})),
            ]);

            return JSON.stringify({
              success: true,
              cleared: {
                diagrams: diagramIds.length,
                documents: documentIds.length,
                designs: designIds.length,
                snippets: snippetIds.length,
              },
              message: `Cleared ${diagramIds.length} diagrams, ${documentIds.length} documents, ${designIds.length} designs, ${snippetIds.length} snippets`,
            }, null, 2);
          }

          case 'consult_grok': {
            const { prompt, system, model = 'grok-4.5' } = args as { prompt: string; system?: string; model?: string };
            if (!prompt) throw new Error('Missing required: prompt');

            // User-managed secret: config.json (Settings UI) is authoritative
            // over a stale ambient XAI_API_KEY inherited via the hook respawn.
            const apiKey = getSecret('XAI_API_KEY');
            if (!apiKey) throw new Error('XAI_API_KEY is not set (env or ~/.mermaid-collab/config.json)');

            const messages: Array<{ role: string; content: string }> = [];
            if (system) messages.push({ role: 'system', content: system });
            messages.push({ role: 'user', content: prompt });

            const response = await fetch('https://api.x.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify({ model, messages }),
            });

            if (!response.ok) {
              const raw = await response.text();
              let detail = raw;
              try {
                const parsed = JSON.parse(raw) as any;
                // xAI returns either { error: { message } } or a flat { code, error: "<string>" }
                detail = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : '') || parsed?.message || raw;
              } catch { /* non-JSON body — use raw text */ }
              throw new Error(`Grok API error (${response.status} ${response.statusText}): ${detail || '(no body)'}`);
            }

            const data = await response.json() as any;
            const reply = data.choices?.[0]?.message?.content ?? '';

            // Track this LLM call's spend (source 'consult-grok') like every other call.
            recordSpend({
              project: (args as any).project ?? 'consult',
              source: 'consult-grok',
              provider: 'grok',
              model,
              usage: {
                inputTokens: data.usage?.prompt_tokens ?? 0,
                outputTokens: data.usage?.completion_tokens ?? 0,
                cacheReadTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
              },
            });

            return JSON.stringify({
              model,
              response: reply,
              usage: data.usage,
            }, null, 2);
          }

          case 'consult_codex': {
            const { prompt, system, model } = args as { prompt: string; system?: string; model?: string };
            const result = await consultCodex({ prompt, system, model });
            // Track this LLM call's spend (source 'consult-codex').
            recordSpend({
              project: (args as any).project ?? 'consult',
              source: 'consult-codex',
              provider: 'openai',
              model: result.model ?? model ?? '',
              usage: {
                inputTokens: (result.usage?.prompt_tokens as number) ?? 0,
                outputTokens: (result.usage?.completion_tokens as number) ?? 0,
                costUsd: (result.usage?.costUsd as number) ?? undefined,
              },
            });
            return JSON.stringify(result, null, 2);
          }

          case 'archive_session': {
            const { project, session, delete_session, timestamp } = args as {
              project: string;
              session: string;
              delete_session?: boolean;
              timestamp?: boolean;
            };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await archiveSession(project, session, {
              deleteSession: delete_session,
              timestamp,
            });
            return JSON.stringify(result, null, 2);
          }

          case 'archive_by_prefix': {
            const { project, session, prefix, exclude_prefixes, extra_names, archive_slug } = args as {
              project: string;
              session: string;
              prefix: string;
              exclude_prefixes?: string[];
              extra_names?: string[];
              archive_slug?: string;
            };
            if (!project || !session || !prefix) throw new Error('Missing required: project, session, prefix');
            const result = await archiveByPrefix(project, session, prefix, {
              excludePrefixes: exclude_prefixes,
              extraNames: extra_names,
              archiveSlug: archive_slug,
            });
            return JSON.stringify(result, null, 2);
          }

          case 'update_task_status': {
            const { project, session, taskId, status, minimal } = args as {
              project: string;
              session: string;
              taskId: string;
              status: 'pending' | 'in_progress' | 'completed' | 'failed';
              minimal?: boolean;
            };
            if (!project || !session || !taskId || !status) throw new Error('Missing required: project, session, taskId, status');
            const wsHandler = getWebSocketHandler();
            const result = await updateTaskStatus({ project, session, taskId, status, minimal }, wsHandler || undefined);
            return JSON.stringify(result, null, 2);
          }

          case 'update_tasks_status': {
            const { project, session, updates, minimal } = args as {
              project: string;
              session: string;
              updates: Array<{ taskId: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }>;
              minimal?: boolean;
            };
            if (!project || !session || !updates || updates.length === 0) throw new Error('Missing required: project, session, updates (non-empty array)');
            const wsHandler = getWebSocketHandler();
            const result = await updateTasksStatus({ project, session, updates, minimal }, wsHandler || undefined);
            return JSON.stringify(result, null, 2);
          }

          case 'get_task_graph': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await getTaskGraph({ project, session });
            return JSON.stringify(result, null, 2);
          }

          case 'sync_task_graph': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const batches = await syncTasksFromTaskGraph(project, session);
            return JSON.stringify({ success: true, batches, totalTasks: batches.reduce((n, b) => n + b.tasks.length, 0), waves: batches.length }, null, 2);
          }

          case 'add_lesson': {
            const { project, session, lesson, category } = args as {
              project: string;
              session: string;
              lesson: string;
              category?: 'universal' | 'codebase' | 'workflow' | 'gotcha';
            };
            if (!project || !session || !lesson) throw new Error('Missing required: project, session, lesson');
            const result = await addLesson(project, session, lesson, category);
            return JSON.stringify(result, null, 2);
          }

          case 'list_lessons': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await listLessons(project, session);
            return JSON.stringify(result, null, 2);
          }

          case 'record_friction': {
            const a = args as {
              project: string; todoId?: string;
              layer: import('../services/friction-store.js').FrictionLayer;
              retryReason: string; session?: string; attempt?: number; detail?: string;
            };
            if (!a.project || !a.layer || !a.retryReason) {
              throw new Error('Missing required: project, layer, retryReason');
            }
            const result = await recordFrictionTool(a);
            return JSON.stringify(result, null, 2);
          }

          case 'report_dogfood': {
            const a = args as { project: string; reason: string; detail?: string; todoId?: string };
            if (!a.project || !a.reason) throw new Error('Missing required: project, reason');
            const result = await reportDogfoodTool(a);
            return JSON.stringify(result, null, 2);
          }

          case 'list_friction': {
            const a = args as {
              project: string; todoId?: string; session?: string;
              layer?: import('../services/friction-store.js').FrictionLayer;
            };
            if (!a.project) throw new Error('Missing required: project');
            const result = listFrictionTool(a);
            return JSON.stringify(result, null, 2);
          }

          // Session todos tools
          case 'list_session_todos': {
            const { project, session, includeCompleted, assigneeSession, status, compact, descriptionLimit } = args as {
              project: string;
              session: string;
              includeCompleted?: boolean;
              assigneeSession?: string;
              status?: import('../services/todo-store.js').TodoStatus;
              compact?: boolean;
              descriptionLimit?: number;
            };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await listSessionTodos(project, session, { includeCompleted, assigneeSession, status, compact, descriptionLimit });
            return JSON.stringify(result, null, 2);
          }

          case 'add_session_todo': {
            const { kind, parentId, inbox } = (args ?? {}) as { kind?: TodoKind; parentId?: string | null; inbox?: boolean };
            if (kind === 'mission') {
              throw new Error('add_session_todo is removed. Use create_mission to create a mission.');
            }
            if (kind === 'epic') {
              throw new Error('add_session_todo is removed. Use create_epic to create an epic.');
            }
            if (parentId) {
              throw new Error('add_session_todo is removed. Use add_leaves (parentId targets an existing epic) to add a leaf.');
            }
            if (inbox) {
              throw new Error('add_session_todo is removed. Use file_to_bucket to file an unplanned item into the Inbox.');
            }
            throw new Error('add_session_todo is removed. Use create_epic (kind:\'epic\'), add_leaves (a leaf under an existing epic), create_mission (kind:\'mission\'), or file_to_bucket (inbox:true / parentless).');
          }

          case 'update_session_todo': {
            const { project, session, id, text, title, completed, order, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, sessionName, targetProject, servesCriterionId, servesCriterionIds, tier } = args as {
              project: string;
              session: string;
              id: string;
              text?: string;
              title?: string;
              completed?: boolean;
              order?: number;
              link?: SessionTodoLink | null;
              assigneeSession?: string;
              assigneeKind?: 'agent' | 'human';
              completedBy?: string | null;
              description?: string;
              status?: import('../services/todo-store.js').TodoStatus;
              priority?: 0 | 1 | 2 | 3 | 4 | null;
              dueDate?: string;
              dependsOn?: string[];
              parentId?: string | null;
              sessionName?: string | null;
              targetProject?: string | null;
              servesCriterionId?: string | null;
              servesCriterionIds?: string[] | null;
              tier?: import('../services/todo-store.js').LeafTier | null;
            };
            if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
            const result = await updateSessionTodo(project, session, id, { text, title, completed, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, sessionName, targetProject, servesCriterionId, servesCriterionIds, tier });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined, previousAssigneeSession: result.previousAssigneeSession ?? undefined });
            return JSON.stringify({ ...deriveTodoViews(project, [result])[0], previousAssigneeSession: result.previousAssigneeSession ?? undefined }, null, 2);
          }

          case 'toggle_session_todo': {
            const { project, session, id, completed } = args as {
              project: string;
              session: string;
              id: string;
              completed?: boolean;
            };
            if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
            const result = await toggleSessionTodo(project, session, id, completed);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined });
            return JSON.stringify({ ...deriveTodoViews(project, [result])[0] }, null, 2);
          }

          case 'remove_session_todo': {
            const { project, session, id } = args as {
              project: string;
              session: string;
              id: string;
            };
            if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
            const result = await removeSessionTodo(project, session, id);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result?.ownerSession, assigneeSession: result?.assigneeSession ?? undefined });
            return JSON.stringify(result, null, 2);
          }

          case 'clear_completed_session_todos': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const result = await clearCompletedSessionTodos(project, session);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
            return JSON.stringify(result, null, 2);
          }

          case 'reorder_session_todos': {
            const { project, session, orderedIds } = args as {
              project: string;
              session: string;
              orderedIds: string[];
            };
            if (!project || !session || !Array.isArray(orderedIds)) throw new Error('Missing required: project, session, orderedIds');
            const result = await reorderSessionTodos(project, session, orderedIds);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
            return JSON.stringify(result, null, 2);
          }

          case 'assign_session_todo': {
            const { project, session, id, assigneeSession } = args as {
              project: string;
              session: string;
              id: string;
              assigneeSession: string | null;
            };
            if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
            const result = await assignSessionTodo(project, session, id, assigneeSession);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined, previousAssigneeSession: result.previousAssigneeSession ?? undefined });
            return JSON.stringify({ ...deriveTodoViews(project, [result])[0], previousAssigneeSession: result.previousAssigneeSession ?? undefined }, null, 2);
          }

          case 'deploy_self': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const result = await requestSelfDeploy(project);
            return JSON.stringify(result, null, 2);
          }
          case 'complete_linked_todos': {
            const { project, session, blueprintId, taskId } = args as {
              project: string; session: string; blueprintId: string; taskId?: string;
            };
            if (!project || !session || !blueprintId) throw new Error('Missing required: project, session, blueprintId');
            const result = await completeTodosForTask(project, session, blueprintId, taskId);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
            return JSON.stringify(result, null, 2);
          }

          case 'deprecate_artifact': {
            const { project, session, id, deprecated } = args as { project: string; session: string; id: string; deprecated: boolean };
            if (!project || !session || !id || deprecated === undefined) throw new Error('Missing required: project, session, id, deprecated');
            const response = await apiFetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deprecated }),
            });
            if (!response.ok) throw new Error(`Failed to set deprecated: ${response.statusText}`);
            return JSON.stringify({ success: true, deprecated, id });
          }

          case 'set_artifact_metadata': {
            const { project, session, id, blueprint, locked, pinned, deprecated } = args as {
              project: string; session: string; id: string;
              blueprint?: boolean; locked?: boolean; pinned?: boolean; deprecated?: boolean;
            };
            if (!project || !session || !id) throw new Error('Missing required: project, session, id');
            const updates: Record<string, boolean> = {};
            if (blueprint !== undefined) { updates.blueprint = blueprint; updates.locked = blueprint; }
            if (locked !== undefined) updates.locked = locked;
            if (pinned !== undefined) updates.pinned = pinned;
            if (deprecated !== undefined) updates.deprecated = deprecated;
            const response = await apiFetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updates),
            });
            if (!response.ok) throw new Error(`Failed to set metadata: ${response.statusText}`);
            return JSON.stringify({ success: true, id, updates });
          }

          case 'desktop_screenshot': {
            const a = (args ?? {}) as { project?: string; session?: string; format?: 'png' | 'jpeg' };
            const { base64 } = await withDesktopRetry(async () => {
              const d = await getDesktopDriver();
              return d.screenshot({ format: a.format });
            });
            if (a.project && a.session) {
              const imagesDir = pathJoin(a.project, '.collab', 'sessions', a.session, 'images');
              await mkdir(imagesDir, { recursive: true });
              const ext = a.format === 'jpeg' ? 'jpg' : 'png';
              const filePath = pathJoin(imagesDir, `desktop-screenshot-${Date.now()}.${ext}`);
              await writeFile(filePath, Buffer.from(base64, 'base64'));
              return JSON.stringify({ saved: filePath }, null, 2);
            }
            return JSON.stringify({ base64 });
          }
          case 'desktop_navigate':
          case 'desktop_eval':
          case 'desktop_click':
          case 'desktop_fill':
          case 'desktop_wait_for':
          case 'desktop_snapshot':
          case 'desktop_list_targets': {
            const handler = desktopHandlers[name];
            if (!handler) throw new Error(`Unknown desktop tool: ${name}`);
            return await withDesktopRetry(() => handler(args ?? {}));
          }

          case 'instance_topology': {
            const topology = await instanceTopology();
            return JSON.stringify(topology, null, 2);
          }
          case 'launch_remote_server': {
            const { host, port, user, password, command, token, detectOnly } = args as {
              host?: string; port?: number; user?: string; password?: string;
              command?: string; token?: string; detectOnly?: boolean;
            };
            if (!host) throw new Error('Missing required: host');
            if (/@/.test(host)) {
              throw new Error(`host must be a bare host/IP, not "${host}" — put the SSH user in the "user" arg instead`);
            }
            const { detectRemoteLaunch, launchRemoteServer } = await import('../services/remote-launch.js');
            const p = Number(port) || 9002;

            // Phase 1: detect — unless the caller supplied an explicit command to launch.
            let detect: Awaited<ReturnType<typeof detectRemoteLaunch>> | undefined;
            if (!command || detectOnly) {
              detect = await detectRemoteLaunch({ host, port: p, user: user?.trim() || undefined, password: password || undefined, token: token?.trim() || undefined });
            }
            if (detectOnly) {
              return JSON.stringify({ phase: 'detect', detect }, null, 2);
            }

            // Resolve what to launch: caller's command wins, else the synthesized one.
            const effectiveCommand = command || detect?.suggestedCommand;
            const effectiveToken = token?.trim() || detect?.token;
            if (!effectiveCommand) {
              return JSON.stringify(
                { phase: 'detect', ok: false, detect, error: detect?.note || detect?.error || 'no launchable command — provide `command` or install bun/mermaid-collab on the remote' },
                null, 2,
              );
            }

            // Phase 2: launch.
            const launch = await launchRemoteServer({ host, port: p, user: user?.trim() || undefined, password: password || undefined, command: effectiveCommand, token: effectiveToken });
            return JSON.stringify({ phase: 'launch', detect, launch, token: effectiveToken }, null, 2);
          }
          case 'system_status': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify(await systemStatus(project), null, 2);
          }
          case 'daemon_status': {
            const { project } = args as { project?: string };
            const now = Date.now();
            const STALE_MS = 15 * 60 * 1000;
            const inflight = listLeafInflight({ project }).map((r) => ({
              leafId: r.leafId,
              project: r.project,
              epicId: r.epicId ?? null,
              nodeKind: r.nodeKind ?? null,
              model: r.model ?? null,
              attempt: r.attempt ?? null,
              startedAt: r.startedAt,
              elapsedMs: now - r.startedAt,
              stale: now - r.startedAt > STALE_MS,
            }));
            // Transparency: when scoped to a project, also report WHY ready leaves
            // aren't being claimed (over-budget / breaker / probe-down / stranded-
            // foundation / not-headless) — so "auto, ticking, 0 in_progress" is never
            // an unexplained silence. Omitted for the all-projects view (no single set).
            const claimSuppression = project ? await diagnoseClaimSuppression(project) : undefined;
            const state = inflight.length > 0
              ? 'working'
              : claimSuppression?.blocked
                ? 'blocked-on-decision'
                : (claimSuppression?.suppressed.length ?? 0) > 0
                  ? 'claims-suppressed'
                  : (claimSuppression?.claimable ?? 0) > 0 ? 'claimable' : 'idle';
            return JSON.stringify({ now, state, inflight, breaker: { open: breakerOpen() }, ...(claimSuppression ? { claimSuppression } : {}) }, null, 2);
          }
          case 'friction_trends': {
            const { project, layer, limit } = args as { project: string; layer?: import('../services/friction-store.js').FrictionLayer; limit?: number };
            if (!project) throw new Error('Missing required: project');
            const trends = frictionTrends(project, { layer, limit });
            return JSON.stringify(trends, null, 2);
          }
          case 'orchestrator_off': {
            // STEWARD KILL-SWITCH (one-way): force the project's level to 'off'.
            // Brake-only — there is deliberately NO MCP affordance for the steward
            // to set any non-off level (raising stays human-only on the Bridge).
            const { project } = args as { project?: string };
            const target = project || process.cwd();
            const { orchestratorOff } = await import('../services/orchestrator-config.js');
            const level = orchestratorOff(target);
            // E1: braking the project must STOP its live runs, not just gate new claims —
            // kill each in-flight leaf's subprocess group. The aborted run's late
            // completion is a no-op via E2's ownership-CAS (no merge/accept).
            const { killLeafProcsForProject } = await import('../services/leaf-subprocess-registry.js');
            const killedLeaves = killLeafProcsForProject(target);
            recordSupervisorDecision('override', target, 'steward', JSON.stringify({ action: 'orchestrator_off', killedLeaves }));
            return JSON.stringify({ project: target, level, killedLeaves }, null, 2);
          }
          case 'runtime_config': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify(runtimeConfig(project), null, 2);
          }
          case 'submit_reconcile_result': {
            const { reconcileId, mergedGraph, newConstraints } = args as { reconcileId: string; mergedGraph: unknown[]; newConstraints?: unknown[] };
            const coercedMergedGraph = coerceArrayArg(mergedGraph, 'mergedGraph');
            const coercedNewConstraints = coerceArrayArg(newConstraints, 'newConstraints');
            if (!reconcileId || !Array.isArray(coercedMergedGraph)) throw new Error('Missing required: reconcileId, mergedGraph');
            const accepted = resolveReconcile(reconcileId, { mergedGraph: coercedMergedGraph as any, newConstraints: coercedNewConstraints as any });
            return JSON.stringify({ accepted, reason: accepted ? undefined : 'no-pending-request (timed out or unknown id)' }, null, 2);
          }
          case 'create_decision_record': {
            const { project, kind, title, rationale, alternatives, spec, linkedTodos, epicId, authorSession } = args as { project: string; kind: DecisionKind; title: string; rationale?: string; alternatives?: string[]; spec?: RequirementSpec; linkedTodos?: string[]; epicId?: string; authorSession?: string };
            if (!project || !kind || !title) throw new Error('Missing required: project, kind, title');
            return JSON.stringify(createDecisionRecord(project, { kind, title, rationale, alternatives, spec, linkedTodos, epicId: epicId ?? null, authorSession }), null, 2);
          }
          case 'list_decision_records': {
            const { project, epicId, kind, status } = args as { project: string; epicId?: string; kind?: DecisionKind; status?: 'proposed' | 'approved' | 'active' | 'superseded' };
            if (!project) throw new Error('Missing required: project');
            const filter: { epicId?: string; kind?: DecisionKind; status?: 'proposed' | 'approved' | 'active' | 'superseded' } = {};
            if (epicId !== undefined) filter.epicId = epicId;
            if (kind) filter.kind = kind;
            if (status) filter.status = status;
            return JSON.stringify({ records: listDecisionRecords(project, filter) }, null, 2);
          }
          case 'approve_decision_record': {
            const { project, id, approvedBy } = args as { project: string; id: string; approvedBy: string };
            if (!project || !id || !approvedBy) throw new Error('Missing required: project, id, approvedBy');
            const rec = approveDecisionRecord(project, id, approvedBy);
            if (!rec) throw new Error(`decision record not found: ${id}`);
            // Readiness-gates P2: approving the record auto-completes any [GATE]
            // todo linked to it (decisionRef===id), unblocking gated work on the
            // same tick. Landing the design = approving the record = gate cleared.
            const clearedGates = await completeGatesForDecision(project, id);
            if (clearedGates.length > 0) getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify({ ...rec, clearedGates: clearedGates.map((r) => ({ gate: r.completed.id, promoted: r.promoted })) }, null, 2);
          }
          case 'supersede_decision_record': {
            const { project, id, bySupersedingId } = args as { project: string; id: string; bySupersedingId: string };
            if (!project || !id || !bySupersedingId) throw new Error('Missing required: project, id, bySupersedingId');
            const rec = supersedeDecisionRecord(project, id, bySupersedingId);
            if (!rec) throw new Error(`decision record not found: ${id}`);
            return JSON.stringify(rec, null, 2);
          }
          case 'get_active_constraints': {
            const { project, epicId } = args as { project: string; epicId?: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify({ constraints: getActiveConstraints(project, epicId) }, null, 2);
          }
          case 'get_active_requirements': {
            const { project, epicId } = args as { project: string; epicId?: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify({ requirements: getActiveRequirements(project, epicId) }, null, 2);
          }
          case 'spec_coverage': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify({ coverage: specCoverage(project) }, null, 2);
          }
          case 'cartographer_health': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify({ health: specHealth(project) }, null, 2);
          }
          case 'cartographer_sync': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify(syncShortlist(project), null, 2);
          }
          case 'list_system_objects': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            return JSON.stringify({ objects: listObjects(project), types: listTypes(project) }, null, 2);
          }
          case 'system_object_bom': {
            const { project, rootId } = args as { project: string; rootId: string };
            if (!project || !rootId) throw new Error('Missing required: project, rootId');
            return JSON.stringify({ lines: bom(project, rootId) }, null, 2);
          }
          case 'decide_requirement': {
            const { project, id, decision, approvedBy, spec, title } = args as { project: string; id: string; decision: RequirementDecision; approvedBy?: string; spec?: RequirementSpec; title?: string };
            if (!project || !id || !decision) throw new Error('Missing required: project, id, decision');
            return JSON.stringify(decideRequirement(project, { id, decision, approvedBy, spec, title }), null, 2);
          }
          case 'check_graph_drift': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const tasks = await getTaskGraphTasks(project, session);
            const nodes: DriftNode[] = tasks.map((t) => ({ id: t.id, dependsOn: t['depends-on'] ?? [], files: t.files ?? [], title: t.id }));
            const findings = checkGraphDrift(project, nodes);
            return JSON.stringify({ findings, tasksScanned: nodes.length }, null, 2);
          }
          case 'orchestrator_status': {
            // Live daemon runtime snapshot. Thin wrapper over the worker pool +
            // the orchestrator level/health. Read-only; returns running:false
            // cleanly when the daemon is stopped.
            const { listPool } = await import('../services/worker-pool.js');
            const { getColdStartsInFlight } = await import('../services/coordinator-live.js');

            // SINGLE SOURCE OF TRUTH (BUG 7fb16985): read the SAME statically-bound
            // getOrchestratorHealth that system_status uses (via system-status.js).
            // The previous dynamic-import loop could load a second module record
            // with its own daemon `timer`/level state, making the two read-models
            // disagree on running/level/projects. They now share one module.
            const health: { running: boolean; tickMs?: number; lastTickAt?: number | null; projects?: Array<{ project: string; level: string }> } = getOrchestratorHealthSST();

            // One slot row per OCCUPIED lane (a registered slot is an occupied lane).
            // The registry is partitioned by project, so each row carries its project.
            const pool = listPool().map((s) => ({
              project: s.project,
              session: s.sessionName,
              type: s.type,
              provider: s.provider, // PAW P3: provider-tagged slot (DORMANT → 'claude')
              slot: s.slot,
              status: s.status,
              todoId: s.currentTodoId ?? null,
            }));

            // recentSpawns: the durable spawn audit trail, most-recent-first.
            let recentSpawns: unknown[] = [];
            try {
              recentSpawns = supervisorStore.listSupervisorAudit({ kind: 'spawn', limit: 10 });
            } catch {
              // best-effort
            }

            // B6 — recentAutonomousMutations: the in-memory ring of self-driven mutations
            // (reserve-leaf / deploy-refusal / terminal-deactivate), newest-first. Scoped to
            // the caller's project when given (global entries always included), else all.
            // Read is fail-open — a throw here must never sink the whole status snapshot.
            const { project: statusProject } = (args ?? {}) as { project?: string };
            let recentAutonomousMutations: unknown[] = [];
            try {
              const { recentAutonomousMutations: readAutonomy } = await import('../services/autonomy-log.js');
              recentAutonomousMutations = readAutonomy(statusProject ? { project: statusProject } : {});
            } catch {
              // best-effort
            }

            return JSON.stringify({
              running: health.running,
              tickMs: health.tickMs ?? null,
              lastTickAt: health.lastTickAt ?? null,
              projects: health.projects ?? [],
              pool,
              coldStartsInFlight: getColdStartsInFlight(),
              recentSpawns,
              recentAutonomousMutations,
            }, null, 2);
          }
          case 'set_watchdog_threshold': {
            const { project, thresholdPercent } = args as { project: string; thresholdPercent: number | null };
            if (!project) throw new Error('Missing required: project');
            if (thresholdPercent !== null && (typeof thresholdPercent !== 'number' || thresholdPercent < 1 || thresholdPercent > 100)) {
              throw new Error('thresholdPercent must be a number 1-100, or null to clear');
            }
            supervisorStore.setWatchdogThreshold(project, thresholdPercent);
            return JSON.stringify({ project, thresholdPercent }, null, 2);
          }
          case 'set_context_recycle': {
            const { project, mode } = args as { project: string; mode: string };
            if (!project || !mode) throw new Error('Missing required: project, mode');
            if (mode !== 'off' && mode !== 'notify' && mode !== 'force') {
              throw new Error("mode must be one of: off, notify, force");
            }
            supervisorStore.setContextRecycleMode(project, mode);
            return JSON.stringify({ project, mode }, null, 2);
          }
          case 'context_usage': {
            // Read-only per-session context-window report. Built from the SAME
            // watchdog selector that supervisor_watchdog_scan uses, so the
            // nearThreshold flag + watchdogAction match the watchdog's view of
            // who is near a checkpoint/clear boundary.
            const { project, thresholdPercent } = args as { project: string; thresholdPercent?: number };
            if (!project) throw new Error('Missing required: project');
            // Precedence: explicit arg → per-project config → built-in default.
            const effectiveThreshold = thresholdPercent ?? supervisorStore.getWatchdogThreshold(project) ?? DEFAULT_WATCHDOG_CONFIG.thresholdPercent;
            const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: effectiveThreshold };
            const now = Date.now();
            const runtimes = listSessionRuntimes(project, now);
            // The watchdog's authoritative per-session verdict for this tick.
            const actionBySession = new Map(
              selectWatchdogActions(runtimes, now, cfg).map((a) => [a.session, a] as const),
            );
            const sessions = runtimes.map((r) => {
              const action = actionBySession.get(r.session) ?? null;
              return {
                session: r.session,
                status: r.status,
                contextPercent: r.contextPercent,
                contextAgeMs: r.contextUpdatedAt != null ? now - r.contextUpdatedAt : null,
                checkpointReadyAt: r.checkpointReadyAt,
                nearThreshold: action != null,
                watchdogAction: action?.action ?? null,
                reason: action?.reason ?? null,
              };
            });
            return JSON.stringify({ project, thresholdPercent: effectiveThreshold, sessions }, null, 2);
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
