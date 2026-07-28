// Session/project/todos/artifacts/UI/consult MCP tool surface — extracted verbatim from setup.ts.
//
// Owns the SESSION tool group: session registry/management, project registry, UI rendering,
// task graph, lessons, friction, session todos, artifact archival, design/snippet/document
// handling, and Grok/OpenAI consults. Assembled from exact byte ranges of setup.ts —
// behavior is identical, a pure move.
import {
  getWebSocketHandler,
} from '../services/ws-handler-manager.js';
import {
  getSessionState,
  updateSessionState,
  archiveSession,
} from './tools/collab-state.js';
import {
  handleListProjects,
  handleRegisterProject,
  handleUnregisterProject,
} from './tools/projects.js';
import {
  updateTaskStatus,
  updateTasksStatus,
  getTaskGraph,
} from './workflow/task-status.js';
import {
  syncTasksFromTaskGraph,
  getTaskGraphTasks,
} from './workflow/task-sync.js';
import {
  addLesson,
  listLessons,
} from './tools/lessons.js';
import {
  recordFrictionTool,
  listFrictionTool,
  reportDogfoodTool,
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
import {
  handleCreateDesign,
  handleGetDesign,
  handleListDesigns,
  handleDeleteDesign,
} from './tools/design.js';
import {
  listDocuments,
  getDocument,
  createDocument,
} from './document-tools.js';
import {
  listDiagrams,
  getDiagram,
  createDiagram,
} from './diagram-tools.js';
import {
  listSpreadsheets,
} from './spreadsheet-tools.js';
import {
  consultCodex,
} from '../services/consult-openai.js';
import {
  recordSpend,
} from '../services/spend-ledger.js';
import {
  getSecret,
} from '../services/config-service.js';
import {
  API_BASE_URL,
  buildUrl,
  asJson,
  type AnyJson,
  apiFetch,
} from './tools/http-util.js';
import {
  deriveTodoViews,
} from '../services/todo-store.js';
import type { TodoKind } from '../services/todo-kind.js';

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

// Archive by prefix helpers
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

  let slug = options.archiveSlug || '';
  if (!slug) {
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

  const shouldArchive = (item: any) =>
    !String(item.name).startsWith('Archive/') &&
    (matches(item.name) || extraNames.has(item.name) || extraNames.has(item.id));

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

export const SESSION_TOOL_DEFS = [
  {"name":"generate_session_name","description":"Generate a memorable session name (adjective-adjective-noun format). Use this when creating a new collab session.","inputSchema":{"properties":{},"type":"object"}},
  {"name":"get_datetime","description":"Get the current date and time on the server. Returns ISO-8601 UTC, a human-readable local string, the IANA timezone, and epoch milliseconds. Use this to timestamp observations while monitoring a long-running process — so when fired events are reviewed later (e.g. overnight) the wall-clock time of each is visible.","inputSchema":{"properties":{},"type":"object"}},
  {"name":"list_sessions","description":"List registered collab sessions. Pass `project` to list only sessions in that project (e.g. to pick an assignee for cross-session todos); omit for all projects.","inputSchema":{"properties":{"project":{"description":"Absolute project path to filter sessions by (optional).","type":"string"}},"type":"object"}},
  {"name":"recommend_session_cleanup","description":"Recommend stale collab sessions for cleanup (read-only). Returns sessions idle longer than `days` (default 30) — excluding any that are live-bound to a running Claude PID or hold in-progress work. Each item carries an age + reason. Clean up a recommended session with archive_session (it copies artifacts to docs/designs/ then optionally deletes). This NEVER deletes anything itself.","inputSchema":{"properties":{"days":{"description":"Staleness window in days (default 30).","type":"number"}},"type":"object"}},
  {"name":"list_projects","description":"List all registered projects","inputSchema":{"properties":{},"required":[],"type":"object"}},
  {"name":"register_project","description":"Register a new project","inputSchema":{"properties":{"path":{"description":"Absolute path to project root","type":"string"}},"required":["path"],"type":"object"}},
  {"name":"unregister_project","description":"Unregister a project (does not delete files)","inputSchema":{"properties":{"path":{"description":"Absolute path to project","type":"string"}},"required":["path"],"type":"object"}},
  {"name":"generate_session_summary","description":"Generate a markdown document summarizing all artifacts (diagrams, documents, designs, spreadsheets) in the current session.","inputSchema":{"properties":{"documentName":{"description":"Name for the summary document (default: \"Session Summary\")","type":"string"},"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\").","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"validate_session_links","description":"Scan all documents in a session for artifact references ({{diagram:id}}, {{design:id}}, {{spreadsheet:id}}) and validate that referenced artifacts exist.","inputSchema":{"properties":{"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\").","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"render_ui","description":"Push UI to browser. Renders JSON UI definitions to the browser and manages user interactions. Can optionally block until user action is received.","inputSchema":{"properties":{"blocking":{"default":true,"description":"Whether to wait for user action (default: true)","type":"boolean"},"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\")","type":"string"},"ui":{"additionalProperties":true,"description":"JSON UI component definition. \n## Available Components (32)\n\n### Display (8)\n- Table: { columns: [{key, header}], rows: [{key: value}] }\n- CodeBlock: { code, language?, showLineNumbers? }\n- DiffView: { oldCode, newCode, language? }\n- JsonViewer: { data, collapsed? }\n- Markdown: { content }\n- Image: { src, alt, width?, height?, caption?, objectFit? }\n- Spinner: { size?, label? }\n- Badge: { text, variant?, size? }\n\n### Layout (6)\n- Card: { title?, subtitle?, footer?, elevation? }\n- Section: { title, collapsible? }\n- Columns: { columns: number }\n- Accordion: { items: [{title, content}] }\n- Alert: { type, title?, message }\n- Divider: { orientation?, label? }\n\n### Interactive (6)\n- Wizard: { steps: [{title, content}], currentStep }\n- Checklist: { items: [{label, checked}] }\n- ApprovalButtons: { actions: [{id, label, primary?}] }\n- ProgressBar: { value, max?, label? }\n- Tabs: { tabs: [{id, label, content}] }\n- Link: { href?, label, onClick?, variant?, external? }\n\n### Inputs (10) - form data collected on action\n- MultipleChoice: { options: [{value, label}], name, label? }\n- TextInput: { name, label?, placeholder?, type? }\n- TextArea: { name, label?, placeholder?, rows? }\n- Checkbox: { options: [{value, label}], name, label? }\n- Confirmation: { message, confirmLabel?, cancelLabel? }\n- RadioGroup: { options: [{value, label}], name, label?, orientation? }\n- Toggle: { name, label?, checked?, size? }\n- NumberInput: { name, label?, min?, max?, step? }\n- Slider: { name, label?, min?, max?, step?, showValue? }\n- FileUpload: { name, accept?, multiple?, maxSize? }\n\n### Mermaid (2)\n- DiagramEmbed: { diagramId }\n- WireframeEmbed: { wireframeId }\n","type":"object"}},"required":["project","session","ui"],"type":"object"}},
  {"name":"update_ui","description":"Update the currently displayed UI without full re-render by applying a partial patch to the current UI.","inputSchema":{"properties":{"patch":{"additionalProperties":true,"description":"Partial UI component patch to apply to current UI","type":"object"},"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\")","type":"string"}},"required":["project","session","patch"],"type":"object"}},
  {"name":"dismiss_ui","description":"Dismiss the currently displayed UI in the browser. Called when user responds in terminal to clear the question panel.","inputSchema":{"properties":{"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\")","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"get_ui_response","description":"Poll for UI response status. Use after render_ui with blocking=false to check if user has responded.","inputSchema":{"properties":{"project":{"description":"Absolute path to the project root directory","type":"string"},"session":{"description":"Session name (e.g., \"bright-calm-river\")","type":"string"},"uiId":{"description":"UI ID returned from render_ui","type":"string"}},"required":["project","session","uiId"],"type":"object"}},
  {"name":"register_claude_session","description":"Register the current Claude Code session with a collab session for notifications. Before calling this tool, run Bash with command \"echo $PPID\" to discover the Claude Code process PID, then pass that value as claudePid. The tool reads /tmp/.claude-session-id-<claudePid> (written by the SessionStart hook) to resolve the Claude session ID, writes a binding file, and triggers the initial WebSocket broadcast. Returns { success, claudeSessionId, sessionRole } — sessionRole is the durable role this session resumes into (\"conductor\" if it owns an active mission, otherwise null); the caller must load the named skill.","inputSchema":{"properties":{"claudePid":{"description":"Claude Code process PID discovered via Bash \"echo $PPID\" (passed as string or number)","type":"string"},"project":{"description":"Project path","type":"string"},"session":{"description":"Collab session name","type":"string"}},"required":["project","session","claudePid"],"type":"object"}},
  {"name":"get_install_path","description":"Get the installation path of the mermaid-collab plugin. Use this to run CLI commands like server start/stop.","inputSchema":{"properties":{},"required":[],"type":"object"}},
  {"name":"clear_session_artifacts","description":"Delete all artifacts (documents, diagrams, designs, snippets) from a session. Session state and the session folder are preserved.","inputSchema":{"properties":{"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"archive_session","description":"Archive a collab session by copying documents, diagrams, designs, and spreadsheets to docs/designs/[session]/ and optionally deleting the session folder.","inputSchema":{"properties":{"delete_session":{"description":"Delete the session after archiving (default: true)","type":"boolean"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name to archive","type":"string"},"timestamp":{"description":"Add timestamp to archive folder name (default: false)","type":"boolean"}},"required":["project","session"],"type":"object"}},
  {"name":"archive_by_prefix","description":"Archive (copy + deprecate) all artifacts whose name begins with a given prefix. Scans documents, diagrams, designs, and snippets. Each match is copied to \"Archive/{slug}/{rest-of-name}\" and the original is deprecated. Returns the list of archived items. Useful for clearing out previous \"Implementing/\" work before generating a new blueprint.","inputSchema":{"properties":{"archive_slug":{"description":"Slug to use for the Archive/{slug}/ destination. If omitted, derived from the first blueprint:true doc under prefix, or a timestamp.","type":"string"},"exclude_prefixes":{"description":"Prefixes to exclude even if they start with `prefix` (e.g. [\"Implementing/Ad-hoc/\"])","items":{"type":"string"},"type":"array"},"extra_names":{"description":"Additional artifact names or IDs to include (e.g. [\"task-graph\"])","items":{"type":"string"},"type":"array"},"prefix":{"description":"Name prefix to match (e.g. \"Implementing/\")","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","prefix"],"type":"object"}},
  {"name":"deprecate_artifact","description":"Mark an artifact as deprecated (hidden by default) or restore it. Deprecated artifacts remain in the session but are filtered from the default view.","inputSchema":{"properties":{"deprecated":{"description":"true to deprecate, false to restore","type":"boolean"},"id":{"description":"Artifact ID","type":"string"},"project":{"description":"Project path","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","id","deprecated"],"type":"object"}},
  {"name":"set_artifact_metadata","description":"Set metadata flags on an artifact. Use to mark documents as blueprint (locked, shown in Blueprint section), pin/unpin, or set any combination of metadata flags.","inputSchema":{"properties":{"blueprint":{"description":"Mark as blueprint (read-only plan document shown in Blueprint section). Also sets locked: true.","type":"boolean"},"deprecated":{"description":"Hide from default view","type":"boolean"},"id":{"description":"Artifact ID","type":"string"},"locked":{"description":"Lock the artifact to prevent editing","type":"boolean"},"pinned":{"description":"Pin to top of sidebar list","type":"boolean"},"project":{"description":"Project path","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","id"],"type":"object"}},
  {"name":"consult_grok","description":"Consult Grok (xAI) with a question or prompt. Useful for a second opinion, cross-checking reasoning, or exploring an idea with a different AI model. Requires XAI_API_KEY env var.","inputSchema":{"properties":{"model":{"description":"Grok model to use. Default: grok-build-0.1.","type":"string"},"prompt":{"description":"The question or prompt to send to Grok","type":"string"},"system":{"description":"Optional system prompt to set context for Grok","type":"string"}},"required":["prompt"],"type":"object"}},
  {"name":"consult_codex","description":"Consult Codex (OpenAI) with a question or prompt. A second, independent opinion at design time — the OpenAI-backed peer of consult_grok. Consult both when pressure-testing a design: they are different models with different failure modes. Requires OPENAI_API_KEY (Settings → Secrets).","inputSchema":{"properties":{"model":{"description":"OpenAI model to use. Default: gpt-5-codex.","type":"string"},"prompt":{"description":"The question or prompt to send to Codex","type":"string"},"system":{"description":"Optional system prompt to set context","type":"string"}},"required":["prompt"],"type":"object"}},
  {"name":"update_task_status","description":"Update a task's status and regenerate the task graph. Broadcasts updates via WebSocket.","inputSchema":{"properties":{"minimal":{"description":"If true, return minimal response (just success) to reduce context size. Default: false","type":"boolean"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"},"status":{"description":"New status for the task","enum":["pending","in_progress","completed","failed"],"type":"string"},"taskId":{"description":"Task ID to update","type":"string"}},"required":["project","session","taskId","status"],"type":"object"}},
  {"name":"update_tasks_status","description":"Update multiple tasks' statuses in a single call. More efficient than multiple update_task_status calls.","inputSchema":{"properties":{"minimal":{"description":"If true, return minimal response (just success and count) to reduce context size. Default: false","type":"boolean"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"},"updates":{"description":"Array of task updates to apply","items":{"properties":{"status":{"description":"New status for the task","enum":["pending","in_progress","completed","failed"],"type":"string"},"taskId":{"description":"Task ID to update","type":"string"}},"required":["taskId","status"],"type":"object"},"type":"array"}},"required":["project","session","updates"],"type":"object"}},
  {"name":"get_task_graph","description":"Get the current task graph state without modifications.","inputSchema":{"properties":{"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"sync_task_graph","description":"Parse blueprint documents in the session and initialize the task graph. Reads blueprint-item-N documents (or task-graph.md if present), performs topological sort into execution waves, and writes batches to session state. Call this after creating blueprint documents to make the task graph available for execution.","inputSchema":{"properties":{"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"add_lesson","description":"Record a lesson learned during the session. Creates LESSONS.md if it doesn't exist.","inputSchema":{"properties":{"category":{"description":"Type of lesson (default: universal)","enum":["universal","codebase","workflow","gotcha"],"type":"string"},"lesson":{"description":"The lesson content","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","lesson"],"type":"object"}},
  {"name":"list_lessons","description":"Get all lessons from a session.","inputSchema":{"properties":{"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"record_friction","description":"Record a structured friction note: the retry reason + LAYER (orchestration = collab harness friction like gate format / wrong test command; domain = the project code/API the worker was editing; operational = systemic/dogfood friction any agent can log without a leaf scope). todoId is now optional — operational notes are not leaf-scoped. Persisted per-project to .collab/friction.db so failure attribution is queryable instead of lost in the worker transcript.","inputSchema":{"properties":{"attempt":{"description":"1-based attempt number — the worker's own count, not the lease retryCount (optional, default 1)","type":"number"},"detail":{"description":"Optional free-text elaboration","type":"string"},"layer":{"description":"Where the friction came from: orchestration (collab harness — gate format, wrong test cmd, profile/tooling), domain (the project code/API the worker was editing), or operational (systemic/dogfood friction any agent can emit without a leaf scope)","enum":["orchestration","domain","operational"],"type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"retryReason":{"description":"Short reason tag, e.g. \"gate-format\", \"wrong-test-cmd\", \"cad-api-rederived\", \"missing-domain-model\"","type":"string"},"session":{"description":"Worker/pool session that emitted it (optional)","type":"string"},"todoId":{"description":"The work-graph todo this attempt was against (optional for operational notes not scoped to a single leaf)","type":"string"}},"required":["project","layer","retryReason"],"type":"object"}},
  {"name":"report_dogfood","description":"Convenience: log a systemic dogfood/operational friction note that ANY agent (worker/daemon/watcher/human) can emit — records an operational-LAYER friction note. Thin wrapper over record_friction with layer=\"operational\" and retryReason=reason; todoId optional (operational notes are not leaf-scoped). Surfaces in list_friction / friction_trends alongside orchestration & domain.","inputSchema":{"properties":{"detail":{"description":"Optional free-text elaboration","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"reason":{"description":"Short reason tag for the systemic dogfood friction, e.g. \"tmux-pane-leak\", \"stale-shadow-server\", \"nudge-not-delivered\"","type":"string"},"todoId":{"description":"Optional work-graph todo this friction relates to (operational notes are usually NOT leaf-scoped)","type":"string"}},"required":["project","reason"],"type":"object"}},
  {"name":"list_friction","description":"Query persisted friction notes (newest first). Filter by todoId / session / layer — e.g. layer=\"domain\" answers \"which todos hit domain-layer friction and why\" without opening each worker's private transcript.","inputSchema":{"properties":{"layer":{"description":"Filter by layer, e.g. \"domain\" to answer \"which todos hit domain-layer friction and why\" (optional)","enum":["orchestration","domain","operational"],"type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Filter to one session (optional)","type":"string"},"todoId":{"description":"Filter to one todo (optional)","type":"string"}},"required":["project"],"type":"object"}},
  {"name":"list_session_todos","description":"List per-session todos (checkable list attached to a collab session). Each todo carries a DERIVED claimability view: `status`/`derivedStatus` = the live state (planned/ready/blocked/in_progress/done/dropped), `storedStatus` = the raw persisted value, plus `isClaimable` + `claimReason`. An approved todo reads derivedStatus:'ready' even though storedStatus stays 'planned'. Set includeCompleted=false to filter out completed items. For long-lived sessions with many todos, pass compact=true (slim projection, omits descriptions) to stay under the token cap, or descriptionLimit=N to truncate descriptions. Results are sorted by order ascending.","inputSchema":{"properties":{"assigneeSession":{"description":"Filter todos assigned to this session","type":"string"},"compact":{"description":"Return a slim projection (id, title, status, assignee, priority, dependsOn, parentId, type, acceptanceStatus, claimedBy, targetProject) — omits `description` and bulky timestamp/claim fields. Use this for long-lived sessions with many richly-described todos to stay under the token cap; fetch a single full description with get_todo.","type":"boolean"},"descriptionLimit":{"description":"When NOT compact, truncate each description to this many characters (a marker is appended when truncated). Ignored if compact=true.","type":"number"},"includeCompleted":{"description":"Include completed todos in the result (default: true)","type":"boolean"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"},"status":{"description":"Filter by status. ready/blocked/in_progress are DERIVED (computed live), so this filters on each todo's derivedStatus, not the raw stored value.","enum":["backlog","planned","todo","ready","in_progress","blocked","done","dropped"],"type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"add_session_todo","description":"DEPRECATED. Use create_epic/add_leaves/create_mission/file_to_bucket instead.","inputSchema":{"type":"object","properties":{}}},
  {"name":"update_session_todo","description":"Update a per-session todo. Any combination of text, completed, and order can be provided; omitted fields are left unchanged.","inputSchema":{"properties":{"assigneeKind":{"description":"Set assignee kind: agent (default) or human. Attribution, not auth (optional).","enum":["agent","human"],"type":"string"},"assigneeSession":{"description":"Reassign to this session (optional)","type":"string"},"completed":{"description":"New completed state (optional)","type":"boolean"},"completedBy":{"description":"Actor handle to record as the completer (e.g. 'local:host'). Normally omitted — a human todo auto-stamps on completion; pass null to clear (optional).","type":["string","null"]},"dependsOn":{"description":"List of todo ids this todo depends on","items":{"type":"string"},"type":"array"},"description":{"description":"New description (optional)","type":"string"},"dueDate":{"description":"New due date ISO string (optional)","type":"string"},"id":{"description":"Todo id to update","type":"string"},"link":{"description":"Set or clear the blueprint link. Provide null to clear, or an object to set.","properties":{"blueprintId":{"description":"Blueprint id","type":"string"},"taskId":{"description":"Task id within the blueprint (optional)","type":"string"}},"required":["blueprintId"],"type":"object"},"parentId":{"description":"Parent todo id (for subtasks)","type":"string"},"priority":{"description":"New priority 0-4 (optional)","type":"number"},"project":{"description":"Absolute path to project root","type":"string"},"servesCriterionId":{"description":"A3 epic→criterion edge: the acceptance criterion this epic serves. Set this on a mission-homed epic before approving it. Pass null to clear.","type":["string","null"]},"servesCriterionIds":{"description":"MULTI-EDGE: set ALL criteria this epic serves in one call (wins over servesCriterionId).","items":{"type":"string"},"type":"array"},"session":{"description":"Session name","type":"string"},"sessionName":{"description":"Session name to associate with this todo","type":"string"},"status":{"description":"New status (optional). ready/blocked/in_progress are DERIVED, never stored: writing 'ready' APPROVES the todo (stamps approvedAt) — the raw stored `status` intentionally stays 'planned' while `derivedStatus`/`status` in the response become 'ready'. Writing 'blocked' = hold. 'in_progress' is rejected (claims are daemon-only). Do NOT retry if the stored status reads 'planned' after approving — check derivedStatus/isClaimable instead.","enum":["backlog","planned","todo","ready","in_progress","blocked","done","dropped"],"type":"string"},"targetProject":{"description":"Absolute path to the repo where this todo is IMPLEMENTED, when different from the tracking project (the worker spawns with cwd=targetProject and its gate runs there). Pass null to clear. Steward use: reroute a cross-project todo (e.g. a yolox/build123d todo) that was created without it.","type":["string","null"]},"text":{"description":"New text/title (optional)","type":"string"},"tier":{"description":"Set the executor recipe tier (full|small|test-pinned). Settable alongside status:'ready' to pin the tier at approve time.","enum":["full","small","test-pinned"],"type":"string"},"title":{"description":"New title (optional, alias for text)","type":"string"}},"required":["project","session","id"],"type":"object"}},
  {"name":"toggle_session_todo","description":"Toggle the completed state of a per-session todo. If completed is omitted, the current value is flipped.","inputSchema":{"properties":{"completed":{"description":"Explicit state; when omitted the current value is flipped","type":"boolean"},"id":{"description":"Todo id to toggle","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","id"],"type":"object"}},
  {"name":"remove_session_todo","description":"Remove a per-session todo by id.","inputSchema":{"properties":{"id":{"description":"Todo id to remove","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","id"],"type":"object"}},
  {"name":"clear_completed_session_todos","description":"Remove all completed per-session todos for a session. Returns the number of todos removed.","inputSchema":{"properties":{"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session"],"type":"object"}},
  {"name":"reorder_session_todos","description":"Reorder per-session todos by providing a full permutation of existing todo ids. Assigns new order values (10, 20, 30, ...) in the provided sequence.","inputSchema":{"properties":{"orderedIds":{"description":"Full permutation of existing todo ids in desired order","items":{"type":"string"},"type":"array"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","orderedIds"],"type":"object"}},
  {"name":"assign_session_todo","description":"Assign a session todo to a specific session (assigneeSession). Pass null to unassign.","inputSchema":{"properties":{"assigneeSession":{"description":"Session to assign the todo to, or null to unassign","type":["string","null"]},"id":{"description":"Todo id to assign","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"}},"required":["project","session","id","assigneeSession"],"type":"object"}},
  {"name":"complete_linked_todos","description":"Mark completed all session todos linked to a blueprint (and optional taskId). Used to sync linked todos when a Go task finishes.","inputSchema":{"properties":{"blueprintId":{"description":"Blueprint id to match","type":"string"},"project":{"description":"Absolute path to project root","type":"string"},"session":{"description":"Session name","type":"string"},"taskId":{"description":"Task id to match (optional; matches all tasks in blueprint when omitted)","type":"string"}},"required":["project","session","blueprintId"],"type":"object"}},
];

export async function handleSessionTool(name: string, args: any): Promise<string | null> {
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

      const diagramIds = new Set(diagrams.map((d: any) => d.id));
      const documentIds = new Set(documents.map((d: any) => d.id));
      const designIds = new Set(designs.map((d: any) => d.id));
      const spreadsheetIds = new Set(spreadsheets.map((d: any) => d.id));

      const valid: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];
      const broken: Array<{ docId: string; ref: string; targetType: string; targetId: string }> = [];

      for (const doc of documents) {
        try {
          const docContent = await getDocument(project, session, doc.id);
          const parsed = JSON.parse(docContent);
          const content = parsed.content || '';

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
      const { updateUI } = await import('./tools/update-ui.js');
      return await updateUI(project, session, patch);
    }

    case 'dismiss_ui': {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      const { dismissUI } = await import('./tools/dismiss-ui.js');
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
        const bindingTmp = `${bindingFile}.tmp.${process.pid}`;
        fs.writeFileSync(bindingTmp, bindingContent, 'utf-8');
        try {
          fs.renameSync(bindingTmp, bindingFile);
        } catch {
          try { fs.unlinkSync(bindingTmp); } catch {}
          fs.writeFileSync(bindingFile, bindingContent, 'utf-8');
        }
      } catch (err: any) {
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

    case 'get_install_path': {
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
          detail = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : '') || parsed?.message || raw;
        } catch { /* non-JSON body */ }
        throw new Error(`Grok API error (${response.status} ${response.statusText}): ${detail || '(no body)'}`);
      }

      const data = await response.json() as any;
      const reply = data.choices?.[0]?.message?.content ?? '';

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

    default:
      return null;
  }
}
