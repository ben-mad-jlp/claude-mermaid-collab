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
import { API_BASE_URL, buildUrl, asJson, type AnyJson, sessionParamsDesc } from './tools/http-util.js';
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
import { sendTmuxKeys } from '../services/tmux-send.js';
import { launchAndBind } from '../services/claude-launch.js';
import { recordCheckpointReady, clearCheckpointReady, isCheckpointReady, tryEmitWatchdogAction, resetWatchdogDebounce } from '../services/session-status-store.js';
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
import { lastAssistantTurn } from '../services/transcript-reader.js';
import { listTodos, getTodo, resetTodo, overrideAcceptTodo, createGate, completeGatesForDecision, deriveTodoViews } from '../services/todo-store.js';
import type { TodoKind } from '../services/todo-kind.js';
import { MISSION_TOOL_DEFS, handleMissionTool } from './mission-tools.js';
import { SNIPPET_TOOL_DEFS, handleSnippetTool } from './snippet-tools.js';
import { EMBED_TOOL_DEFS, handleEmbedTool } from './embed-tools.js';
import { IMAGE_TOOL_DEFS, handleImageTool } from './image-tools.js';
import {
  DOCUMENT_TOOL_DEFS, handleDocumentTool,
  listDocuments, getDocument, createDocument,
} from './document-tools.js';
import { BROWSER_TOOL_DEFS, handleBrowserTool } from './browser-tools.js';
import { SPREADSHEET_TOOL_DEFS, handleSpreadsheetTool, listSpreadsheets } from './spreadsheet-tools.js';
import {
  DIAGRAM_TOOL_DEFS, handleDiagramTool,
  listDiagrams, getDiagram, createDiagram,
} from './diagram-tools.js';
import { DESIGN_TOOL_DEFS, handleDesignTool } from './design-tools.js';
// Design service handlers still called directly by non-design flows (clear-artifacts,
// session summary); the design tool group itself lives in ./design-tools.ts.
import { handleCreateDesign, handleGetDesign, handleListDesigns, handleDeleteDesign } from './tools/design.js';
import { briefEscalation } from '../services/escalation-briefing.js';
import { checkInvariants } from '../services/invariant-check.js';
import { gateStatus } from '../services/gate-status.js';
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
import { getEpicBranchStatus } from '../services/epic-branch-status.js';
import { getLeafRun, listLeafRuns } from '../services/ledger-stats.js';
import { listLeafInflight } from '../services/worker-ledger.js';
import { breakerOpen } from '../services/headless-breaker.js';
import { frictionTrends } from '../services/friction-trends.js';
import { runtimeConfig } from '../services/runtime-config.js';
import { validateStewardProof, isOverrideRateLimited, type StewardProof, type StewardVerb } from '../services/steward-proof.js';
import { getConfig, getSecret } from '../services/config-service.js';
import { consultCodex } from '../services/consult-openai.js';
import { handleWorkerComplete } from '../services/coordinator-daemon.js';
import { makeCoordinatorDeps, landEpic, diagnoseClaimSuppression, resolveEpicId } from '../services/coordinator-live.js';
import { checkOwnership, landedByTrailer, type LandActor } from '../services/land-authority.js';
import { requestSelfDeploy } from '../services/deploy-service.js';
import { awaitHumanDecision } from '../services/decision-relay.js';
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
async function peerFetch(serverId: string | undefined, path: string, init?: { method?: string; body?: any }): Promise<any> {
  if (!serverId) throw new Error('peerFetch requires serverId');
  const peer = supervisorStore.getPeer(serverId);
  if (!peer) throw new Error('unknown peer ' + serverId);
  // Tokenless direct call (P1 §2): peers carry no token. A peer that enforces
  // auth will 401 here, and the caller degrades to desktop-brokered routing.
  const res = await fetch(peer.baseUrl + path, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  return await res.json();
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
function recordSupervisorDecision(kind: string, project: string, session: string, detail?: string | null, serverId?: string): void {
  try {
    const entry = supervisorStore.recordSupervisorAudit({ kind, project, session, detail, serverId });
    getWebSocketHandler()?.broadcast({ type: 'supervisor_decision', project, session, kind, detail: entry.detail, ts: entry.ts });
  } catch { /* audit must never break the action it records */ }
}

/** Max auto override_accepts per hour (design §7 rail 2). Operator-tunable. */
const STEWARD_OVERRIDE_CAP = Math.max(0, parseInt(process.env.MERMAID_STEWARD_OVERRIDE_CAP ?? '2', 10) || 0);
/** Thrash cap K (design §7 rail 5): after this many steward attempts on one escalation, escalate systemic. */
const STEWARD_THRASH_CAP = Math.max(1, parseInt(process.env.MERMAID_STEWARD_THRASH_CAP ?? '3', 10) || 3);

interface StewardGateInput {
  verb: StewardVerb;
  project: string;
  todoId: string;
  proof?: StewardProof;
  escalationId?: string;
  changeSetFiles?: string[];
}
/** Decision from the server proof gate: allow the act, or reject + (re)route to human. */
interface StewardGateDecision { ok: boolean; reason: string; }

/**
 * The keystone safety rail (design §3/§5/§7, constraint 020b7ab1): under a steward
 * epoch, an act-verb is allowed ONLY when the SERVER re-derives the cited proof
 * from ground truth. Absent/false proof, rate-limit, or thrash → reject the act,
 * flip the linked escalation routedTo='human', and audit the deferral. Returns a
 * decision; the caller performs the actual reset/override only when ok=true.
 */
function stewardProofGate(input: StewardGateInput): StewardGateDecision {
  const { verb, project, todoId, proof, escalationId } = input;
  const audit = (kind: string, detail: string) =>
    supervisorStore.recordSupervisorAudit({ kind, project, session: 'steward', detail });
  const deferToHuman = (reason: string) => {
    if (escalationId) supervisorStore.setEscalationRoute(escalationId, 'human', proof ? JSON.stringify(proof) : null);
    audit('steward_defer', JSON.stringify({ verb, todoId, escalationId: escalationId ?? null, reason }));
    return { ok: false, reason };
  };

  // Thrash guard FIRST: a repeatedly-failing escalation is systemic, not retryable.
  if (escalationId) {
    const attempts = supervisorStore.incrementStewardAttempts(escalationId);
    if (attempts > STEWARD_THRASH_CAP) return deferToHuman(`thrash:${attempts}>${STEWARD_THRASH_CAP}`);
  }

  // override_accept rate-limit (the scary verb): cap auto-overrides/hr.
  if (verb === 'override_accept_todo') {
    const recent = supervisorStore
      .listSupervisorAudit({ project, kind: 'steward_override', limit: 1000 })
      .map((e) => e.ts);
    if (isOverrideRateLimited(recent, Date.now(), STEWARD_OVERRIDE_CAP)) {
      return deferToHuman(`rate-limit:${STEWARD_OVERRIDE_CAP}/hr`);
    }
  }

  const todo = getTodo(project, todoId);
  if (!todo) return deferToHuman('todo-not-found');

  const verdict = validateStewardProof(verb, proof, {
    project,
    dependsOn: todo.dependsOn ?? [],
    getDep: (id) => {
      const d = getTodo(project, id);
      return d ? { id: d.id, status: d.status, acceptanceStatus: d.acceptanceStatus } : null;
    },
    changeSetFiles: input.changeSetFiles,
  });
  if (!verdict.ok) return deferToHuman(verdict.reason);

  // Proof re-validated green → record the auto-act with its proof + escalation link.
  audit(verb === 'reset_todo' ? 'steward_reset' : 'steward_override',
    JSON.stringify({ todoId, escalationId: escalationId ?? null, proof }));
  return { ok: true, reason: 'ok' };
}

/**
 * Single-writer fence for mutating supervisor tools. Returns a structured
 * `superseded` payload (string) when the caller's epoch is no longer current —
 * the caller must then perform NO write and return this payload. Returns null
 * when the caller is the current owner OR did not supply an epoch at all.
 *
 * Enforced-WHEN-PRESENT by design: escalation_create is also called by ordinary
 * workers (which never carry a supervisor epoch), so the fence only bites when a
 * supervisor-context caller supplies `supervisorEpoch`. A superseded supervisor
 * still carries its (now stale) epoch and is correctly rejected.
 */
function supervisorFence(supervisorEpoch: number | undefined): string | null {
  if (supervisorEpoch == null) return null;
  try {
    supervisorStore.assertSupervisorOwner(supervisorEpoch);
    return null;
  } catch (e) {
    if (e instanceof supervisorStore.SupersededError) {
      return JSON.stringify(
        { superseded: true, currentEpoch: e.currentEpoch, currentSession: e.currentSession, message: e.message },
        null,
        2,
      );
    }
    throw e;
  }
}



// ============= Spreadsheet Tools =============

// ============= Archive By Prefix =============

interface ArchiveByPrefixResult {
  archived: Array<{ type: string; oldName: string; oldId: string; newName: string; newId: string }>;
  errors: Array<{ type: string; id: string; name: string; error: string }>;
  slug: string;
}

async function deprecateItem(project: string, session: string, id: string): Promise<void> {
  const response = await fetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
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
    const response = await fetch(buildUrl(`/api/${type}/${id}`, project, session), {
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
  const response = await fetch(url);
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
        description: 'Recommend stale collab sessions + orphan tmuxes for cleanup (read-only). Returns sessions idle longer than `days` (default 30) — excluding any that are live-bound to a running Claude PID or hold in-progress work — plus tmux sessions with no attached client whose last activity is older than the window. Each item carries an age + reason. Clean up a recommended session with archive_session (it copies artifacts to docs/designs/ then optionally deletes), and a tmux with the /api/maintenance/kill-tmux route. This NEVER deletes anything itself.',
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
        name: 'add_session_todo',
        description: "Add a new per-session todo. Appended to the end of the list with an order value greater than any existing todo. Titles are stored BARE — never prefix a role into the title. The node's role is the `kind` column ('leaf' default | 'epic' | 'land' | 'mission'); pass it explicitly when creating an epic or a [LAND] leaf, and the UI renders the label from it. Bracketed TOPIC tags the human wrote ([UI], [BUG], ...) are content and are preserved verbatim.",
        inputSchema: addSessionTodoSchema,
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
      { name: 'spawn_planner', description: "Steward verb: spawn a per-project Planner session — registers + watches + supervises the project and launches a Claude running the /planner skill. By default the session is launched with Claude Code Remote Control so it's drivable from the Claude app (requires the launched session be logged into claude.ai). Use this to stand up a planner the human can drive remotely for a project.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Absolute project path (registered if not already)' }, session: { type: 'string', description: 'Session name (default "planner")' }, remoteControl: { type: 'boolean', description: 'Launch with --remote-control so it appears in the Claude app (default true)' } }, required: ['project'] } },
      { name: 'supervisor_list_supervised', description: 'List all supervised sessions across all projects.', inputSchema: { type: 'object', properties: {} } },
      { name: 'supervisor_nudge', description: 'Send text/keys into a supervised session tmux pane, routing to a peer server when serverId names a known peer.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, serverId: { type: 'string' }, text: { type: 'string' }, supervisorEpoch: { type: 'number', description: 'Ownership epoch. Pass it so the server can fence a superseded supervisor; a stale epoch is rejected (superseded) and performs no action.' } }, required: ['project', 'session', 'text'] } },
      { name: 'supervisor_reconcile', description: 'For every watched project, return session status + open-todo counts and the supervised flag.', inputSchema: { type: 'object', properties: { supervisorEpoch: { type: 'number', description: 'Ownership epoch; a superseded supervisor is rejected.' } } } },
      { name: 'read_last_assistant_turn', description: 'Read the last completed assistant turn from a Claude Code session transcript.', inputSchema: { type: 'object', properties: { claudeSessionId: { type: 'string' }, serverId: { type: 'string' } }, required: ['claudeSessionId'] } },
      { name: 'escalation_list', description: 'List open escalations.', inputSchema: { type: 'object', properties: {} } },
      { name: 'escalation_history', description: "Read-only escalation history — OPEN and RESOLVED escalations with how each was triaged and resolved (escalation_list shows OPEN only). The store is GLOBAL, so an unfiltered call spans all projects and defaults to the recent-N newest-first. FILTERS (all optional): epicId (resolves escalation.todoId → parentId chain → [EPIC] ancestor), project, todoId, session, status, kind, routedTo ('steward'=ai-resolved | 'human'=escalated-to-human), since/until (createdAt ms range), limit (default 50). PER-ROW: kind, status, createdAt/resolvedAt, timeToResolutionMs, routedTo, stewardAttempts, suggestedAction (Grok bucket+confidence+rationale), the human decision (optionId/note/decidedBy), resolutionActor (decider handle | 'daemon-auto'), recurrenceCount (how many escalations share project+session+questionText). With epicId, folds in that epic's decision records. summary:true returns aggregate counts (auto-resolved vs escalated-to-human), avg stewardAttempts, median timeToResolution, grouped by epic/project — answers 'is drive-level Grok triage resolving escalations or just bouncing them to the human?'.", inputSchema: { type: 'object', properties: { epicId: { type: 'string' }, project: { type: 'string' }, todoId: { type: 'string' }, session: { type: 'string' }, status: { type: 'string' }, kind: { type: 'string' }, routedTo: { type: 'string', enum: ['steward', 'human'] }, since: { type: 'number', description: 'Lower bound on createdAt (ms epoch).' }, until: { type: 'number', description: 'Upper bound on createdAt (ms epoch).' }, limit: { type: 'number', description: 'Recent-N cap, newest-first (default 50).' }, summary: { type: 'boolean', description: 'Return the aggregate breakdown instead of rows.' } } } },
      { name: 'escalation_resolve', description: 'Resolve an escalation by id with a status.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected.' } }, required: ['id', 'status'] } },
      { name: 'escalation_brief', description: "Get a DEEP markdown decision briefing for one escalation — Decision (with the fixed options + each consequence) / Situation (what led here) / System context (plan-graph blast radius, epic branch health, prior escalations) / Recommendation (labelled steward opinion). Generated LAZILY on first call from the enriched ground-truth bundle via the swappable triage tier-role LLM, then CACHED on the escalation (so a reload keeps it). FAILS OPEN to a deterministic no-LLM briefing on any model error. Pass refresh:true to regenerate. This is what the human reads to decide.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, escalationId: { type: 'string' }, refresh: { type: 'boolean', description: 'Regenerate even if a cached briefing exists.' } }, required: ['project', 'escalationId'] } },
      { name: 'land_epic', description: "LAND an epic onto master (FBPE P4 — human-gated, irreversible). Given an open 'epic-ready-to-land' escalation, the server RE-DERIVES land-readiness from ground truth at click time (children done+accepted; tsc clean in the epic worktree; epic branch dry-merges into master) — never trusts the card summary. On a green proof it performs ONE --no-ff epic→master merge behind a per-project land mutex, removes the epic branch+worktree, and resolves the card. A conflict leaves master UNTOUCHED and re-surfaces a human-rebase escalation. Clean-tree guard: refuses if the main checkout has uncommitted/untracked changes — pass allowDirty:true to override (dirty paths are still printed, an Allow-Dirty trailer is added to the land commit, and a friction note is recorded). Landing is a ROLE, not an autonomy level: a conductor lands its own mission's epics only; bucket roots and foreign missions are refused with the owner named. The actor is recorded in the response and audit trail.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project (where the work-graph + escalation live).' }, escalationId: { type: 'string', description: "The open 'epic-ready-to-land' escalation id to land." }, allowDirty: { type: 'boolean', description: "Bypass the clean-tree guard: land even though the main checkout has uncommitted/untracked changes. The dirty paths are still printed, an `Allow-Dirty: <paths>` trailer is added to the land commit, and an orchestration friction note is recorded. Per-call only — NOT a persistent flag." }, actor: { type: 'string', enum: ['human', 'conductor', 'daemon'], description: "Who is taking this irreversible action. Defaults to 'human'. 'conductor' additionally requires `session` and is gated on OWNERSHIP: the epic must be a descendant of that session's ACTIVE mission, and must not be a bucket root." }, session: { type: 'string', description: "Conductor session id. Required when actor='conductor'." } }, required: ['project', 'escalationId'] } },
      { name: 'deploy_self', description: "DEPLOY the running sidecar from its own repo (human-gated, STRICTLY SEPARATE from land). After a self-project epic lands, the live :9002 binary is stale against master; this rebuilds sidecar+UI and restarts the app. Server hard-gates self-project (project must equal the sidecar's MERMAID_PROJECT) AND macOS AND the presence of scripts/deploy-desktop.sh — never deploys another repo. Spawned DETACHED, so it survives killing this very process; returns immediately with a logPath to tail. Reasons: ok | not-self-project | unsupported-platform | deploy-script-missing | spawn-failed.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: "The project to deploy — must be the sidecar's own repo (MERMAID_PROJECT)." } }, required: ['project'] } },
      { name: 'escalation_create', description: 'Create (or dedupe) an open escalation for a session. Pass todoId to link it to a work-graph todo so it auto-resolves when that todo completes. For an A/B-style decision, pass structured options[] (and optionally recommended) instead of a raw JSON questionText.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, kind: { type: 'string' }, questionText: { type: 'string', description: 'Human-readable prompt for the decision/question.' }, todoId: { type: 'string', description: 'Optional work-graph todo id this escalation is about (exact auto-resolve link).' }, options: { type: 'array', description: 'Optional structured choices for an A/B-style decision.', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' } }, required: ['id', 'label'] } }, recommended: { type: 'string', description: 'Optional id of the recommended option (must match one of options[].id).' }, ui: { type: 'object', description: 'Optional rich decision spec (BR-4): { elements: [...] } over the closed catalog (Heading, Text, Callout, CodeBlock, DiffView, CompareTable, KeyValue, OptionButton, Form, SubmitButton). Server-validated; must contain a terminal action (OptionButton/SubmitButton/Form), ≤40 elements. Compose ONLY when the decision needs evidence (a diff/compare/form); otherwise use plain options[]. Invalid specs are dropped, falling back to options[].' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch. Workers escalating omit this; a superseded supervisor that passes its stale epoch is rejected (superseded).' } }, required: ['project', 'session', 'kind', 'questionText'] } },
      { name: 'await_human_decision', description: 'Block until a human posts a decision for the given escalation (via the decide endpoint), then return the chosen optionId + any note. Use after filing a structured escalation (escalation_create with options[]) to relay an A/B decision without ending the turn. Returns { timedOut: true } if no answer arrives within timeoutMs.', inputSchema: { type: 'object', properties: { escalationId: { type: 'string' }, timeoutMs: { type: 'number', description: 'Max time to wait in ms (default 600000 = 10 min).' } }, required: ['escalationId'] } },
      { name: 'supervisor_next_decision', description: 'On-demand supervisor LLM poll: return the oldest PENDING ambiguous-stop decision request (id, workerSession, signal, snapshot) the watchdog daemon enqueued, or null when the queue is empty. Read the snapshot, JUDGE, then call supervisor_resolve_decision. The LLM never loops or acts — it only judges; the daemon acts on the verdict.', inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Optional project scope; omit for all watched projects.' } } } },
      { name: 'supervisor_resolve_decision', description: 'Write a verdict for a pending decision request (the supervisor LLM\'s one judgment). verdict: escalate (surface to the human), nudge/resume (push the worker to continue), or wait (leave it). EPOCH-GATED: pass supervisorEpoch; a superseded supervisor is rejected and performs no write. The daemon acts on the verdict on its next tick.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['escalate', 'nudge', 'resume', 'wait'] }, reason: { type: 'string', description: 'Short rationale for the verdict (recorded for provenance).' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected (superseded).' } }, required: ['id', 'verdict'] } },
      { name: 'subscribe', description: 'Subscribe THIS registered collab session to notifications about a todo, an epic, a mission (every epic/leaf under it, including epics created in later iterations), or a whole project (nudge-to-pull). The notification router enqueues coalesced updates; a tiny tmux nudge then wakes the idle session, which drains them via the `inbox` tool and acts — so a steward session need not /loop or poll. scope=project omits targetId. Idempotent.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string', description: 'The collab session subscribing (must be registered).' }, scope: { type: 'string', enum: ['todo', 'epic', 'mission', 'project'] }, targetId: { type: 'string', description: 'Todo, epic, or mission id (required for scope todo/epic/mission; omit for project).' } }, required: ['project', 'session', 'scope'] } },
      { name: 'unsubscribe', description: 'Remove a subscription for THIS session. Pass scope (+ targetId for todo/epic/mission) to drop one, or all:true to drop every subscription for the session.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, scope: { type: 'string', enum: ['todo', 'epic', 'mission', 'project'] }, targetId: { type: 'string' }, all: { type: 'boolean', description: 'Drop ALL of this session\'s subscriptions (ignores scope/targetId).' } }, required: ['project', 'session'] } },
      { name: 'update_zen_summary', description: "Push THIS session's OWN Zen summary (self-report — the session knows its real state, no external pane-scrape/interpret needed). Folds straight into the Zen card as FRESH. `structured` = { paragraph: string (the glance: the GOAL first, then a blank line, then what we're doing now), status: 'working'|'idle'|'stuck'|'needs-input', detail?: string, question?: string (ONLY if WE asked the human something and are awaiting their reply), options?: [{label,valueToSend}], recommended?: int, multiSelect?: bool, suggestedAnswers?: string[], aiOption?: string } — the SAME schema the interpreter emits. Rejected if paragraph or a valid status is missing.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, structured: { type: 'object' } }, required: ['project', 'session', 'structured'] } },
      { name: 'list_subscriptions', description: 'List what THIS session is subscribed to (the nudge-to-pull subscriptions): every {scope, targetId, createdAt} for the session. Use it to SEE your subscriptions before dropping one (`unsubscribe` scope+targetId) or clearing all (`unsubscribe` all:true).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      { name: 'inbox', description: 'Drain THIS session\'s pending subscription notifications (the PULL half of nudge-to-pull). Returns + marks-seen every unseen update [{ scope, targetId, event, summary, payload, ts, tsLocal }] plus a top-level `servedAt` (epochMs/iso/local) stamping when you pulled. `tsLocal` is the human-readable wall-clock of each event; `ts` is its epoch ms. The FULL drain means a missed nudge self-heals on the next one. Call this when woken by a nudge (or any time) to see what changed on your subscribed todos/epics/projects, then act.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      { name: 'get_todo', description: "Read a single project work-graph todo by id (title, description/spec, status, dependsOn, sessionName). `status`/`derivedStatus` are the live-DERIVED state and `storedStatus` is the raw persisted value (an approved todo derives 'ready' while storedStatus stays 'planned'); also returns isClaimable + claimReason. Used by a worker to read its claimed todo.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' } }, required: ['project','todoId'] } },
      { name: 'complete_todo', description: 'Worker completion report: mark a project todo accepted or rejected (marks done + unblocks dependents).', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, acceptance: { type: 'string', enum: ['accepted','rejected'] }, claimToken: { type: 'string', description: 'The claim token of the run reporting completion; omit only for human/steward completions.' } }, required: ['project','todoId','acceptance'] } },
      { name: 'gate_status', description: "Read-only per-project acceptance-gate status. Returns the CONFIGURED gate command (the project's .collab/project.json `gateCommand`, the tsc/test invocation the completion gate runs) — or null + `gateConfigured:false` when the project uses the default worker change-set-scoped tsc+tests — plus the last N gate results per todo (from the durable supervisor audit trail): each carries { todoId, title, passed, acceptance, acceptanceStatus, ts, reason }. Lets the steward answer 'why is this todo blocked / how is the gate set up?' without spelunking the DB or manifest.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose gate config + recent results to report.' }, limit: { type: 'number', description: 'Max recent gate results to return (default 20, capped 200).' } }, required: ['project'] } },
      { name: 'invariant_check', description: "Read-only work-graph health check. Returns only the VIOLATIONS of the documented invariants (not the whole graph): orphan (non-epic todo with no epic (kind='epic') ancestor), stranded-epic (an epic with no land leaf (kind='land') beneath it), epic-planned-ready-child (epic still 'planned' with a 'ready' child), broken-depends-on (dependsOn points at a missing/dropped todo), blocked-on-nothing ('blocked' but every dep is done). A clean graph returns []. Each violation carries { kind, todoId, title, reason }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose work-graph to check.' } }, required: ['project'] } },
      { name: 'epic_branch_status', description: "Read-only git landing status per epic (kind='epic'). For each epic, reports its collab/epic/<id8> accumulation branch: exists?, ahead (unlanded commits vs master), behind (master commits the branch lacks), mergeable (trial merge has no conflicts), and landLeafDone (its land leaf (kind='land') is done). Flags `stranded` epics — branch ahead>0 but land leaf not done, i.e. 'done on the graph, unlanded on master' (the BP0 stranding). Pure git reads (rev-list/merge-tree), no mutation. Returns { project, baseRef, epics[], strandedCount }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose epics to check.' }, baseRef: { type: 'string', description: "Base branch to compare against (default 'master')." } }, required: ['project'] } },
      { name: 'epic_land_readiness', description: "Read-only land-presence check for one epic (kind='epic'). For the epic's FULL descendant set, every descendant that is accepted/done and is a CODE leaf must have a commit whose `Collab-Todo: <id>` trailer is reachable from collab/epic/<id8>. Containers (>=1 non-dropped child), [GATE] decision nodes, the land leaf (kind='land') and nested epics are exempt and reported as exemptions. A code leaf with a commit on a stray ref is 'stranded'; one with no commit anywhere is 'missing' (accepted nothing) — both BLOCK the land. Also counts DUPLICATE trailer commits per leaf (informational only; duplicate dispatch is safe recovery, never auto-fixed). Proves work LANDED, says nothing about whether it is CORRECT. Pure git reads; reports, never fixes. Returns { epicId, epicBranch, checked, findings[], exemptions[], duplicateCommits[], blocking }.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project.' }, epicId: { type: 'string', description: 'The epic todo id (full uuid or leading-8 prefix).' } }, required: ['project', 'epicId'] } },
      { name: 'instance_topology', description: "Read-only map of every live mermaid-collab server this machine knows about, each tagged CANONICAL vs STALE SHADOW. Joins the on-disk instance records (~/.mermaid-collab/instances: port, project/session, pid, version, startedAt), the canonical :9002 ownership lockfile + a live /api/health probe (together identifying the ONE process that actually owns the canonical port), and the in-memory remote-peer registry. The live :9002 owner is tagged `canonical`; any OTHER instance also claiming :9002 is a `shadow` (the 'deploy went cosmetic because a stale source server shadows the desktop sidecar' footgun); a server on its own port is a plain `instance`. `hasShadow:true` is the warning flag. Takes no args.", inputSchema: { type: 'object', properties: {} } },
      { name: 'launch_remote_server', description: "Start a collab server on a REMOTE machine over SSH — the same detect→launch flow the desktop 'Launch' button runs (POST /api/server/detect then /api/server/launch), exposed as one tool so it can be driven/tested headlessly. Runs on THIS sidecar (which owns the system `ssh`). Two phases: (1) DETECT — SSH into the host, probe for bun / a global mermaid-collab / the newest plugin-cache version dir, adopt the server's existing config.json token (or mint one), and synthesize a start command that binds 0.0.0.0 AND sets MERMAID_AUTH_TOKEN (a 0.0.0.0 bind is always auth-required — never an open LAN hole). (2) LAUNCH — SSH again, detach the server (setsid/nohup), and poll the remote /api/health. Pass `command` to skip detect and launch a specific command; pass `detectOnly:true` to only probe+synthesize and NOT launch. `password` is used once for the SSH prompt and never persisted; omit it to use keys/agent (BatchMode). Returns { detect?, launch?, token? } — the token is what a client must present to reach the launched (auth-required) server. NOTE: the host must be a bare host/IP; the SSH user goes in `user`, not baked into `host`.", inputSchema: { type: 'object', properties: { host: { type: 'string', description: 'Bare remote host or IP (NOT user@host). The SSH user goes in `user`.' }, port: { type: 'number', description: 'Port the server should listen on / be probed at (default 9002).' }, user: { type: 'string', description: 'SSH user (blank = ssh default / ~/.ssh/config).' }, password: { type: 'string', description: 'One-time SSH password. Never persisted. Omit to use keys/agent (BatchMode, fails fast).' }, command: { type: 'string', description: 'Explicit start command to launch. If omitted, detect synthesizes one. Ignored when detectOnly is true.' }, token: { type: 'string', description: "Existing bearer token to thread through so detect REUSES it (avoids diverging from the server's config-authoritative token)." }, detectOnly: { type: 'boolean', description: 'Only run the SSH probe + synthesize a command; do NOT launch. Returns { detect }.' } }, required: ['host'] } },
      { name: 'orchestrator_off', description: "STEWARD KILL-SWITCH (one-way): force a project's Orchestrator autonomy level to 'off', stopping the daemon from driving todos. This is the steward's ONLY autonomy control — it can ALWAYS brake but can NEVER raise the level (decision 3bf1292b). It takes no level argument; raising autonomy (build/nudge/propose/drive) stays human-only on the Bridge ladder. Reuses the server-side 'off' transition. Optional project (defaults to the server's cwd). Returns the resulting level for confirmation.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Project to brake (defaults to the current working directory).' } } } },
      { name: 'friction_trends', description: "Read-only recurrence rollup over the friction store. Groups the most-recent friction notes by LAYER (orchestration vs domain vs operational) with counts, and within each layer by retryReason, so a repeating problem (e.g. tmux-pane accumulation showing up as repeated orchestration friction) surfaces as a high-count reason instead of being buried in list_friction's flat newest-first list. Returns { total, considered, byLayer:[{ layer, count, reasons:[{ retryReason, count, sessions[], lastAt }] }], recurring:[{ layer, retryReason, count }] } — `recurring` is the cross-layer 'what keeps going wrong' shortlist (reasons seen >1, most-recurring first).", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose friction to roll up.' }, layer: { type: 'string', enum: ['orchestration', 'domain', 'operational'], description: 'Optional: restrict to one layer.' }, limit: { type: 'number', description: 'Max most-recent notes to consider (default 100, capped 1000).' } }, required: ['project'] } },
      { name: 'reset_todo', description: "STEWARD: unstick a parked/over-retried todo and re-promote it. Use when the CAUSE of repeated rejections was fixed EXTERNALLY (a now-merged dependency, a foreign whole-tree gate error since repaired, a corrected gate command) — a todo at/over the retry budget would otherwise re-park to 'blocked' the instant it's reclaimed. Resets retryCount=0, clears acceptanceStatus + any stale claim + completion stamps, sets status (default 'ready'), and OPTIONALLY reroutes targetProject (fix a cross-project todo created without it). The supported replacement for hand-editing todos.db.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, status: { type: 'string', enum: ['backlog','planned','todo','ready','in_progress','blocked','done','dropped'], description: "Status to set after reset (default 'ready')." }, targetProject: { type: ['string','null'], description: 'Optional: set the implementation repo (worker cwd + gate location). Pass null to clear; omit to leave unchanged.' }, proof: { type: 'object', description: "STEWARD proof the server RE-VALIDATES at act time (never trusted as asserted). One of: {kind:'merged'} (HEAD..master==0), {kind:'tsc-clean'}, {kind:'grep',symbol,present}, {kind:'dep-done'} (all deps done/accepted in store). Required for an autonomous steward act when MERMAID_STEWARD_AUTO is on; a no-proof steward act is rejected + re-routed to human." }, escalationId: { type: 'string', description: 'Open escalation this act resolves — links the audit + is flipped routedTo=human on a failed/absent proof.' }, stewardEpoch: { type: 'number', description: 'Marks this as a steward auto-act (engages the proof gate).' } }, required: ['project','todoId'] } },
      { name: 'override_accept_todo', description: 'STEWARD override-accept: force a todo whose work is verified-done DONE+accepted, BYPASSING the mechanical gate. Use ONLY when the gate FALSE-rejected verified-green work (e.g. a whole-tree tsc tripping on a sibling lane error, or a gate command wrong for the change-set) — confirm the deliverable exists first. Unblocks dependents and rolls up parent epics exactly as a normal acceptance; records the steward as completer for provenance.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, todoId: { type: 'string' }, completedBy: { type: 'string', description: "Completer handle for provenance (default 'steward')." }, proof: { type: 'object', description: "STEWARD DUAL proof, server-re-validated: {kind:'override', artifactPath?|artifactSymbol? (the deliverable provably IN-TREE), foreignErrorFiles:[] (the gate failure provably OUTSIDE this todo's change-set)}. DEFAULT DEFER — without both halves the override is rejected + re-routed to human." }, escalationId: { type: 'string', description: 'Open escalation this act resolves — flipped routedTo=human on a failed/absent proof.' }, stewardEpoch: { type: 'number', description: 'Marks this as a steward auto-act (engages the proof gate + rate limit).' }, changeSetFiles: { type: 'array', items: { type: 'string' }, description: "This todo's change-set files — used to prove the gate error is foreign." } }, required: ['project','todoId'] } },
      { name: 'create_gate', description: "READINESS GATE: attach a HUMAN gate to a work-todo so it can't be claimed until a human clears the gate. Creates a '[GATE]' human todo (assigneeKind:'human', ready) and appends it to the work-todo's dependsOn, parking the work-todo 'blocked'. The coordinator never claims the gate (human) nor the blocked work-todo; completing the gate auto-promotes the work-todo to 'ready' on the same tick — no reset_todo, no new status. Use to hold a design-gated/needs-review todo until a human signs off.", inputSchema: { type: 'object', properties: { project: { type: 'string' }, workTodoId: { type: 'string', description: 'The agent work-todo to gate.' }, title: { type: 'string', description: "Gate title (auto-prefixed '[GATE]' if absent)." }, description: { type: 'string', description: 'What the human must confirm/decide.' }, gateKind: { type: 'string', description: "Optional label folded into the title, e.g. 'spec-review' → '[GATE:spec-review]'." }, parentId: { type: 'string', description: 'Optional human-gate epic to parent the gate under (e.g. the [EPIC] human-gates id).' }, decisionRef: { type: 'string', description: 'Optional decision-record id: approving that record (approve_decision_record) auto-completes this gate — for design/decision gates that clear when the design lands.' } }, required: ['project', 'workTodoId', 'title'] } },
      { name: 'checkpoint_ready', description: 'Context-watchdog: a session reports that its checkpoint is persisted. The server VERIFIES the named artifact was JUST written (recency gate) before recording checkpoint_ready — so a /clear can safely follow. Provide checkpointDocId (preferred — vibe-checkpoint writes the checkpoint into the vibe.vibeinstructions document’s ## Checkpoint section) OR checkpointTodoId (legacy — older flows wrote into the in_progress todo description; the claimability model no longer keeps an interactive in_progress todo, so prefer the doc). Call this at the END of your checkpoint.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, checkpointDocId: { type: 'string', description: 'Document id the checkpoint wrote (preferred — e.g. vibe.vibeinstructions / vibe-vibeinstructions).' }, checkpointTodoId: { type: 'string', description: 'Legacy: todo id the checkpoint updated. Older flows wrote the checkpoint into the in_progress todo description; prefer checkpointDocId.' }, maxWriteAgeMs: { type: 'number', description: 'How recent the write must be to count as a fresh checkpoint (default 120000).' } }, required: ['project', 'session'] } },
      { name: 'supervisor_clear_session', description: 'Context-watchdog HARD GATE: send /clear to a watched session ONLY if it has a recent persisted checkpoint (checkpoint_ready). Refuses otherwise. Consumes the checkpoint marker on success.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' }, serverId: { type: 'string', description: 'Optional peer server id for a remote session.' }, maxAgeMs: { type: 'number', description: 'Max age of the checkpoint marker to still allow clearing (default 600000).' }, supervisorEpoch: { type: 'number', description: 'Supervisor ownership epoch; a superseded supervisor is rejected.' } }, required: ['project', 'session'] } },
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
      { name: 'supervisor_pause', description: 'EMERGENCY OVERRIDE: pause supervisor driving-actions (nudge/clear/watchdog) — globally or for one project. Use when the supervisor is misbehaving. Resume with supervisor_resume.', inputSchema: { type: 'object', properties: { scope: { type: 'string', description: "'global' (default) or a project path." } } } },
      { name: 'supervisor_resume', description: 'Lift a supervisor pause (the scope you paused: "global" or a project path).', inputSchema: { type: 'object', properties: { scope: { type: 'string', description: "'global' (default) or a project path." } } } },
      { name: 'supervisor_pause_status', description: 'List active supervisor pauses.', inputSchema: { type: 'object', properties: {} } },
      { name: 'steward_pause', description: "Pause the STEWARD's auto-routing+acting (design §4 human-reclaim). While paused the router forwards nothing (every new escalation → human) and the steward parks — the human standin's \"I've got it from here.\" Resume with steward_resume.", inputSchema: { type: 'object', properties: {} } },
      { name: 'steward_resume', description: 'Lift the steward pause — auto-routing+acting resume (subject to the steward being live).', inputSchema: { type: 'object', properties: {} } },
      { name: 'steward_pause_status', description: 'Steward liveness + pause snapshot: { paused, live, autoEnabled (env arm), switchedOn (live human on/off) }. Drives the StewardPanel crashed/paused/off state.', inputSchema: { type: 'object', properties: {} } },
      { name: 'steward_set_enabled', description: "Runtime ON/OFF for the steward — the live human off-switch (distinct from the MERMAID_STEWARD_AUTO env arm and the transient steward_pause). PERSISTENT. While OFF the router sends every escalation to the human and the running steward skill idles. The skill checks this each loop.", inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } },
      { name: 'check_graph_drift', description: 'Graph↔code drift check: scans the session\'s blueprint task files and flags MISSING dependencies — where one task\'s code imports another task\'s files but the plan graph has no dependsOn. Deterministic (import-edge analysis, no LLM). The supervisor can run this periodically.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, session: { type: 'string' } }, required: ['project', 'session'] } },
      { name: 'supervisor_audit_list', description: 'List the supervisor\'s durable decision/action audit trail (nudge/escalate/checkpoint/clear/…), most-recent-first. Survives restart; feeds observability + the System Map. Optional project/kind filters.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, kind: { type: 'string' }, limit: { type: 'number', description: 'Max entries (default 100, max 1000).' } } } },
      { name: 'orchestrator_status', description: 'Live orchestrator daemon runtime snapshot: { running, tickMs, lastTickAt, projects:[{project,level}], pool:[{session,type,slot,status,todoId,tmux}], coldStartsInFlight, recentSpawns }. Read-only. Returns running:false cleanly when the daemon is stopped. Thin wrapper over the worker pool + the orchestrator level/health.', inputSchema: { type: 'object', properties: {} } },
      { name: 'system_status', description: "THE one-call steward rollup — call this FIRST to ground a decision instead of a stale checkpoint + N bash probes. COMPOSES the four foundational read-models (orchestrator_status: daemon running/level + pool occupancy + cold-starts · fleet_status: worker occupancy + proc-headroom early-warning · invariant_check: work-graph violation count · instance_topology: canonical :9002 confirmation vs stale shadows) PLUS inline: deploy/version drift (live sidecar pid+version+startedAt vs repo package.json version + git HEAD + uncommitted WIP — the 'did the deploy land or go cosmetic?' read), open-escalation + pending-decision counts, and steward/supervisor pause state. Returns a COMPACT summary with `pointers` to the focused tool for full detail behind any field. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project to roll up (work-graph + deploy/git lives here).' } }, required: ['project'] } },
      { name: 'daemon_status', description: "LIVE leaf-executor activity — the piece fleet_status/orchestrator_status are blind to (a leaf run makes no tmux). Returns the leaves RUNNING RIGHT NOW (leafId, current nodeKind, model, attempt, elapsedMs, and a `stale` flag for rows older than 15m = a likely crashed run) + the headless circuit-breaker state (open/closed) + a `state` field (working | blocked-on-decision | claims-suppressed | claimable | idle). When scoped to a project, `state` is one of: working (leaves in flight), blocked-on-decision (a split parent has unapproved children — see `claimSuppression.blockedSplits`), claims-suppressed (ready leaves held by probes/budget/breaker), claimable (leaves ready to claim), or idle (no work). Use this to answer 'what is the daemon doing this second'; pair with orchestrator_status (level/pool/recentSpawns) and leaf_failures (what broke). Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Filter in-flight leaves to this project.' } } } },
      { name: 'leaf_inspect', description: "Per-leaf HEADLESS run view from the worker-ledger — how you watch/diagnose a leaf-executor run (it leaves NO tmux, so fleet_status/orchestrator_status are blind to it). Returns the node timeline (kind, model, input/output tokens, durationMs, exitCode, parseError [the kill/timeout reason a failed node carries — explains a blocked leaf], verdict, output EXCERPT) + the ATOMIC terminal record (effectiveOutcome incl. 'pending', reviewVerdict, pathTaken floor/waves, reason, pendingReason, gateReasons, attempts, nodesSpent) + budget/cost rollup + resumeDecisions (per-claim resume mode/reason/anomaly, ASC by decidedAt). leafId === the todoId (pass either). Node output is excerpted (~600 chars) by default since node outputs run 10-30k tokens; pass fullOutput=true for complete text. Read-only.", inputSchema: { type: 'object', properties: { leafId: { type: 'string', description: 'Leaf/todo id or prefix is NOT accepted — pass the full id (same value as todoId).' }, todoId: { type: 'string', description: 'Alias for leafId (the leaf-executor sets both to the todo id).' }, fullOutput: { type: 'boolean', description: "Return each node's FULL output text instead of a ~600-char excerpt." } } } },
      { name: 'leaf_failures', description: "Triage list of recent leaf-executor runs that did NOT end cleanly — finalOutcome in {rejected, blocked, pending} — newest-first, each with the terminal reason/pendingReason, path (floor/waves), nodesSpent and cost. The entry point for 'what headless runs broke and why'. Filter by project and/or epicId. Pass includeAll=true to list EVERY recent run regardless of outcome. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Filter to this tracking project.' }, epicId: { type: 'string', description: 'Filter to one epic.' }, limit: { type: 'number', description: 'Max runs (default 50).' }, includeAll: { type: 'boolean', description: 'Include accepted/clean runs too.' } } } },
      { name: 'runtime_config', description: "Read-only effective CONTROL PLANE in one view — what knobs the daemon is ACTUALLY running with, so the steward doesn't have to read config.json by hand + cross-reference N pause tools. Returns `flags` (the resolved values the running process uses, via each owning module's accessor — workerIsolation (MERMAID_WORKER_ISOLATION), poolSizes per type (MERMAID_POOL_<TYPE>), maxColdStarts (MERMAID_MAX_COLD_STARTS), deadGraceMs (MERMAID_DEAD_GRACE), and the effective context-watchdog threshold) + `overrides` (every pause/level: steward pause+liveness, supervisor pauses, this project's orchestrator autonomy level). COMPACT with `pointers` to the tool that changes each field. Read-only.", inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Tracking project whose per-project overrides (watchdog threshold, supervisor pause, orchestrator level) to resolve.' } }, required: ['project'] } },
      { name: 'set_watchdog_threshold', description: 'Set (or clear, with null) a project\'s context-watchdog trigger threshold (%). Overrides the 80% default for supervisor_watchdog_scan on that project. Pass null to revert to the default.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, thresholdPercent: { type: ['number', 'null'], description: 'Percent (1-100) or null to clear.' } }, required: ['project', 'thresholdPercent'] } },
      { name: 'set_context_recycle', description: "Set a project's context-auto-recycle mode — the deterministic server-side driver that keeps a low-context WATCHED session alive by injecting /vibe-checkpoint → /clear → /collab (no LLM supervisor in the loop). 'off' (default) = inert; 'notify' = at the watchdog threshold, inject an advisory nudge and only auto-clear+reload once the session itself saves a fresh checkpoint (assisted); 'force' = server injects the checkpoint too, then clears+reloads (for an unattended autonomous-loop session).", inputSchema: { type: 'object', properties: { project: { type: 'string' }, mode: { type: 'string', enum: ['off', 'notify', 'force'], description: "off | notify | force" } }, required: ['project', 'mode'] } },
      { name: 'supervisor_watchdog_scan', description: 'Context-watchdog control loop: scan a project\'s session statuses and return the per-session actions to take this tick — "checkpoint" (over the context threshold on a safe/idle boundary → nudge the session to run /vibe-checkpoint) or "clear" (a checkpoint is persisted → call supervisor_clear_session). Deterministic; the supervisor calls this each tick.', inputSchema: { type: 'object', properties: { project: { type: 'string' }, thresholdPercent: { type: 'number', description: 'Context % that triggers a clear cycle (default 80).' } }, required: ['project'] } },
      ...MISSION_TOOL_DEFS,
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
            const res = await fetch(`${API_BASE_URL}/api/maintenance/stale-scan?days=${encodeURIComponent(String(days))}`);
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

            const response = await fetch(buildUrl('/api/render-ui', project, session), {
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

            const response = await fetch(
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
              const response = await fetch(buildUrl('/api/claude-session/register', project, session), {
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
              const response = await fetch(`${API_BASE_URL}/api/health`, {
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
            return JSON.stringify(getFleetStatus(project), null, 2);
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
              fetch(buildUrl('/api/diagrams', project, session)).then(r => r.ok ? r.json() as Promise<AnyJson> : ({ diagrams: [] } as AnyJson)),
              fetch(buildUrl('/api/documents', project, session)).then(r => r.ok ? r.json() as Promise<AnyJson> : ({ documents: [] } as AnyJson)),
              handleListDesigns(project, session).catch(() => ({ designs: [] }) as AnyJson),
              handleListSnippets(project, session).catch(() => ({ snippets: [] }) as AnyJson),
            ]);

            const diagramIds: string[] = ((diagrams as AnyJson).diagrams || []).map((d: any) => d.id);
            const documentIds: string[] = ((documents as AnyJson).documents || []).map((d: any) => d.id);
            const designIds: string[] = ((designs as AnyJson).designs || []).map((d: any) => d.id);
            const snippetIds: string[] = ((snippets as AnyJson).snippets || []).map((s: any) => s.id);

            await Promise.all([
              ...diagramIds.map(id => fetch(buildUrl(`/api/diagram/${id}`, project, session), { method: 'DELETE' })),
              ...documentIds.map(id => fetch(buildUrl(`/api/document/${id}`, project, session), { method: 'DELETE' })),
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
            const { prompt, system, model = 'grok-build-0.1' } = args as { prompt: string; system?: string; model?: string };
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

            return JSON.stringify({
              model,
              response: reply,
              usage: data.usage,
            }, null, 2);
          }

          case 'consult_codex': {
            const { prompt, system, model } = args as { prompt: string; system?: string; model?: string };
            const result = await consultCodex({ prompt, system, model });
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
            const { project, session, text, title, kind, link, assigneeSession, assigneeKind, description, status, priority, dueDate, dependsOn, parentId, sessionName, type, files, inbox } = args as {
              project: string;
              session: string;
              text?: string;
              title?: string;
              kind?: TodoKind;
              link?: SessionTodoLink;
              assigneeSession?: string;
              assigneeKind?: 'agent' | 'human';
              description?: string;
              status?: import('../services/todo-store.js').TodoStatus;
              priority?: 0 | 1 | 2 | 3 | 4;
              dueDate?: string;
              dependsOn?: string[];
              parentId?: string | null;
              sessionName?: string | null;
              type?: string | null;
              files?: string[];
              inbox?: boolean;
            };
            if (!project || !session || !(title ?? text)) throw new Error('Missing required: project, session, text');
            // `kind` is the ONLY role signal (stage C, decision e852fb0c). It is never inferred from the
            // title. Absent means a plain work leaf — the caller creating an epic/mission/[LAND] node must
            // say so. An out-of-domain value is a caller bug and fails here, not silently downstream.
            const KINDS: readonly TodoKind[] = ['mission', 'epic', 'land', 'leaf'];
            if (kind !== undefined && !KINDS.includes(kind)) {
              throw new Error(`add_session_todo: invalid kind ${JSON.stringify(kind)} (expected one of ${KINDS.join(', ')})`);
            }
            const result = await addSessionTodo(project, session, title ?? text!, link, {
              kind: kind ?? 'leaf',
              assigneeSession, assigneeKind, description, status, priority, dueDate,
              dependsOn, parentId, sessionName, type, files, inbox,
            });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined });
            return JSON.stringify({ ...deriveTodoViews(project, [result])[0] }, null, 2);
          }

          case 'update_session_todo': {
            const { project, session, id, text, title, completed, order, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, sessionName, targetProject } = args as {
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
            };
            if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
            const result = await updateSessionTodo(project, session, id, { text, title, completed, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, sessionName, targetProject });
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

          case 'spawn_planner': {
            const { project, session = 'planner', remoteControl = true } = args as { project: string; session?: string; remoteControl?: boolean };
            if (!project) throw new Error('Missing required: project');
            // Register + watch + supervise so the planner is visible to the
            // supervisor reconcile and shows in the Bridge tree.
            try { await handleRegisterProject({ path: project }); } catch { /* may already be registered */ }
            supervisorStore.addWatchedProject(project);
            supervisorStore.addSupervised(project, session, 'spawn');
            // PRE-CREATE the session so the launched `/collab <session>` RESUMES an
            // existing session instead of hitting the "create it?" prompt that would
            // strand the launch (the /planner skill gets sent before the prompt is
            // answered). Belt-and-suspenders vs the collab-skill auto-create fix,
            // which only reaches launched sessions after a plugin version bump.
            // Idempotent: a no-op if the doc already exists.
            try {
              const existing = await listDocuments(project, session);
              if (!/vibeinstructions/i.test(existing)) {
                await createDocument(project, session, 'vibe.vibeinstructions',
                  `# Vibe: ${session}\n\n## Goal\n[Planner — define the roadmap for this project]\n\n## Context\n[No context recorded]\n\n## Pair Mode\nDisabled\n\n## Agent Mode\nEnabled`);
              }
            } catch { /* best-effort: launch still proceeds */ }
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session });
            const launch = await launchAndBind({
              project,
              session,
              invokeSkill: '/planner',
              allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid',
              remoteControl,
            });
            return JSON.stringify({ session, remoteControl, launch }, null, 2);
          }
          case 'supervisor_list_supervised': {
            return JSON.stringify(supervisorStore.listSupervised(), null, 2);
          }
          case 'supervisor_nudge': {
            const { project, session, serverId, text, supervisorEpoch } = args as { project: string; session: string; serverId?: string; text: string; supervisorEpoch?: number };
            if (!project || !session || !text) throw new Error('Missing required: project, session, text');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ sent: false, skipped: 'paused' }, null, 2);
            let result: any;
            let sent: boolean;
            if (serverId && supervisorStore.getPeer(serverId)) {
              result = await peerFetch(serverId, '/api/ide/tmux-send-keys', { method: 'POST', body: { project, session, text } });
              sent = !!(result?.tmux ?? result?.success);
            } else {
              result = await sendTmuxKeys(project, session, text);
              sent = !!result?.sent;
            }
            // Surface the nudge in the UI: a toast lets the user SEE that the
            // supervisor actually pushed a session to continue (and whether it
            // landed in a live tmux pane). Broadcast on the supervisor's own
            // server — that's where the user is watching.
            getWebSocketHandler()?.broadcast({ type: 'supervisor_nudge', project, session, serverId: serverId ?? '', text, sent });
            recordSupervisorDecision('nudge', project, session, JSON.stringify({ text, sent }), serverId);
            return JSON.stringify(result, null, 2);
          }
          case 'supervisor_reconcile': {
            { const fenced = supervisorFence((args as { supervisorEpoch?: number }).supervisorEpoch); if (fenced) return fenced; }
            const out: Array<{ project: string; session: string; status: string | null; updatedAt: number | null; openTodos: number; supervised: boolean; serverId: string }> = [];
            for (const wp of supervisorStore.listWatchedProjects()) {
              // Unified read model owns the status/liveness join; the supervisor
              // overlay (supervised + open-todo count) stays a supervisor concern.
              for (const rt of listSessionRuntimes(wp.project)) {
                const supervised = supervisorStore.isSupervised(wp.project, rt.session);
                const openTodos = supervised ? listTodos(wp.project, { session: rt.session, includeCompleted: false }).length : 0;
                out.push({ project: wp.project, session: rt.session, status: rt.status, updatedAt: rt.updatedAt, openTodos, supervised, serverId: '' });
              }
            }
            // Remote supervised sessions: fetch each peer's session-status once per (serverId, project).
            const remotePairs = new Map<string, { serverId: string; project: string }>();
            for (const sup of supervisorStore.listSupervised()) {
              if (sup.serverId && supervisorStore.getPeer(sup.serverId)) remotePairs.set(sup.serverId + '|' + sup.project, { serverId: sup.serverId, project: sup.project });
            }
            const supervisedRemote = new Set(supervisorStore.listSupervised().filter(s => s.serverId).map(s => s.serverId + '|' + s.project + '|' + s.session));
            for (const { serverId: sid, project: proj } of remotePairs.values()) {
              try {
                const resp = await peerFetch(sid, '/api/session-status?project=' + encodeURIComponent(proj), { method: 'GET' });
                for (const s of (resp.statuses ?? [])) {
                  if (!supervisedRemote.has(sid + '|' + proj + '|' + s.session)) continue;
                  // openTodos:0 for remote — todos not locally queryable.
                  out.push({ project: proj, session: s.session, status: s.status, updatedAt: s.updatedAt, openTodos: 0, supervised: true, serverId: sid });
                }
              } catch {
                out.push({ project: proj, session: '(peer unreachable)', status: 'unreachable', updatedAt: null, openTodos: 0, supervised: true, serverId: sid });
              }
            }
            return JSON.stringify(out, null, 2);
          }
          case 'read_last_assistant_turn': {
            const { claudeSessionId, serverId } = args as { claudeSessionId: string; serverId?: string };
            if (!claudeSessionId) throw new Error('Missing required: claudeSessionId');
            if (serverId && supervisorStore.getPeer(serverId)) {
              return JSON.stringify(await peerFetch(serverId, '/api/transcript/last-turn?claudeSessionId=' + encodeURIComponent(claudeSessionId), { method: 'GET' }), null, 2);
            }
            return JSON.stringify(await lastAssistantTurn(claudeSessionId), null, 2);
          }
          case 'escalation_list': {
            return JSON.stringify(supervisorStore.listOpenEscalations(), null, 2);
          }
          case 'escalation_history': {
            const { getEscalationHistory } = await import('../services/escalation-history.js');
            const f = args as {
              epicId?: string; project?: string; todoId?: string; session?: string;
              status?: string; kind?: string; routedTo?: string;
              since?: number; until?: number; limit?: number; summary?: boolean;
            };
            return JSON.stringify(getEscalationHistory(f), null, 2);
          }
          case 'escalation_brief': {
            const { project, escalationId, refresh } = args as { project: string; escalationId: string; refresh?: boolean };
            if (!project || !escalationId) throw new Error('Missing required: project, escalationId');
            const brief = await briefEscalation(project, escalationId, { refresh });
            return JSON.stringify(brief, null, 2);
          }
          case 'escalation_resolve': {
            const { id, status, supervisorEpoch } = args as { id: string; status: string; supervisorEpoch?: number };
            if (!id || !status) throw new Error('Missing required: id, status');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            supervisorStore.resolveEscalation(id, status);
            return JSON.stringify({ success: true, id, status }, null, 2);
          }
          case 'land_epic': {
            const { project, escalationId, allowDirty, actor: actorKind, session } = args as { project: string; escalationId: string; allowDirty?: boolean; actor?: string; session?: string };
            if (!project || !escalationId) throw new Error('Missing required: project, escalationId');

            // Build the actor (default human, so every existing caller is byte-for-byte unchanged)
            let actor: LandActor = { kind: 'human' };
            if (actorKind === 'conductor') {
              if (!session) throw new Error("Missing required: session (required when actor='conductor')");
              actor = { kind: 'conductor', session };
            } else if (actorKind === 'daemon') {
              actor = { kind: 'daemon', level: 'auto' };
            }

            // Ownership gate — conductor only.
            if (actor.kind === 'conductor') {
              const esc = supervisorStore.getEscalation(escalationId);
              if (!esc || esc.kind !== 'epic-ready-to-land' || !esc.todoId) {
                return JSON.stringify({ ok: false, landed: false, reason: 'not-a-land-escalation' }, null, 2);
              }
              const child = getTodo(project, esc.todoId);
              if (!child) return JSON.stringify({ ok: false, landed: false, reason: 'todo-not-found' }, null, 2);
              const epicId = resolveEpicId(child, project);
              const own = checkOwnership(project, epicId, actor);
              if (!own.ok) {
                recordSupervisorDecision('reconcile', project, session!, JSON.stringify({ escalationId, epicId, land: 'refused', reason: own.blocker?.code, ownership: own.ownership }));
                return JSON.stringify({
                  ok: false, landed: false, epicId,
                  reason: own.blocker?.code ?? 'unauthorized',
                  ownership: own.ownership,
                  message: own.blocker?.message,
                  instruction: 'ESCALATE TO THE HUMAN. A conductor may only land epics under its own ACTIVE mission. Never land another mission\'s epic, and never land a bucket root.',
                }, null, 2);
              }
            }

            const result = await landEpic(project, escalationId, { allowDirty });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });

            // Attach the actor and trailer to the result
            const trailer = landedByTrailer(actor);
            const payload = result.reason === 'dirty-tree'
              ? { ...result, instruction: 'Main checkout is dirty. File a todo for the daemon, or EnterWorktree to hand-code, or commit / discard the changes — then re-land. To override for this call, pass allowDirty:true.', landedBy: trailer, actor: actor.kind }
              : { ...result, landedBy: trailer, actor: actor.kind };

            // Record audit on successful land
            if (result.landed === true && result.epicId) {
              recordSupervisorDecision('reconcile', project, actor.kind === 'conductor' ? session! : actor.kind, JSON.stringify({ escalationId, epicId: result.epicId, land: 'landed', trailer }));
            }

            return JSON.stringify(payload, null, 2);
          }
          case 'deploy_self': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const result = requestSelfDeploy(project);
            return JSON.stringify(result, null, 2);
          }
          case 'escalation_create': {
            const { project, session, kind, questionText, todoId, options, recommended, ui, operatorGated, supervisorEpoch } = args as { project: string; session: string; kind: string; questionText: string; todoId?: string; options?: Array<{ id: string; label: string; detail?: string }>; recommended?: string; ui?: unknown; operatorGated?: boolean; supervisorEpoch?: number };
            if (!project || !session || !kind || !questionText) throw new Error('Missing required: project, session, kind, questionText');
            // Fence only bites a supervisor-context caller (one that carries an
            // epoch). Ordinary workers escalate without an epoch — never fenced.
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            // Use the store's authoritative new-vs-dedup signal (no separate
            // pre-check → no TOCTOU): broadcast/record only for new escalations.
            // `ui` (BR-4) is server-validated inside createEscalation against the
            // closed catalog; an invalid spec is dropped, never throws.
            const { escalation: esc, isNew } = supervisorStore.createEscalation({ project, session, kind, questionText, todoId, options, recommended, ui, operatorGated });
            if (isNew) {
              getWebSocketHandler()?.broadcast({ type: 'escalation_created', project, session, kind, id: esc.id, routedTo: esc.routedTo, escalation: esc });
              recordSupervisorDecision('escalate', project, session, JSON.stringify({ kind, escalationId: esc.id }));
              // P3 (readiness ergonomics): a needs-design / operator-gated escalation
              // linked to a work-todo gets a durable, self-clearing human [GATE] (P1
              // createGate) instead of the steward's manual re-park to 'planned'. It
              // surfaces in the human inbox ("waiting on you: provision env / land
              // design") and auto-promotes the work-todo when the human clears it.
              // Best-effort: never let a gate failure break escalation creation; skip
              // when the work-todo is itself human, missing, or already gated (idempotent).
              if (todoId && supervisorStore.shouldAutoGate(kind, Boolean(operatorGated))) {
                try {
                  const work = getTodo(project, todoId);
                  const alreadyGated = work?.dependsOn?.some((d) => getTodo(project, d)?.title?.startsWith('[GATE'));
                  if (work && work.assigneeKind !== 'human' && !alreadyGated) {
                    await createGate(project, { workTodoId: todoId, title: questionText, gateKind: kind });
                  }
                } catch (e) {
                  console.warn('[escalation_create] auto-gate failed:', e instanceof Error ? e.message : String(e));
                }
              }
            }
            return JSON.stringify(esc, null, 2);
          }
          case 'await_human_decision': {
            const { escalationId, timeoutMs } = args as { escalationId: string; timeoutMs?: number };
            if (!escalationId) throw new Error('Missing required: escalationId');
            const result = await awaitHumanDecision(escalationId, { timeoutMs });
            return JSON.stringify(result, null, 2);
          }
          case 'subscribe': {
            const { project, session, scope, targetId } = args as { project?: string; session?: string; scope?: string; targetId?: string };
            if (!project || !session || !scope) throw new Error('Missing required: project, session, scope');
            if (!['todo', 'epic', 'mission', 'project'].includes(scope)) throw new Error(`Invalid scope "${scope}" (todo|epic|mission|project)`);
            const subs = await import('../services/session-subscriptions');
            const sub = subs.addSubscription(project, session, scope as any, targetId);
            return JSON.stringify({ ok: true, subscription: sub }, null, 2);
          }
          case 'unsubscribe': {
            const { project, session, scope, targetId, all } = args as { project?: string; session?: string; scope?: string; targetId?: string; all?: boolean };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            if (all) return JSON.stringify({ ok: true, removed: subs.dropSubscriptionsForSession(project, session) }, null, 2);
            if (!scope) throw new Error('Missing required: scope (or all:true)');
            return JSON.stringify({ ok: true, removed: subs.removeSubscription(project, session, scope as any, targetId) }, null, 2);
          }
          case 'update_zen_summary': {
            const { project, session, structured } = args as { project?: string; session?: string; structured?: unknown };
            if (!project || !session || !structured) throw new Error('Missing required: project, session, structured');
            const ss = await import('../services/session-summary-loop.ts');
            const wsh = getWebSocketHandler();
            const r = ss.pushSessionSummary(project, session, structured, (m) => wsh?.broadcast(m as never));
            if (!r.ok) throw new Error(`update_zen_summary rejected: ${r.reason}`);
            return JSON.stringify({ ok: true, pushed: { project, session } }, null, 2);
          }
          case 'list_subscriptions': {
            const { project, session } = args as { project?: string; session?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            const list = subs.listSubscriptionsForSession(project, session);
            return JSON.stringify({ session, count: list.length, subscriptions: list }, null, 2);
          }
          case 'inbox': {
            const { project, session } = args as { project?: string; session?: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const subs = await import('../services/session-subscriptions');
            const items = subs.drainInbox(project, session);
            // Wall-clock stamps (matches get_datetime's style): servedAt = when this drain
            // ran; per-item tsLocal = human-readable form of each event's epoch `ts`. So a
            // subscriber reading the response knows WHEN it pulled and WHEN each update fired
            // without converting epochs by hand.
            const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' });
            const now = Date.now();
            return JSON.stringify({
              count: items.length,
              servedAt: { epochMs: now, iso: new Date(now).toISOString(), local: fmt(now) },
              items: items.map((it) => ({ ...it, tsLocal: fmt(it.ts) })),
            }, null, 2);
          }
          case 'supervisor_next_decision': {
            // The on-demand supervisor LLM polls the oldest pending ambiguous-stop
            // request. Read-only; null when the queue is empty (nothing to judge).
            const { project } = args as { project?: string };
            return JSON.stringify(supervisorStore.getNextPendingDecision(project), null, 2);
          }
          case 'supervisor_resolve_decision': {
            const { id, verdict, reason, supervisorEpoch } = args as { id: string; verdict: string; reason?: string; supervisorEpoch?: number };
            if (!id || !verdict) throw new Error('Missing required: id, verdict');
            if (!supervisorStore.DECISION_VERDICTS.includes(verdict as supervisorStore.DecisionVerdict)) {
              throw new Error(`Invalid verdict "${verdict}" (expected one of ${supervisorStore.DECISION_VERDICTS.join(', ')})`);
            }
            // EPOCH-GATED (2dd13c65): resolveDecision calls assertSupervisorOwner and
            // throws SupersededError for a stale supervisor — catch it and return the
            // structured superseded payload, performing NO write (mirrors supervisorFence).
            const owner = supervisorStore.getSupervisorIdentity();
            try {
              const resolved = supervisorStore.resolveDecision({
                id,
                verdict: verdict as supervisorStore.DecisionVerdict,
                reason,
                resolvedBy: owner ? `${owner.session}@${owner.epoch}` : null,
                epoch: supervisorEpoch,
              });
              if (!resolved) return JSON.stringify({ success: false, reason: 'not-pending', id }, null, 2);
              recordSupervisorDecision('decide', resolved.project, resolved.workerSession, JSON.stringify({ decisionId: id, verdict, reason: reason ?? null }));
              return JSON.stringify({ success: true, decision: resolved }, null, 2);
            } catch (e) {
              if (e instanceof supervisorStore.SupersededError) {
                return JSON.stringify({ superseded: true, currentEpoch: e.currentEpoch, currentSession: e.currentSession, message: e.message }, null, 2);
              }
              throw e;
            }
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
            const response = await fetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
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
            const response = await fetch(buildUrl(`/api/metadata/item/${id}`, project, session), {
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

          case 'get_todo': {
            const { project, todoId } = args as { project: string; todoId: string };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            const todo = getTodo(project, todoId);
            if (!todo) throw new Error(`todo not found: ${todoId}`);
            return JSON.stringify(deriveTodoViews(project, [todo])[0], null, 2);
          }
          case 'invariant_check': {
            const { project } = args as { project: string };
            if (!project) throw new Error('Missing required: project');
            const violations = checkInvariants(project);
            return JSON.stringify({ violations, count: violations.length }, null, 2);
          }
          case 'gate_status': {
            const { project, limit } = args as { project: string; limit?: number };
            if (!project) throw new Error('Missing required: project');
            const status = gateStatus(project, typeof limit === 'number' ? limit : 20);
            return JSON.stringify(status, null, 2);
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
          case 'leaf_inspect': {
            const { leafId, todoId, fullOutput } = args as { leafId?: string; todoId?: string; fullOutput?: boolean };
            const id = leafId ?? todoId;
            if (!id) throw new Error('Missing required: leafId (or todoId)');
            const run = getLeafRun(id);
            if (!run) return JSON.stringify({ ran: false, leafId: id }, null, 2);
            // Excerpt node output by default (node outputs run 10-30k tokens → context
            // bloat); fullOutput=true returns the complete text for deliberate drill-in.
            const EXCERPT = 600;
            const nodes = run.nodes.map((n) => ({
              ...n,
              outputText: n.outputText == null
                ? null
                : fullOutput || n.outputText.length <= EXCERPT
                  ? n.outputText
                  : `${n.outputText.slice(0, EXCERPT)}\n…[+${n.outputText.length - EXCERPT} chars — pass fullOutput=true]`,
            }));
            return JSON.stringify({ ran: true, ...run, nodes }, null, 2);
          }
          case 'leaf_failures': {
            const { project, epicId, limit, includeAll } = args as { project?: string; epicId?: string; limit?: number; includeAll?: boolean };
            const all = listLeafRuns({ project, epicId, limit: limit ?? 50 });
            const runs = includeAll ? all : all.filter((r) => r.finalOutcome != null && r.finalOutcome !== 'accepted');
            return JSON.stringify({ count: runs.length, runs }, null, 2);
          }
          case 'epic_branch_status': {
            const { project, baseRef } = args as { project: string; baseRef?: string };
            if (!project) throw new Error('Missing required: project');
            const report = getEpicBranchStatus(project, baseRef || 'master');
            return JSON.stringify(report, null, 2);
          }
          case 'epic_land_readiness': {
            const { project, epicId: epicIdArg } = args as { project: string; epicId: string };
            if (!project) throw new Error('Missing required: project');
            if (!epicIdArg) throw new Error('Missing required: epicId');
            const { getEpicLandReadiness } = await import('../services/epic-land-readiness.js');
            // Resolve short-id prefix via getTodo (the standard short-id convention).
            const resolved = getTodo(project, epicIdArg);
            const epicId = resolved?.id ?? epicIdArg;
            const report = getEpicLandReadiness(project, epicId);
            return JSON.stringify(report, null, 2);
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
          case 'complete_todo': {
            const { project, todoId, acceptance, claimToken } = args as { project: string; todoId: string; acceptance: 'accepted' | 'rejected'; claimToken?: string };
            if (!project || !todoId || !acceptance) throw new Error('Missing required: project, todoId, acceptance');
            const result = await handleWorkerComplete(makeCoordinatorDeps(), project, todoId, acceptance, claimToken);
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(result, null, 2);
          }
          case 'reset_todo': {
            const { project, todoId, status, targetProject, proof, escalationId, stewardEpoch } = args as { project: string; todoId: string; status?: import('../services/todo-store.js').TodoStatus; targetProject?: string | null; proof?: StewardProof; escalationId?: string; stewardEpoch?: number };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            // Steward proof gate: enforced only for an autonomous steward act
            // (proof/escalationId/epoch present AND MERMAID_STEWARD_AUTO on). A plain
            // operator call (no steward context) keeps the manual undo behaviour.
            const asSteward = supervisorStore.stewardAutoEnabled() && (proof !== undefined || escalationId !== undefined || stewardEpoch !== undefined);
            if (asSteward) {
              const gate = stewardProofGate({ verb: 'reset_todo', project, todoId, proof, escalationId });
              if (!gate.ok) return JSON.stringify({ rejected: true, reason: gate.reason, routedTo: 'human' }, null, 2);
            }
            const result = await resetTodo(project, todoId, status ?? 'ready', targetProject);
            if (asSteward && escalationId) supervisorStore.resolveEscalation(escalationId, 'resolved');
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(deriveTodoViews(project, [result])[0], null, 2);
          }
          case 'create_gate': {
            const { project, workTodoId, title, description, gateKind, parentId, decisionRef } = args as { project: string; workTodoId: string; title: string; description?: string | null; gateKind?: string; parentId?: string | null; decisionRef?: string | null };
            if (!project || !workTodoId || !title) throw new Error('Missing required: project, workTodoId, title');
            const result = await createGate(project, { workTodoId, title, description, gateKind, parentId, decisionRef });
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify(result, null, 2);
          }
          case 'override_accept_todo': {
            const { project, todoId, completedBy, proof, escalationId, stewardEpoch, changeSetFiles } = args as { project: string; todoId: string; completedBy?: string; proof?: StewardProof; escalationId?: string; stewardEpoch?: number; changeSetFiles?: string[] };
            if (!project || !todoId) throw new Error('Missing required: project, todoId');
            const asSteward = supervisorStore.stewardAutoEnabled() && (proof !== undefined || escalationId !== undefined || stewardEpoch !== undefined);
            if (asSteward) {
              const gate = stewardProofGate({ verb: 'override_accept_todo', project, todoId, proof, escalationId, changeSetFiles });
              if (!gate.ok) return JSON.stringify({ rejected: true, reason: gate.reason, routedTo: 'human' }, null, 2);
            }
            const result = await overrideAcceptTodo(project, todoId, completedBy ?? 'steward');
            if (asSteward && escalationId) supervisorStore.resolveEscalation(escalationId, 'resolved');
            getWebSocketHandler()?.broadcast({ type: 'session_todos_updated', project, session: '' });
            return JSON.stringify({ ...result, completed: deriveTodoViews(project, [result.completed])[0] }, null, 2);
          }
          case 'checkpoint_ready': {
            const { project, session, checkpointTodoId, checkpointDocId, maxWriteAgeMs } = args as { project: string; session: string; checkpointTodoId?: string; checkpointDocId?: string; maxWriteAgeMs?: number };
            if (!project || !session) throw new Error('Missing required: project, session');
            if (!checkpointTodoId && !checkpointDocId) throw new Error('Provide checkpointTodoId or checkpointDocId');
            const maxAge = maxWriteAgeMs ?? 120_000;
            // HARD GATE: verify the artifact was ACTUALLY just written — a
            // self-report alone is not trusted (clear-before-persist = data loss).
            let writtenAtMs: number | undefined;
            let artifact: string;
            if (checkpointTodoId) {
              artifact = `todo:${checkpointTodoId}`;
              const todo = getTodo(project, checkpointTodoId);
              if (!todo) return JSON.stringify({ persisted: false, reason: 'checkpoint-todo-not-found', checkpointTodoId }, null, 2);
              writtenAtMs = new Date(todo.updatedAt).getTime();
            } else {
              artifact = `doc:${checkpointDocId}`;
              let lastModified: unknown;
              try {
                lastModified = JSON.parse(await getDocument(project, session, checkpointDocId!))?.lastModified;
              } catch {
                return JSON.stringify({ persisted: false, reason: 'checkpoint-doc-not-found', checkpointDocId }, null, 2);
              }
              if (typeof lastModified !== 'number') {
                return JSON.stringify({ persisted: false, reason: 'no-lastModified', checkpointDocId }, null, 2);
              }
              writtenAtMs = lastModified;
            }
            if (writtenAtMs === undefined || Number.isNaN(writtenAtMs)) {
              return JSON.stringify({ persisted: false, reason: 'no-write-timestamp', artifact }, null, 2);
            }
            const ageMs = Date.now() - writtenAtMs;
            if (ageMs > maxAge) {
              return JSON.stringify({ persisted: false, reason: 'checkpoint-stale', ageMs, maxWriteAgeMs: maxAge, artifact }, null, 2);
            }
            recordCheckpointReady(project, session);
            getWebSocketHandler()?.broadcast({ type: 'claude_session_checkpoint_ready', project, session, persistedAt: Date.now() });
            recordSupervisorDecision('checkpoint', project, session, JSON.stringify({ artifact, ageMs }));
            return JSON.stringify({ persisted: true, artifact, ageMs }, null, 2);
          }
          case 'supervisor_clear_session': {
            const { project, session, serverId, maxAgeMs, supervisorEpoch } = args as { project: string; session: string; serverId?: string; maxAgeMs?: number; supervisorEpoch?: number };
            if (!project || !session) throw new Error('Missing required: project, session');
            { const fenced = supervisorFence(supervisorEpoch); if (fenced) return fenced; }
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ cleared: false, reason: 'paused' }, null, 2);
            // Gate: only clear if a recent persisted checkpoint exists. For a peer
            // session the marker lives on its home server, so check there.
            let ready: boolean;
            const isPeer = !!(serverId && supervisorStore.getPeer(serverId));
            if (isPeer) {
              const maxAge = maxAgeMs ?? 600_000;
              try {
                const peer = await peerFetch(serverId!, `/api/session-status?project=${encodeURIComponent(project)}`, { method: 'GET' });
                const row = (peer?.statuses ?? []).find((s: any) => s.session === session);
                ready = !!(row?.checkpointReadyAt && Date.now() - row.checkpointReadyAt <= maxAge);
              } catch {
                return JSON.stringify({ cleared: false, reason: 'peer-status-unreachable' }, null, 2);
              }
            } else {
              ready = isCheckpointReady(project, session, maxAgeMs);
            }
            if (!ready) {
              return JSON.stringify({ cleared: false, reason: 'checkpoint-not-ready' }, null, 2);
            }
            let result: any;
            let sent: boolean;
            if (isPeer) {
              result = await peerFetch(serverId!, '/api/ide/tmux-send-keys', { method: 'POST', body: { project, session, text: '/clear' } });
              sent = !!(result?.tmux ?? result?.success);
            } else {
              result = await sendTmuxKeys(project, session, '/clear');
              sent = !!result?.sent;
            }
            if (sent && !isPeer) { clearCheckpointReady(project, session); resetWatchdogDebounce(project, session); }
            getWebSocketHandler()?.broadcast({ type: 'supervisor_session_cleared', project, session });
            recordSupervisorDecision('clear', project, session, JSON.stringify({ sent, isPeer }), serverId);
            return JSON.stringify({ cleared: sent, reason: sent ? undefined : (result?.reason ?? 'send-failed') }, null, 2);
          }
          case 'submit_reconcile_result': {
            const { reconcileId, mergedGraph, newConstraints } = args as { reconcileId: string; mergedGraph: unknown[]; newConstraints?: unknown[] };
            if (!reconcileId || !Array.isArray(mergedGraph)) throw new Error('Missing required: reconcileId, mergedGraph');
            const accepted = resolveReconcile(reconcileId, { mergedGraph: mergedGraph as any, newConstraints: newConstraints as any });
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
          case 'supervisor_pause': {
            const { scope } = args as { scope?: string };
            const s = scope || supervisorStore.GLOBAL_PAUSE_SCOPE;
            supervisorStore.setSupervisorPause(s, true);
            recordSupervisorDecision('override', s, '', JSON.stringify({ action: 'pause' }));
            return JSON.stringify({ paused: true, scope: s }, null, 2);
          }
          case 'supervisor_resume': {
            const { scope } = args as { scope?: string };
            const s = scope || supervisorStore.GLOBAL_PAUSE_SCOPE;
            supervisorStore.setSupervisorPause(s, false);
            recordSupervisorDecision('override', s, '', JSON.stringify({ action: 'resume' }));
            return JSON.stringify({ paused: false, scope: s }, null, 2);
          }
          case 'supervisor_pause_status': {
            return JSON.stringify({ pauses: supervisorStore.listSupervisorPauses() }, null, 2);
          }
          case 'steward_pause': {
            supervisorStore.setStewardPause(true);
            recordSupervisorDecision('override', '', 'steward', JSON.stringify({ action: 'steward_pause' }));
            return JSON.stringify({ paused: true, scope: 'steward' }, null, 2);
          }
          case 'steward_resume': {
            supervisorStore.setStewardPause(false);
            recordSupervisorDecision('override', '', 'steward', JSON.stringify({ action: 'steward_resume' }));
            return JSON.stringify({ paused: false, scope: 'steward' }, null, 2);
          }
          case 'steward_pause_status': {
            return JSON.stringify({
              paused: supervisorStore.isStewardPaused(),
              live: supervisorStore.isStewardLive(),
              autoEnabled: supervisorStore.stewardAutoEnabled(),
              switchedOn: supervisorStore.isStewardEnabled(),
              // back-compat: `enabled` historically meant the env arm.
              enabled: supervisorStore.stewardAutoEnabled(),
            }, null, 2);
          }
          case 'steward_set_enabled': {
            const { enabled } = args as { enabled: boolean };
            if (typeof enabled !== 'boolean') throw new Error('Missing required: enabled (boolean)');
            supervisorStore.setStewardEnabled(enabled);
            recordSupervisorDecision('override', '', 'steward', JSON.stringify({ action: 'steward_set_enabled', enabled }));
            return JSON.stringify({ switchedOn: enabled }, null, 2);
          }
          case 'check_graph_drift': {
            const { project, session } = args as { project: string; session: string };
            if (!project || !session) throw new Error('Missing required: project, session');
            const tasks = await getTaskGraphTasks(project, session);
            const nodes: DriftNode[] = tasks.map((t) => ({ id: t.id, dependsOn: t['depends-on'] ?? [], files: t.files ?? [], title: t.id }));
            const findings = checkGraphDrift(project, nodes);
            return JSON.stringify({ findings, tasksScanned: nodes.length }, null, 2);
          }
          case 'supervisor_audit_list': {
            const { project, kind, limit } = args as { project?: string; kind?: string; limit?: number };
            const entries = supervisorStore.listSupervisorAudit({ project, kind, limit });
            return JSON.stringify({ entries }, null, 2);
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
              tmux: s.tmux ?? null,
            }));

            // recentSpawns: the durable spawn audit trail, most-recent-first.
            let recentSpawns: unknown[] = [];
            try {
              recentSpawns = supervisorStore.listSupervisorAudit({ kind: 'spawn', limit: 10 });
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
          case 'supervisor_watchdog_scan': {
            const { project, thresholdPercent, checkpointCooldownMs } = args as { project: string; thresholdPercent?: number; checkpointCooldownMs?: number };
            if (!project) throw new Error('Missing required: project');
            if (supervisorStore.isSupervisorPaused(project)) return JSON.stringify({ actions: [], suppressed: 0, paused: true }, null, 2);
            // Precedence: explicit arg → per-project config → built-in default.
            const effectiveThreshold = thresholdPercent ?? supervisorStore.getWatchdogThreshold(project) ?? DEFAULT_WATCHDOG_CONFIG.thresholdPercent;
            const cfg = { ...DEFAULT_WATCHDOG_CONFIG, thresholdPercent: effectiveThreshold };
            const now = Date.now();
            const cooldown = checkpointCooldownMs ?? 10 * 60 * 1000;
            // The supervisor's OWN session (if it lives in this project) is tagged
            // self=true so the loop self-checkpoints/clears instead of trying to
            // drive itself via supervisor_clear_session (which targets a PEER).
            const identity = supervisorStore.getSupervisorIdentity();
            const selfSession = identity && identity.project === project ? identity.session : undefined;
            // Feed the watchdog selector from the unified read model (a structural
            // superset of SessionStatusRow) rather than stitching getStatuses here.
            const all = selectWatchdogActions(listSessionRuntimes(project, now), now, cfg, selfSession);
            // Durable debounce on the repeatable 'checkpoint' nudge only. 'clear' is
            // self-limiting: its marker is consumed on a successful clear, and a
            // failed clear SHOULD retry — so it passes through every tick.
            const actions = all.filter((a) =>
              a.action !== 'checkpoint' || tryEmitWatchdogAction(project, a.session, 'checkpoint', cooldown, now),
            );
            // Fail-open-to-human: if the steward crashed (stale heartbeat), surface
            // the single "steward dead, N queued" summary escalation (role-agnostic —
            // the steward session is also checkpoint/clear-managed by the scan above).
            const stewardFailOpen = supervisorStore.stewardFailOpenScan(now);
            if (stewardFailOpen.stale && stewardFailOpen.escalationId) {
              getWebSocketHandler()?.broadcast({ type: 'escalation_created', project, session: supervisorStore.STEWARD_FAILOPEN_SESSION, kind: 'operator-gated', id: stewardFailOpen.escalationId, routedTo: 'human', escalation: supervisorStore.listOpenEscalations().find((e) => e.id === stewardFailOpen.escalationId) });
            }
            return JSON.stringify({ actions, suppressed: all.length - actions.length, thresholdPercent: effectiveThreshold, stewardFailOpen }, null, 2);
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
