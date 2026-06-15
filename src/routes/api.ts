import { DiagramManager } from '../services/diagram-manager';
import { watchSession } from '../services/session-artifact-watcher';
import { DocumentManager } from '../services/document-manager';
import { SpreadsheetManager } from '../services/spreadsheet-manager';
import { SnippetManager } from '../services/snippet-manager';
import { EmbedManager } from '../services/embed-manager';
import { ImageManager } from '../services/image-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { transpile, isSmachYaml } from '../services/smach-transpiler';
import { sessionRegistry, type Session } from '../services/session-registry';
import { questionManager } from '../services/question-manager';
import { uiManager } from '../services/ui-manager';
import { statusManager } from '../services/status-manager';
import { projectRegistry } from '../services/project-registry';
import { UpdateLogManager } from '../services/update-log-manager';
import { launchRemoteServer, detectRemoteLaunch } from '../services/remote-launch';
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { archiveSession, type ArchiveOptions } from '../mcp/tools/collab-state';
import { addLesson, listLessons, type LessonCategory } from '../mcp/tools/lessons';
import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  removeTodo,
  clearCompleted,
  reorder,
  type TodoLink as SessionTodoLink,
} from '../services/todo-store';
import { recordStatus, getStatuses, getStatus, recordContextPercent, type ClaudeStatus } from '../services/session-status-store';
import { listSessionRuntimes } from '../services/session-runtime';
import { getFleetStatus } from '../services/fleet-status';
import { isSupervised, getSupervisorIdentity, getSupervisedLaunchProject, addWatchedProject, removeWatchedProject } from '../services/supervisor-store.ts';
import { sendTmuxKeys } from '../services/tmux-send.ts';
import { lastAssistantTurn } from '../services/transcript-reader.ts';
import {
  listDesignsHandler,
  createDesignHandler,
  getDesignHandler,
  updateDesignHandler,
} from '../api/design-routes';
import {
  parseTaskGraph,
  buildBatches,
  type TaskGraphTask,
} from '../mcp/workflow/task-sync';
import { mergeSettings, readSettings, writeSettings, patchSettings } from '../agent/settings-store.js';
import { tmuxBaseName } from '../services/tmux-naming.js';
import { SERVER_VERSION } from '../mcp/server';
import { currentExePath, serverOwner } from '../services/port-ownership';
import { config } from '../config';
import { xaiProvider } from '../../tooling/imagegen/providers/xai';
import { applyTaskPreset } from '../../tooling/imagegen/prompts';
import type { ImageTask } from '../../tooling/imagegen/providers/types';
import { generateVideo } from '../../tooling/imagegen/providers/xai-video';
import { extractFrames, hasFfmpeg } from '../../tooling/imagegen/pipeline/frames';
import { loadProjectStyle, saveProjectStyle, applyStyleToPrompt, type ProjectStyle } from '../services/project-style';
import { saveCharacter, loadCharacter, listCharacters, resolveActions, characterSlug, type CharacterDef } from '../services/character-store';
import { loadSpend, setBudget, recordSpend, wouldExceedBudget, estimateCost } from '../services/asset-spend';
import { AudioManager } from '../services/audio-manager';
import { synthesizeSpeech } from '../../tooling/audiogen/providers/xai-tts';
import { applyChain, listPresets } from '../../tooling/audiogen/dsp';
import { completeJson } from '../../tooling/audiogen/providers/xai-text';
import { renderSfxr } from '../../tooling/audiogen/sfx/sfxr';
import { renderChiptune } from '../../tooling/audiogen/music/chiptune';
// The image pipeline (removeBg/downscale/packSheet/spriteSheet) uses jimp (pure JS),
// which embeds + runs inside the bun --compile sidecar (sharp's native module does NOT —
// it was ported off sharp for exactly this reason). Imported lazily anyway to keep startup
// lean and isolate any pipeline load error to the sprite routes.
async function loadSpritePipeline() {
  const [{ removeBackground, alphaFromLuminance }, { downscale }, { packSheet }, { sliceGrid, autocropRecenter, pickMarkerColor }, { normalizeExportFormats }, { quantizeBuffer }, { makeSeamless }] = await Promise.all([
    import('../../tooling/imagegen/pipeline/removeBg'),
    import('../../tooling/imagegen/pipeline/downscale'),
    import('../../tooling/imagegen/pipeline/packSheet'),
    import('../../tooling/imagegen/pipeline/spriteSheet'),
    import('../../tooling/imagegen/pipeline/exporters'),
    import('../../tooling/imagegen/pipeline/quantize'),
    import('../../tooling/imagegen/pipeline/seamless'),
  ]);
  return { removeBackground, alphaFromLuminance, downscale, packSheet, sliceGrid, autocropRecenter, pickMarkerColor, normalizeExportFormats, quantizeBuffer, makeSeamless };
}
import { tmpdir as osTmpdir } from 'os';
import { readFile as fsReadFile, rm as fsRm, mkdtemp as fsMkdtemp } from 'fs/promises';

/**
 * Expand ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  if (path === '~') {
    return homedir();
  }
  return path;
}

// Track server start time for uptime calculation
const serverStartTime = Date.now();

const pairModeBySession = new Map<string, boolean>();

// Minimal source loader for image routes when loadImageBytes isn't exported
async function loadImageSourceToBuffer(source: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error('Invalid data URI');
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, mimeType: res.headers.get('content-type') || 'application/octet-stream' };
  }
  // Assume file path
  const { readFile } = await import('fs/promises');
  const buf = await readFile(source);
  // Infer mime from extension
  const ext = source.toLowerCase().split('.').pop() || '';
  const extMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };
  return { buffer: buf, mimeType: extMap[ext] || 'application/octet-stream' };
}

/**
 * Extract project and session from query params.
 * Returns null if either is missing.
 */
function getSessionParams(url: URL): { project: string; session: string } | null {
  const project = url.searchParams.get('project');
  const session = url.searchParams.get('session');

  if (!project || !session) {
    return null;
  }

  return { project, session };
}

/**
 * Handle health check requests
 */
async function handleHealthCheck(wsHandler: WebSocketHandler): Promise<Response> {
  // Calculate uptime
  const uptimeMs = Date.now() - serverStartTime;
  const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
  const uptime = hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;

  // API is running (if we're responding)
  const apiRunning = true;
  const port = parseInt(process.env.PORT || '9002', 10);

  // The UI is "available" if EITHER the Vite dev server is up (dev mode) OR this
  // API server is itself serving the built UI from ui/dist (desktop/production).
  // Historically we only probed the dev server on 9102, which is dev-only — so a
  // desktop deploy (UI served from this server on 9002) always reported the UI
  // down and triggered a false "collab UI is not active" warning.
  const UI_PORT = 9102;
  // Served-from-dist case: index.html present under UI_DIST_DIR.
  const builtUiServed = existsSync(join(config.UI_DIST_DIR, 'index.html'));
  let uiPort = UI_PORT;
  let uiRunning = builtUiServed;
  if (builtUiServed) {
    // UI is served by this API server; report its port.
    uiPort = port;
  } else {
    // Probe the Vite dev server on its fixed port. Short timeout so health
    // stays fast even when the UI is down.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`http://localhost:${UI_PORT}/`, { signal: controller.signal });
      clearTimeout(timer);
      uiRunning = res.ok;
    } catch {
      uiRunning = false;
    }
  }

  // Get WebSocket connection count
  const connections = wsHandler.getConnectionCount();

  // Determine overall health
  const healthy = apiRunning && uiRunning;

  return Response.json({
    healthy,
    // Identity block (design-ubuntu-native §4a) — the canonical port-ownership
    // handshake reads these to tell a current/rightful owner from a stale shadow.
    // `ok` is always true here: if this route answers, the API is up.
    ok: true,
    version: SERVER_VERSION,
    exePath: currentExePath(),
    startedAt: new Date(serverStartTime).toISOString(),
    owner: serverOwner(),
    services: {
      api: { running: apiRunning, port },
      ui: { running: uiRunning, port: uiPort },
      websocket: { connections },
    },
    pid: process.pid,
    uptime,
  });
}

/**
 * Create managers for a specific project+session.
 */
async function createManagers(project: string, session: string) {
  const diagramsDir = sessionRegistry.resolvePath(project, session, 'diagrams');
  const documentsDir = sessionRegistry.resolvePath(project, session, 'documents');
  const spreadsheetsDir = sessionRegistry.resolvePath(project, session, 'spreadsheets');
  const snippetsDir = sessionRegistry.resolvePath(project, session, 'snippets');
  const embedsDir = sessionRegistry.resolvePath(project, session, 'embeds');
  const imagesDir = sessionRegistry.resolvePath(project, session, 'images');

  const diagramManager = new DiagramManager(diagramsDir);
  const documentManager = new DocumentManager(documentsDir);
  const spreadsheetManager = new SpreadsheetManager(spreadsheetsDir);
  const snippetManager = new SnippetManager(snippetsDir);
  const embedManager = new EmbedManager(embedsDir);
  const imageManager = new ImageManager(imagesDir);
  const sessionDir = sessionRegistry.resolvePath(project, session, '.');
  const metadataManager = new MetadataManager(sessionDir);

  // Initialize managers (creates directories, builds index)
  await diagramManager.initialize();
  await documentManager.initialize();
  await spreadsheetManager.initialize();
  await snippetManager.initialize();
  await embedManager.initialize();
  await imageManager.initialize();
  await metadataManager.initialize();

  return { diagramManager, documentManager, spreadsheetManager, snippetManager, embedManager, imageManager, metadataManager };
}

export async function handleAPI(
  req: Request,
  _diagramManager: DiagramManager,  // Unused - we create per-session managers
  _documentManager: DocumentManager, // Unused - we create per-session managers
  _metadataManager: MetadataManager, // Unused - we create per-session managers
  validator: Validator,
  renderer: Renderer,
  wsHandler: WebSocketHandler,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // ============================================
  // Session Registry Routes (no project/session required)
  // ============================================

  // GET /api/sessions - List all registered sessions
  if (path === '/api/sessions' && req.method === 'GET') {
    try {
      const all = await sessionRegistry.list();
      // Optional ?project= filter (assignee picker lists sibling sessions).
      const projectFilter = url.searchParams.get('project');
      const sessions = projectFilter ? all.filter((s) => s.project === projectFilter) : all;
      return Response.json({ sessions }, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/sessions - Register a session (called by MCP tools)
  if (path === '/api/sessions' && req.method === 'POST') {
    try {
      const { project: rawProject, session, useRenderUI } = await req.json() as {
        project?: string;
        session?: string;
        useRenderUI?: boolean;
      };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      const result = await sessionRegistry.register(project, session, useRenderUI);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project, session });
      }
      // Return the expanded project path so the client uses the correct path
      return Response.json({ success: true, project, session, created: result.created });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // DELETE /api/sessions - Unregister a session
  if (path === '/api/sessions' && req.method === 'DELETE') {
    try {
      const { project: rawProject, session } = await req.json() as { project?: string; session?: string };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      const removed = await sessionRegistry.unregister(project, session);
      return Response.json({ success: removed });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/sessions/archive - Archive a session
  if (path === '/api/sessions/archive' && req.method === 'POST') {
    try {
      const { project: rawProject, session, deleteSession, timestamp } = await req.json() as {
        project?: string;
        session?: string;
        deleteSession?: boolean;
        timestamp?: boolean;
      };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      const options: ArchiveOptions = {
        deleteSession: deleteSession ?? true,
        timestamp: timestamp ?? false,
      };

      const result = await archiveSession(project, session, options);

      // Unregister from session registry if deleted
      if (options.deleteSession) {
        await sessionRegistry.unregister(project, session);
        wsHandler.broadcast({ type: 'session_deleted', project, session });
      }

      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // ============================================
  // Project Registry Routes
  // ============================================

  // GET /api/projects - List all projects
  if (path === '/api/projects' && req.method === 'GET') {
    try {
      const projects = await projectRegistry.list();
      return Response.json({ projects }, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/projects - Register a project
  if (path === '/api/projects' && req.method === 'POST') {
    try {
      const { path: projectPath } = await req.json() as { path?: string };

      if (!projectPath) {
        return Response.json({ success: false, error: 'path is required' }, { status: 400 });
      }

      // Validate path is absolute
      if (!isAbsolute(projectPath)) {
        return Response.json({ success: false, error: 'Invalid project path: must be an absolute path' }, { status: 400 });
      }

      // Validate path exists
      if (!existsSync(projectPath)) {
        return Response.json({ success: false, error: `Project path does not exist: ${projectPath}` }, { status: 400 });
      }

      // Register the project
      await projectRegistry.register(projectPath);

      // Unified project list (decision: one list everywhere): the project
      // registry and the supervisor's watched set are kept in lockstep, so a
      // project added from the Watching surface also shows up in the Bridge rail.
      addWatchedProject(projectPath);

      // Migrate any legacy roadmap.db → unified todo work-graph for THIS project.
      // Idempotent (sentinel todo), so safe to run lazily on every register — the
      // boot-time pass only covers MERMAID_PROJECT, leaving other projects unmigrated.
      try {
        const { migrateRoadmapToTodos } = await import('../services/roadmap-migration.js');
        const { migrated } = await migrateRoadmapToTodos(projectPath);
        if (migrated > 0) console.log(`[projects] migrated ${migrated} roadmap item(s) → todos for ${projectPath}`);
      } catch (err: any) {
        console.warn(`[projects] roadmap→todos migration skipped for ${projectPath}: ${err?.message || String(err)}`);
      }

      // Auto-register any existing sessions found on disk
      const sessionsDir = join(projectPath, '.collab', 'sessions');
      if (existsSync(sessionsDir)) {
        const entries = readdirSync(sessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            await sessionRegistry.register(projectPath, entry.name, false).catch(() => {});
          }
        }
      }

      // Get the project details
      const projects = await projectRegistry.list();
      const project = projects.find(p => p.path === projectPath);

      if (!project) {
        return Response.json({ success: false, error: 'Failed to retrieve registered project' }, { status: 500 });
      }

      return Response.json({ success: true, project }, { status: 201 });
    } catch (error: any) {
      return Response.json({ success: false, error: error.message }, { status: 400 });
    }
  }

  // DELETE /api/projects - Unregister a project
  if (path === '/api/projects' && req.method === 'DELETE') {
    try {
      const projectPath = url.searchParams.get('path');

      if (!projectPath) {
        return Response.json({ success: false, error: 'path query parameter is required' }, { status: 400 });
      }

      // Unregister the project
      const removed = await projectRegistry.unregister(projectPath);

      if (!removed) {
        return Response.json({ success: false, error: 'Project not found' }, { status: 404 });
      }

      // Keep the unified list in lockstep — drop it from the watched set too.
      removeWatchedProject(projectPath);

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ success: false, error: error.message }, { status: 400 });
    }
  }

  // GET /api/health - Server health check
  if (path === '/api/health' && req.method === 'GET') {
    return handleHealthCheck(wsHandler);
  }

  // POST /api/server/launch - SSH into a remote machine and start a collab
  // server there. Body: { host, port, user?, password?, command }. The password
  // is used once for the SSH session and never persisted. Runs on the LOCAL
  // sidecar (which has the system `ssh`); the UI calls it same-origin.
  if (path === '/api/server/launch' && req.method === 'POST') {
    try {
      const body = (await req.json()) as {
        host?: string; port?: number; user?: string; password?: string; command?: string; token?: string;
      };
      if (!body.host || !body.command) {
        return Response.json({ ok: false, error: 'host and command are required' }, { status: 400 });
      }
      const result = await launchRemoteServer({
        host: body.host,
        port: Number(body.port) || 9002,
        user: body.user?.trim() || undefined,
        password: body.password || undefined,
        command: body.command,
        token: body.token?.trim() || undefined,
      });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : 'launch failed' },
        { status: 500 },
      );
    }
  }

  // POST /api/server/detect - SSH into a host and suggest a start command
  // (probes for bun / mermaid-collab / the plugin cache). Body: { host, port,
  // user?, password? }. Used to prefill the launch dialog.
  if (path === '/api/server/detect' && req.method === 'POST') {
    try {
      const body = (await req.json()) as { host?: string; port?: number; user?: string; password?: string };
      if (!body.host) return Response.json({ ok: false, error: 'host is required' }, { status: 400 });
      const result = await detectRemoteLaunch({
        host: body.host,
        port: Number(body.port) || 9002,
        user: body.user?.trim() || undefined,
        password: body.password || undefined,
      });
      return Response.json(result, { status: result.ok ? 200 : 502 });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : 'detect failed' },
        { status: 500 },
      );
    }
  }

  // GET /api/session-state?project=...&session=... - Get collab session state
  if (path === '/api/session-state' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      // Check new location first, then old location for backwards compatibility
      const newPath = join(params.project, '.collab', 'sessions', params.session, 'collab-state.json');
      const oldPath = join(params.project, '.collab', params.session, 'collab-state.json');

      let stateFile = Bun.file(newPath);
      if (!await stateFile.exists()) {
        stateFile = Bun.file(oldPath);
        if (!await stateFile.exists()) {
          return Response.json({ error: 'Session state not found' }, { status: 404 });
        }
      }

      const content = await stateFile.text();
      const state = JSON.parse(content);

      // Compute displayName from state field if not already set
      if (!state.displayName && state.state) {
        state.displayName = state.state.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      } else if (!state.displayName) {
        state.displayName = params.session;
      }

      return Response.json(state);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/session-state/clear-tasks?project=...&session=... - Clear task graph from collab-state.json
  if (path === '/api/session-state/clear-tasks' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const statePath = join(params.project, '.collab', 'sessions', params.session, 'collab-state.json');
      const stateFile = Bun.file(statePath);

      if (!await stateFile.exists()) {
        // Nothing to clear
        return Response.json({ success: true, cleared: false });
      }

      const content = await stateFile.text();
      const state = JSON.parse(content);

      // Clear task-related fields
      state.batches = [];
      state.pendingTasks = [];
      state.completedTasks = [];

      await Bun.write(statePath, JSON.stringify(state, null, 2));

      // Broadcast update so connected clients refresh
      wsHandler.broadcast({
        type: 'session_state_updated',
        project: params.project,
        session: params.session,
        state,
      });

      return Response.json({ success: true, cleared: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/projects/:project/sessions/:session/task-graph - Get task graph for UI display
  const taskGraphMatch = path.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/task-graph$/);
  if (taskGraphMatch && req.method === 'GET') {
    const project = decodeURIComponent(taskGraphMatch[1]);
    const session = decodeURIComponent(taskGraphMatch[2]);

    try {
      // Get session state (primary source for task graph with statuses)
      const statePath = join(project, '.collab', 'sessions', session, 'collab-state.json');
      const stateFile = Bun.file(statePath);
      let completedTasks: string[] = [];
      let pendingTasks: string[] = [];
      let stateBatches: Array<{ id: string; tasks: Array<{ id: string; status?: string; dependsOn?: string[] }> }> = [];

      if (await stateFile.exists()) {
        try {
          const stateContent = await stateFile.text();
          const state = JSON.parse(stateContent);
          completedTasks = state.completedTasks || [];
          pendingTasks = state.pendingTasks || [];
          stateBatches = state.batches || [];
        } catch {
          // Failed to read state
        }
      }

      // If we have batches in session state, use those (they have correct edges and statuses)
      if (stateBatches.length > 0) {
        const mermaidLines: string[] = ['graph TD'];

        // Muted status colors (dark-mode friendly)
        const statusColors = {
          pending: 'fill:#64748b,stroke:#475569,color:#fff',      // muted gray
          in_progress: 'fill:#6987c9,stroke:#4b6cb7,color:#fff',  // muted blue
          completed: 'fill:#6b9e7d,stroke:#4a7c5c,color:#fff',    // muted green
          failed: 'fill:#c97676,stroke:#a85555,color:#fff',       // muted red
        };

        // Add class definitions
        mermaidLines.push(`    classDef pending ${statusColors.pending}`);
        mermaidLines.push(`    classDef in_progress ${statusColors.in_progress}`);
        mermaidLines.push(`    classDef completed ${statusColors.completed}`);
        mermaidLines.push(`    classDef failed ${statusColors.failed}`);
        mermaidLines.push('');

        // Add nodes for each task (no subgraphs)
        for (const batch of stateBatches) {
          for (const task of batch.tasks) {
            const nodeId = task.id.replace(/[^a-zA-Z0-9_]/g, '_');
            mermaidLines.push(`    ${nodeId}["${task.id}"]`);
          }
        }

        mermaidLines.push('');

        // Add edges from session state (with proper filtering like MCP tool)
        for (const batch of stateBatches) {
          for (const task of batch.tasks) {
            const deps = task.dependsOn || [];
            for (const dep of deps) {
              if (!dep || !dep.trim()) continue;  // Skip empty dependencies
              const fromId = dep.replace(/[^a-zA-Z0-9_]/g, '_');
              if (!fromId || fromId === '_') continue;  // Skip invalid IDs
              const toId = task.id.replace(/[^a-zA-Z0-9_]/g, '_');
              mermaidLines.push(`    ${fromId} --> ${toId}`);
            }
          }
        }

        mermaidLines.push('');

        // Apply class to each task based on status
        for (const batch of stateBatches) {
          for (const task of batch.tasks) {
            const nodeId = task.id.replace(/[^a-zA-Z0-9_]/g, '_');
            const statusClass = task.status || 'pending';
            mermaidLines.push(`    class ${nodeId} ${statusClass}`);
          }
        }

        const diagram = mermaidLines.join('\n');

        // Convert stateBatches to the expected format
        const batches = stateBatches.map(b => ({
          id: b.id,
          tasks: b.tasks.map(t => ({ id: t.id, status: t.status })),
        }));

        return Response.json({
          diagram,
          batches,
          completedTasks,
          pendingTasks,
        });
      }

      // Fallback: Read from task-graph.md if no session state batches
      const documentsPath = sessionRegistry.resolvePath(project, session, 'documents');
      const taskGraphPath = join(documentsPath, 'task-graph.md');
      const taskGraphFile = Bun.file(taskGraphPath);

      if (!await taskGraphFile.exists()) {
        return Response.json({
          diagram: null,
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        });
      }

      const content = await taskGraphFile.text();

      let tasks: TaskGraphTask[] = [];
      try {
        const taskGraph = parseTaskGraph(content);
        tasks = taskGraph.tasks;
      } catch {
        return Response.json({
          diagram: null,
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        });
      }

      const batches = buildBatches(tasks);
      const waveColors = ['#94a3b8', '#7c9fc9', '#a3a38f', '#b39eb5', '#c9a38f'];  // muted wave colors
      const mermaidLines: string[] = ['graph TD'];

      for (const task of tasks) {
        const shortDesc = task.description.substring(0, 30) + (task.description.length > 30 ? '...' : '');
        mermaidLines.push(`    ${task.id}["${task.id}<br/>${shortDesc}"]`);
      }

      mermaidLines.push('');

      for (const task of tasks) {
        const deps = task['depends-on'] || [];
        for (const dep of deps) {
          if (!dep || !dep.trim()) continue;
          mermaidLines.push(`    ${dep} --> ${task.id}`);
        }
      }

      mermaidLines.push('');

      batches.forEach((batch, waveIndex) => {
        const waveColor = waveColors[waveIndex % waveColors.length];
        for (const task of batch.tasks) {
          mermaidLines.push(`    style ${task.id} fill:${waveColor},stroke:#475569,color:#fff`);
        }
      });

      const diagram = mermaidLines.join('\n');

      return Response.json({
        diagram,
        batches,
        completedTasks,
        pendingTasks,
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/ui-state?project=...&session=... - Get cached UI state for reconnection
  if (path === '/api/ui-state' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const sessionKey = `${params.project}:${params.session}`;
      const cachedUI = uiManager.getCurrentUI(sessionKey);

      if (!cachedUI) {
        return Response.json({ status: 'none' });
      }

      return Response.json({
        uiId: cachedUI.uiId,
        ui: cachedUI.ui,
        blocking: cachedUI.blocking,
        status: cachedUI.status,
        createdAt: cachedUI.createdAt,
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/status - Agent status check
  if (path === '/api/status' && req.method === 'GET') {
    const status = statusManager.getStatus();
    return Response.json(status);
  }

  // GET /api/pair-mode - Get current pair mode for a session
  if (path === '/api/pair-mode' && req.method === 'GET') {
    const project = url.searchParams.get('project') ?? '';
    const session = url.searchParams.get('session') ?? '';
    const key = `${project}::${session}`;
    return Response.json({ pairMode: pairModeBySession.get(key) ?? false });
  }

  // POST /api/pair-mode - Toggle or set pair mode for a session
  if (path === '/api/pair-mode' && req.method === 'POST') {
    try {
      const body = await req.json();
      const { project = '', session = '', toggle, value } = body as {
        project?: string;
        session?: string;
        toggle?: boolean;
        value?: boolean;
      };
      const key = `${project}::${session}`;
      const current = pairModeBySession.get(key) ?? false;
      let next: boolean;
      if (toggle === true) {
        next = !current;
      } else if (typeof value === 'boolean') {
        next = value;
      } else {
        return Response.json({ error: 'Either toggle or value must be provided' }, { status: 400 });
      }
      pairModeBySession.set(key, next);
      wsHandler.broadcast({ type: 'pair_mode_changed', pairMode: next, project, session });
      return Response.json({ pairMode: next });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // ============================================
  // Session-scoped routes (require project + session params)
  // ============================================

  // GET /api/diagrams?project=...&session=...
  if (path === '/api/diagrams' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { diagramManager, metadataManager } = await createManagers(params.project, params.session);
    const diagrams = await diagramManager.listDiagrams();
    const diagramsWithMeta = diagrams.map((d) => ({ ...d, deprecated: metadataManager.isDeprecated(d.id), pinned: metadataManager.isPinned(d.id) }));
    return Response.json({ diagrams: diagramsWithMeta });
  }

  // GET /api/diagram/:id/history?project=...&session=...
  if (path.match(/^\/api\/diagram\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/')[3];

    try {
      const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('diagrams', id);

      // Return empty history if none exists (not a 404 - the item exists, just no changes yet)
      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/diagram/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/diagram\/[^/]+\/version$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const timestamp = url.searchParams.get('timestamp');
    if (!timestamp) {
      return Response.json({ error: 'timestamp query param required' }, { status: 400 });
    }

    const id = path.split('/')[3];

    try {
      const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const content = await updateLogManager.replayToTimestamp('diagrams', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/diagram/:id?project=...&session=...
  if (path.startsWith('/api/diagram/') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { diagramManager } = await createManagers(params.project, params.session);
    const diagram = await diagramManager.getDiagram(id);

    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    return Response.json(diagram);
  }

  // POST /api/diagram?project=...&session=... (create new)
  if (path === '/api/diagram' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { name, content } = await req.json() as { name?: string; content?: string };

    if (!name || !content) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    // Validate first
    const validation = await validator.validate(content);
    if (!validation.valid) {
      return Response.json({
        success: false,
        error: validation.error,
        line: validation.line,
      }, { status: 400 });
    }

    try {
      // Register session if not already registered
      const result = await sessionRegistry.register(params.project, params.session);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      const { diagramManager } = await createManagers(params.project, params.session);
      const id = await diagramManager.createDiagram(name, content);

      // Broadcast creation immediately
      wsHandler.broadcast({
        type: 'diagram_created',
        id,
        name,
        content,
        lastModified: Date.now(),
        project: params.project,
        session: params.session,
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/diagram/:id?project=...&session=... (update)
  if (path.startsWith('/api/diagram/') && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { content } = await req.json() as { content?: string };

    if (!content) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    // Validate first
    const validation = await validator.validate(content);
    if (!validation.valid) {
      return Response.json({
        success: false,
        error: validation.error,
        line: validation.line,
      }, { status: 400 });
    }

    try {
      const { diagramManager } = await createManagers(params.project, params.session);

      // Get old content before saving (for history logging)
      const oldDiagram = await diagramManager.getDiagram(id);
      const oldContent = oldDiagram?.content ?? '';

      await diagramManager.saveDiagram(id, content);

      // Log the update (don't fail the request if logging fails)
      try {
        const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
        const updateLogManager = new UpdateLogManager(sessionPath);
        await updateLogManager.logUpdate('diagrams', id, oldContent, content);

        // Get updated change count for broadcast
        const history = await updateLogManager.getHistory('diagrams', id);
        const changeCount = history?.changes.length ?? 0;

        // Only broadcast if there's history (content actually changed)
        if (changeCount > 0) {
          wsHandler.broadcast({
            type: 'diagram_history_updated',
            id,
            project: params.project,
            session: params.session,
            changeCount,
          });
        }
      } catch (logError) {
        // Log error but don't fail the request - history is supplementary
        console.warn('Failed to log diagram update:', logError);
      }

      // Broadcast update immediately
      const diagram = await diagramManager.getDiagram(id);
      if (diagram) {
        wsHandler.broadcast({
          type: 'diagram_updated',
          id,
          content: diagram.content,
          lastModified: diagram.lastModified,
          project: params.project,
          session: params.session,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/diagram/:id?project=...&session=...
  if (path.startsWith('/api/diagram/') && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const { diagramManager } = await createManagers(params.project, params.session);
      await diagramManager.deleteDiagram(id);

      // Broadcast deletion immediately
      wsHandler.broadcast({
        type: 'diagram_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // ============================================
  // Design Routes
  // ============================================

  // GET /api/designs?project=...&session=...
  if (path === '/api/designs' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { metadataManager } = await createManagers(params.project, params.session);
      const mockRes = {
        json: (data: any) => {
          const enriched = data.designs.map((d: any) => ({
            ...d,
            deprecated: metadataManager.isDeprecated(d.id),
            pinned: metadataManager.isPinned(d.id),
          }));
          return Response.json({ designs: enriched });
        },
      };
      return await listDesignsHandler({ query: params }, mockRes);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/design?project=...&session=... (create new)
  if (path === '/api/design' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { name, content } = (await req.json()) as { name?: string; content?: string };

      if (!name || !content) {
        return Response.json({ error: 'Name and content required' }, { status: 400 });
      }

      // Register session if not already registered
      const result = await sessionRegistry.register(params.project, params.session);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      let capturedData: any = null;
      const mockRes = {
        json: (data: any) => {
          capturedData = data;
          return Response.json(data);
        },
      };
      const mockReq = {
        query: params,
        json: async () => ({ name, content }),
      };
      const response = await createDesignHandler(mockReq, mockRes);

      // Broadcast design creation if successful
      if (capturedData && capturedData.success && capturedData.id) {
        wsHandler.broadcast({
          type: 'design_created',
          id: capturedData.id,
          project: params.project,
          session: params.session,
        });
      }

      return response;
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/design/:id/history?project=...&session=...
  if (path.match(/^\/api\/design\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('designs', id);

      // Return empty history if none exists (not a 404 - the item exists, just no changes yet)
      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/design/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/design\/[^/]+\/version$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const timestamp = url.searchParams.get('timestamp');
    if (!timestamp) {
      return Response.json({ error: 'timestamp query param required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const content = await updateLogManager.replayToTimestamp('designs', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/design/:id?project=...&session=...
  if (path.startsWith('/api/design/') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);

    try {
      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => Response.json(data, { status: code }),
        }),
        json: (data: any) => Response.json(data),
      };
      return await getDesignHandler({ query: { ...params, id } }, mockRes);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // POST /api/design/:id?project=...&session=... (update)
  if (path.startsWith('/api/design/') && !path.includes('/history') && !path.includes('/version') && !path.includes('/export') && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);

    try {
      const { content } = (await req.json()) as { content?: string };

      if (!content) {
        return Response.json({ error: 'Content required' }, { status: 400 });
      }

      // Get old content before saving (for history logging)
      let oldContent = '';
      try {
        const designPath = join(params.project, '.collab', 'sessions', params.session, 'designs', `${id}.design.json`);
        const designFile = Bun.file(designPath);
        if (await designFile.exists()) {
          oldContent = await designFile.text();
        }
      } catch {
        // Ignore errors reading old content
      }

      let capturedData: any = null;
      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => {
            capturedData = data;
            return Response.json(data, { status: code });
          },
        }),
        json: (data: any) => {
          capturedData = data;
          return Response.json(data);
        },
      };
      const mockReq = {
        query: { ...params, id },
        json: async () => ({ content }),
      };
      const response = await updateDesignHandler(mockReq, mockRes);

      // Broadcast design update if successful
      if (capturedData && capturedData.success) {
        // Log the update (don't fail the request if logging fails)
        try {
          const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
          const updateLogManager = new UpdateLogManager(sessionPath);
          const newContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          await updateLogManager.logUpdate('designs', id, oldContent, newContent);

          // Get updated change count for broadcast
          const history = await updateLogManager.getHistory('designs', id);
          const changeCount = history?.changes.length ?? 0;

          // Broadcast history update if there's history
          if (changeCount > 0) {
            wsHandler.broadcast({
              type: 'design_history_updated',
              id,
              project: params.project,
              session: params.session,
              changeCount,
            });
          }
        } catch (logError) {
          console.warn('Failed to log design update:', logError);
        }

        const clientId = req.headers.get('x-client-id') || undefined;

        wsHandler.broadcast({
          type: 'design_updated',
          id,
          content,
          sender: clientId,
          project: params.project,
          session: params.session,
        });
      }

      return response;
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/design/:id?project=...&session=...
  if (path.match(/^\/api\/design\/[^/]+$/) && !path.includes('/history') && !path.includes('/version') && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const designPath = join(params.project, '.collab', 'sessions', params.session, 'designs', `${id}.design.json`);
      const designFile = Bun.file(designPath);

      if (!await designFile.exists()) {
        return Response.json({ error: 'Design not found' }, { status: 404 });
      }

      // Delete the file
      const { unlink } = await import('fs/promises');
      await unlink(designPath);

      // Broadcast deletion
      wsHandler.broadcast({
        type: 'design_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // POST /api/design/:id/export?project=...&session=...&format=png&scale=2
  // Sends WS request to browser, browser renders and POSTs result back
  if (/^\/api\/design\/[^/]+\/export$/.test(path) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }
    const id = decodeURIComponent(path.split('/')[3]); // /api/design/{id}/export
    const format = url.searchParams.get('format') || 'png';
    const scale = parseFloat(url.searchParams.get('scale') || '2');
    const requestId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create a promise that resolves when the browser uploads the result
    const resultPromise = new Promise<{ data: Uint8Array; mimeType: string } | null>((resolve) => {
      const timeout = setTimeout(() => {
        delete (wsHandler as any).__pendingExports?.[requestId];
        resolve(null);
      }, 15000); // 15s timeout

      if (!(wsHandler as any).__pendingExports) {
        (wsHandler as any).__pendingExports = {};
      }
      (wsHandler as any).__pendingExports[requestId] = (data: Uint8Array, mimeType: string) => {
        clearTimeout(timeout);
        delete (wsHandler as any).__pendingExports[requestId];
        resolve({ data, mimeType });
      };
    });

    // Ask browser to render
    wsHandler.broadcast({
      type: 'design_export_request',
      requestId,
      designId: id,
      format,
      scale,
      project: params.project,
      session: params.session,
    } as any);

    const result = await resultPromise;
    if (!result) {
      return Response.json({ error: 'Export timed out. Is the design open in a browser?' }, { status: 408 });
    }

    return new Response(result.data, {
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${id}.${format}"`,
      },
    });
  }

  // POST /api/design-export-result/:requestId - Browser uploads rendered image
  if (path.startsWith('/api/design-export-result/') && req.method === 'POST') {
    const requestId = path.split('/').pop()!;
    const pending = (wsHandler as any).__pendingExports?.[requestId];
    if (!pending) {
      return Response.json({ error: 'No pending export for this request' }, { status: 404 });
    }

    const arrayBuffer = await req.arrayBuffer();
    const contentType = req.headers.get('content-type') || 'image/png';
    pending(new Uint8Array(arrayBuffer), contentType);
    return Response.json({ success: true });
  }

  // GET /api/render/:id?project=...&session=...
  if (path.startsWith('/api/render/') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const rawTheme = url.searchParams.get('theme') || 'default';
    // Map UI theme names to valid Mermaid theme values
    const themeMap: Record<string, string> = { light: 'default', dark: 'dark', sepia: 'neutral' };
    const theme = (themeMap[rawTheme] ?? rawTheme) as Theme;

    const { diagramManager } = await createManagers(params.project, params.session);
    const diagram = await diagramManager.getDiagram(id);
    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    try {
      const svg = await renderer.renderSVG(diagram.content, theme);
      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/thumbnail/:id?project=...&session=...
  if (path.startsWith('/api/thumbnail/') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    const { diagramManager } = await createManagers(params.project, params.session);
    const diagram = await diagramManager.getDiagram(id);
    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    try {
      const thumbnail = await renderer.generateThumbnail(id, diagram.content);
      return new Response(thumbnail, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/validate (no session required - validates syntax only)
  if (path === '/api/validate' && req.method === 'POST') {
    const { content } = await req.json() as { content?: string };
    const result = await validator.validate(content || '');
    return Response.json(result);
  }

  // GET /api/transpile/:id?project=...&session=... - Get transpiled Mermaid output for SMACH diagrams
  if (path.startsWith('/api/transpile/') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { diagramManager } = await createManagers(params.project, params.session);
    const diagram = await diagramManager.getDiagram(id);

    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    if (!isSmachYaml(diagram.content)) {
      return Response.json({ error: 'Not a SMACH diagram' }, { status: 400 });
    }

    try {
      const result = transpile(diagram.content);
      return Response.json({ mermaid: result.mermaid });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/documents?project=...&session=...
  if (path === '/api/documents' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { documentManager, metadataManager } = await createManagers(params.project, params.session);
    const documents = await documentManager.listDocuments();
    const documentsWithMeta = documents.map((d) => ({ ...d, deprecated: metadataManager.isDeprecated(d.id), pinned: metadataManager.isPinned(d.id), locked: metadataManager.isLocked(d.id), blueprint: metadataManager.isBlueprint(d.id) }));
    return Response.json({ documents: documentsWithMeta });
  }

  // GET /api/document/:id?project=...&session=...
  if (path.startsWith('/api/document/') && !path.includes('/clean') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { documentManager } = await createManagers(params.project, params.session);
    const document = await documentManager.getDocument(id);

    if (!document) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json(document);
  }

  // GET /api/document/:id/clean?project=...&session=...
  if (path.match(/^\/api\/document\/[^/]+\/clean$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/')[3];
    const { documentManager } = await createManagers(params.project, params.session);
    const content = await documentManager.getCleanContent(id);

    if (content === null) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json({ content });
  }

  // GET /api/document/:id/history?project=...&session=...
  if (path.match(/^\/api\/document\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/')[3];

    try {
      // Get session base path (parent of documents directory)
      const documentsPath = sessionRegistry.resolvePath(params.project, params.session, 'documents');
      const sessionPath = join(documentsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('documents', id);

      // Return empty history if none exists (not a 404 - the item exists, just no changes yet)
      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/document/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/document\/[^/]+\/version$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const timestamp = url.searchParams.get('timestamp');
    if (!timestamp) {
      return Response.json({ error: 'timestamp query param required' }, { status: 400 });
    }

    const id = path.split('/')[3];

    try {
      // Get session base path (parent of documents directory)
      const documentsPath = sessionRegistry.resolvePath(params.project, params.session, 'documents');
      const sessionPath = join(documentsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const content = await updateLogManager.replayToTimestamp('documents', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      // Check if it's a "no history" error
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/document?project=...&session=... (create new)
  if (path === '/api/document' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { name, content } = await req.json() as { name?: string; content?: string };

    if (!name || content === undefined) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    try {
      // Register session if not already registered
      const result = await sessionRegistry.register(params.project, params.session);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      const { documentManager } = await createManagers(params.project, params.session);
      const id = await documentManager.createDocument(name, content);

      wsHandler.broadcast({
        type: 'document_created',
        id,
        name,
        content,
        lastModified: Date.now(),
        project: params.project,
        session: params.session,
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/document/:id?project=...&session=... (update)
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { content, patch } = await req.json() as { content?: string; patch?: { oldString: string; newString: string } };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      const { documentManager, metadataManager } = await createManagers(params.project, params.session);

      // Get old content before saving (for history logging)
      const oldDocument = await documentManager.getDocument(id);
      const oldContent = oldDocument?.content ?? '';

      // Save the document
      await documentManager.saveDocument(id, content);

      // Log the update (don't fail the request if logging fails)
      try {
        // Get session base path (parent of documents directory)
        const documentsPath = sessionRegistry.resolvePath(params.project, params.session, 'documents');
        const sessionPath = join(documentsPath, '..');
        const updateLogManager = new UpdateLogManager(sessionPath);
        await updateLogManager.logUpdate('documents', id, oldContent, content, patch);

        // Get updated change count for broadcast
        const history = await updateLogManager.getHistory('documents', id);
        const changeCount = history?.changes.length ?? 0;

        // Only broadcast if there's history (content actually changed)
        if (changeCount > 0) {
          wsHandler.broadcast({
            type: 'document_history_updated',
            id,
            project: params.project,
            session: params.session,
            changeCount,
          });
        }
      } catch (logError) {
        // Log error but don't fail the request - history is supplementary
        console.warn('Failed to log document update:', logError);
      }

      // Broadcast document update (existing behavior)
      const document = await documentManager.getDocument(id);
      if (document) {
        wsHandler.broadcast({
          type: 'document_updated',
          id,
          content: document.content,
          lastModified: document.lastModified,
          project: params.project,
          session: params.session,
          ...(patch && { patch }),  // Include patch info for diff highlighting
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/document/:id?project=...&session=...
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const { documentManager } = await createManagers(params.project, params.session);
      await documentManager.deleteDocument(id);

      wsHandler.broadcast({
        type: 'document_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // ============================================
  // Spreadsheet Routes
  // ============================================

  // GET /api/spreadsheets?project=...&session=...
  if (path === '/api/spreadsheets' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { spreadsheetManager, metadataManager } = await createManagers(params.project, params.session);
    const spreadsheets = await spreadsheetManager.listSpreadsheets();
    const spreadsheetsWithMeta = spreadsheets.map((s) => ({ ...s, deprecated: metadataManager.isDeprecated(s.id), locked: metadataManager.isLocked(s.id) }));
    return Response.json({ spreadsheets: spreadsheetsWithMeta });
  }

  // GET /api/spreadsheet/:id/history?project=...&session=...
  if (path.match(/^\/api\/spreadsheet\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const spreadsheetsPath = sessionRegistry.resolvePath(params.project, params.session, 'spreadsheets');
      const sessionPath = join(spreadsheetsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('spreadsheets', id);

      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/spreadsheet/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/spreadsheet\/[^/]+\/version$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const timestamp = url.searchParams.get('timestamp');
    if (!timestamp) {
      return Response.json({ error: 'timestamp query param required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const spreadsheetsPath = sessionRegistry.resolvePath(params.project, params.session, 'spreadsheets');
      const sessionPath = join(spreadsheetsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const content = await updateLogManager.replayToTimestamp('spreadsheets', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/spreadsheet/:id?project=...&session=...
  if (path.startsWith('/api/spreadsheet/') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);
    const { spreadsheetManager } = await createManagers(params.project, params.session);
    const spreadsheet = await spreadsheetManager.getSpreadsheet(id);

    if (!spreadsheet) {
      return Response.json({ error: 'Spreadsheet not found' }, { status: 404 });
    }

    return Response.json(spreadsheet);
  }

  // POST /api/spreadsheet?project=...&session=... (create new)
  if (path === '/api/spreadsheet' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { name, content } = await req.json() as { name?: string; content?: string };

    if (!name || content === undefined) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    try {
      // Register session if not already registered
      const result = await sessionRegistry.register(params.project, params.session);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      const { spreadsheetManager } = await createManagers(params.project, params.session);
      const id = await spreadsheetManager.createSpreadsheet(name, content);

      wsHandler.broadcast({
        type: 'spreadsheet_created',
        id,
        name,
        content,
        lastModified: Date.now(),
        project: params.project,
        session: params.session,
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/spreadsheet/:id?project=...&session=... (update)
  if (path.match(/^\/api\/spreadsheet\/[^/]+$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);
    const { content } = await req.json() as { content?: string };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      const { spreadsheetManager } = await createManagers(params.project, params.session);

      // Get old content before saving (for history logging)
      const oldSpreadsheet = await spreadsheetManager.getSpreadsheet(id);
      const oldContent = oldSpreadsheet?.content ?? '';

      await spreadsheetManager.saveSpreadsheet(id, content);

      // Log the update
      try {
        const spreadsheetsPath = sessionRegistry.resolvePath(params.project, params.session, 'spreadsheets');
        const sessionPath = join(spreadsheetsPath, '..');
        const updateLogManager = new UpdateLogManager(sessionPath);
        await updateLogManager.logUpdate('spreadsheets', id, oldContent, content);
      } catch (logError) {
        console.warn('Failed to log spreadsheet update:', logError);
      }

      // Broadcast update
      const spreadsheet = await spreadsheetManager.getSpreadsheet(id);
      if (spreadsheet) {
        wsHandler.broadcast({
          type: 'spreadsheet_updated',
          id,
          content: spreadsheet.content,
          lastModified: spreadsheet.lastModified,
          project: params.project,
          session: params.session,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/spreadsheet/:id?project=...&session=...
  if (path.match(/^\/api\/spreadsheet\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);

    try {
      const { spreadsheetManager } = await createManagers(params.project, params.session);
      await spreadsheetManager.deleteSpreadsheet(id);

      wsHandler.broadcast({
        type: 'spreadsheet_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // ============================================
  // Snippets Routes
  // ============================================

  // GET /api/snippets?project=...&session=...
  if (path === '/api/snippets' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { snippetManager, metadataManager } = await createManagers(params.project, params.session);
    const snippets = await snippetManager.listSnippets();
    const meta = snippets.map(s => {
      let description: string | undefined;
      let linked: boolean | undefined;
      let filePath: string | undefined;
      let dirty: boolean | undefined;
      try {
        const parsed = JSON.parse(s.content);
        if (typeof parsed.description === 'string') description = parsed.description;
        if (parsed.linked === true) {
          linked = true;
          filePath = parsed.filePath;
          dirty = !!parsed.dirty;
        }
      } catch { /* plain-text snippet */ }
      return { id: s.id, name: s.name, ...(description !== undefined && { description }), ...(linked && { linked, filePath, dirty }), lastModified: s.lastModified, deprecated: metadataManager.isDeprecated(s.id), pinned: metadataManager.isPinned(s.id) };
    });
    return Response.json({ snippets: meta });
  }

  // GET /api/snippet/:id/history?project=...&session=...
  if (path.match(/^\/api\/snippet\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const snippetsPath = sessionRegistry.resolvePath(params.project, params.session, 'snippets');
      const sessionPath = join(snippetsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('snippets', id);

      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/snippet/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/snippet\/[^/]+\/version$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const timestamp = url.searchParams.get('timestamp');
    if (!timestamp) {
      return Response.json({ error: 'timestamp query param required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/')[3]);

    try {
      const snippetsPath = sessionRegistry.resolvePath(params.project, params.session, 'snippets');
      const sessionPath = join(snippetsPath, '..');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const content = await updateLogManager.replayToTimestamp('snippets', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/snippet/:id?project=...&session=...
  if (path.startsWith('/api/snippet/') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);
    const { snippetManager } = await createManagers(params.project, params.session);
    const snippet = await snippetManager.getSnippet(id);

    if (!snippet) {
      return Response.json({ error: 'Snippet not found' }, { status: 404 });
    }

    return Response.json(snippet);
  }

  // POST /api/snippet?project=...&session=... (create new)
  if (path === '/api/snippet' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { name, content } = await req.json() as { name?: string; content?: string };

    if (!name || content === undefined) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    try {
      // Register session if not already registered
      const result = await sessionRegistry.register(params.project, params.session);
      if (result.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      const { snippetManager } = await createManagers(params.project, params.session);
      const id = await snippetManager.createSnippet(name, content);

      wsHandler.broadcast({
        type: 'snippet_created',
        id,
        name,
        content,
        lastModified: Date.now(),
        project: params.project,
        session: params.session,
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/snippet/:id?project=...&session=... (update - deprecated, use PUT)
  if (path.match(/^\/api\/snippet\/[^/]+$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);
    const { content } = await req.json() as { content?: string };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      const { snippetManager } = await createManagers(params.project, params.session);

      // Get old content before saving (for history logging)
      const oldSnippet = await snippetManager.getSnippet(id);
      const oldContent = oldSnippet?.content ?? '';

      await snippetManager.saveSnippet(id, content);

      // Log the update
      try {
        const snippetsPath = sessionRegistry.resolvePath(params.project, params.session, 'snippets');
        const sessionPath = join(snippetsPath, '..');
        const updateLogManager = new UpdateLogManager(sessionPath);
        await updateLogManager.logUpdate('snippets', id, oldContent, content);
      } catch (logError) {
        console.warn('Failed to log snippet update:', logError);
      }

      // Broadcast update
      const snippet = await snippetManager.getSnippet(id);
      if (snippet) {
        wsHandler.broadcast({
          type: 'snippet_updated',
          id,
          content: snippet.content,
          lastModified: snippet.lastModified,
          project: params.project,
          session: params.session,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // PUT /api/snippet/:id?project=...&session=... (update)
  if (path.match(/^\/api\/snippet\/[^/]+$/) && req.method === 'PUT') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);
    const { content } = await req.json() as { content?: string };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      const { snippetManager } = await createManagers(params.project, params.session);

      // Get old content before saving (for history logging)
      const oldSnippet = await snippetManager.getSnippet(id);
      const oldContent = oldSnippet?.content ?? '';

      await snippetManager.saveSnippet(id, content);

      // Log the update
      try {
        const snippetsPath = sessionRegistry.resolvePath(params.project, params.session, 'snippets');
        const sessionPath = join(snippetsPath, '..');
        const updateLogManager = new UpdateLogManager(sessionPath);
        await updateLogManager.logUpdate('snippets', id, oldContent, content);
      } catch (logError) {
        console.warn('Failed to log snippet update:', logError);
      }

      // Broadcast update
      const snippet = await snippetManager.getSnippet(id);
      if (snippet) {
        wsHandler.broadcast({
          type: 'snippet_updated',
          id,
          content: snippet.content,
          lastModified: snippet.lastModified,
          project: params.project,
          session: params.session,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/snippet/:id?project=...&session=...
  if (path.match(/^\/api\/snippet\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);

    try {
      const { snippetManager } = await createManagers(params.project, params.session);
      await snippetManager.deleteSnippet(id);

      wsHandler.broadcast({
        type: 'snippet_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }


  // ============================================
  // Embed Routes
  // ============================================

  // POST /api/embed?project=...&session=...
  if (path === '/api/embed' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { name, url: embedUrl, subtype, width, height, storybook } = await req.json() as {
      name?: string;
      url?: string;
      subtype?: 'storybook';
      width?: string;
      height?: string;
      storybook?: { storyId: string; port: number };
    };

    if (!name || !embedUrl) {
      return Response.json({ error: 'Name and url required' }, { status: 400 });
    }

    try {
      const { embedManager } = await createManagers(params.project, params.session);
      const embed = await embedManager.create({ name, url: embedUrl, subtype, width, height, storybook });

      wsHandler.broadcast({
        type: 'embed_created',
        id: embed.id,
        name,
        url: embedUrl,
        subtype,
        width,
        height,
        storybook,
        createdAt: embed.createdAt,
        project: params.project,
        session: params.session,
      });

      return Response.json({ id: embed.id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/embeds?project=...&session=...
  if (path === '/api/embeds' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { embedManager } = await createManagers(params.project, params.session);
      const embeds = await embedManager.list();
      return Response.json({ embeds });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // DELETE /api/embed/:id?project=...&session=...
  if (path.match(/^\/api\/embed\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = decodeURIComponent(path.split('/').pop()!);

    try {
      const { embedManager } = await createManagers(params.project, params.session);
      await embedManager.delete(id);

      wsHandler.broadcast({
        type: 'embed_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // ============================================
  // Image Routes
  // ============================================

  // GET /api/image/:id/content — stream binary
  if (path.match(/^\/api\/image\/[^/]+\/content$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    const segments = path.split('/');
    const id = decodeURIComponent(segments[segments.length - 2]);
    try {
      const { imageManager } = await createManagers(params.project, params.session);
      const content = await imageManager.getContent(id);
      if (!content) return Response.json({ error: 'Image not found' }, { status: 404 });
      return new Response(content.buffer, {
        headers: {
          'Content-Type': content.mimeType,
          'Content-Length': String(content.buffer.length),
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/image/:id — metadata
  if (path.match(/^\/api\/image\/[^/]+$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    const id = decodeURIComponent(path.split('/').pop()!);
    try {
      const { imageManager } = await createManagers(params.project, params.session);
      const image = await imageManager.get(id);
      if (!image) return Response.json({ error: 'Image not found' }, { status: 404 });
      return Response.json(image);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // DELETE /api/image/:id
  if (path.match(/^\/api\/image\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    const id = decodeURIComponent(path.split('/').pop()!);
    try {
      const { imageManager } = await createManagers(params.project, params.session);
      await imageManager.delete(id);
      wsHandler.broadcast({
        type: 'image_deleted',
        id,
        project: params.project,
        session: params.session,
      });
      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // POST /api/image — accepts multipart OR JSON { name, source }
  if (path === '/api/image' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });

    try {
      const contentType = req.headers.get('content-type') || '';
      let name: string;
      let buffer: Buffer;
      let mimeType: string;

      if (contentType.startsWith('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) return Response.json({ error: 'file field required' }, { status: 400 });
        name = (form.get('name') as string) || file.name;
        buffer = Buffer.from(await file.arrayBuffer());
        mimeType = file.type || 'application/octet-stream';
      } else {
        const body = await req.json() as { name?: string; source?: string };
        if (!body.name || !body.source) return Response.json({ error: 'name and source required' }, { status: 400 });
        const loaded = await loadImageSourceToBuffer(body.source);
        name = body.name;
        buffer = loaded.buffer;
        mimeType = loaded.mimeType;
      }

      const { imageManager } = await createManagers(params.project, params.session);
      const image = await imageManager.create({ name, buffer, mimeType });

      wsHandler.broadcast({
        type: 'image_created',
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        size: image.size,
        uploadedAt: image.uploadedAt,
        project: params.project,
        session: params.session,
      });

      return Response.json({ ...image, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/project-style — read the session's cohesive-look style (palette + prompt fragment).
  if (path === '/api/project-style' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    const style = await loadProjectStyle(params.project, params.session);
    return Response.json({ style: style ?? null });
  }

  // POST /api/project-style — set the session's cohesive-look style. Body: { palette?, stylePromptFragment? }.
  if (path === '/api/project-style' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as ProjectStyle;
      const saved = await saveProjectStyle(params.project, params.session, body);
      return Response.json({ success: true, style: saved });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/generate-image — generate via Grok Imagine (xAI) and save as a session image
  if (path === '/api/generate-image' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });

    try {
      const body = await req.json() as {
        prompt?: string; name?: string; task?: ImageTask; model?: string;
        n?: number; aspectRatio?: string; resolution?: '1k' | '2k';
      };
      if (!body.prompt) return Response.json({ error: 'prompt required' }, { status: 400 });

      // T1: project style — same palette + aesthetic across every generated asset.
      const style = await loadProjectStyle(params.project, params.session);

      const n = Math.max(1, Math.min(4, body.n ?? 1));
      const finalPrompt = applyStyleToPrompt(applyTaskPreset(body.prompt, body.task), style);
      const result = await xaiProvider.generate(finalPrompt, {
        task: body.task, model: body.model, n,
        aspectRatio: body.aspectRatio, resolution: body.resolution,
        outDir: '', basename: '', // unused by the provider (it returns bytes/url)
      });

      const baseName = (body.name || body.prompt.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'generated');
      const { imageManager } = await createManagers(params.project, params.session);
      const saved: Array<{ id: string; name: string; mimeType: string; size: number }> = [];

      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        let buffer: Buffer;
        if (img.bytes) {
          buffer = Buffer.from(img.bytes);
        } else if (img.url) {
          const dl = await fetch(img.url);
          if (!dl.ok) throw new Error(`failed to download generated image: ${dl.status}`);
          buffer = Buffer.from(await dl.arrayBuffer());
        } else {
          continue;
        }
        // T1: snap to the project palette so this asset matches the rest of the set.
        let mimeType = img.mimeType;
        let ext = img.mimeType.includes('png') ? 'png' : 'jpg';
        if (style?.palette?.length) {
          const { quantizeBuffer } = await loadSpritePipeline();
          buffer = await quantizeBuffer(buffer, style.palette);
          mimeType = 'image/png';
          ext = 'png';
        }
        const name = result.images.length > 1 ? `${baseName}-${i + 1}.${ext}` : `${baseName}.${ext}`;
        const image = await imageManager.create({ name, buffer, mimeType });
        wsHandler.broadcast({
          type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType,
          size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session,
        });
        saved.push({ id: image.id, name: image.name, mimeType: image.mimeType, size: image.size });
      }

      return Response.json({ success: true, images: saved, costUsd: result.costUsd, model: result.model, finalPrompt });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/generate-sprite — generate a sprite sheet from a Grok Imagine VIDEO.
  // mode 'animation' = action loop (e.g. attack/idle); mode 'rotation' = turntable strip.
  // Seed: provide a chroma-keyed seed image via seedImageId | seedSource | seedPrompt.
  if (path === '/api/generate-sprite' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });

    try {
      const body = await req.json() as {
        mode?: 'animation' | 'rotation'; name?: string; prompt?: string;
        seedImageId?: string; seedSource?: string; seedPrompt?: string;
        model?: string; frames?: number; fps?: number; columns?: number;
        keyColor?: string; tolerance?: number; pixelHeight?: number;
        padding?: number; powerOfTwo?: boolean; trim?: boolean;
        exportFormat?: string | string[]; exportFormats?: string | string[];
      };
      const mode = body.mode === 'rotation' ? 'rotation' : 'animation';
      if (!(await hasFfmpeg())) {
        return Response.json({ error: 'ffmpeg not available on the server — required for video frame extraction. Install ffmpeg or bundle it with the sidecar.' }, { status: 501 });
      }
      if (mode === 'animation' && !body.prompt) {
        return Response.json({ error: "prompt required for mode 'animation' (the action to animate)" }, { status: 400 });
      }
      const { removeBackground, downscale, packSheet, normalizeExportFormats } = await loadSpritePipeline();

      const { imageManager } = await createManagers(params.project, params.session);

      // T1: project style — same palette + aesthetic across every generated asset.
      const style = await loadProjectStyle(params.project, params.session);

      // 1. resolve the seed image bytes (must already be on a solid chroma background)
      let seedBuf: Buffer; let seedMime: string;
      if (body.seedImageId) {
        const c = await imageManager.getContent(body.seedImageId);
        if (!c) return Response.json({ error: `seedImageId not found: ${body.seedImageId}` }, { status: 404 });
        seedBuf = c.buffer; seedMime = c.mimeType;
      } else if (body.seedSource) {
        const loaded = await loadImageSourceToBuffer(body.seedSource);
        seedBuf = loaded.buffer; seedMime = loaded.mimeType;
      } else if (body.seedPrompt) {
        const gen = await xaiProvider.generate(applyStyleToPrompt(applyTaskPreset(body.seedPrompt, 'sprite'), style), { n: 1, resolution: '2k', outDir: '', basename: '' });
        const g0 = gen.images[0];
        if (g0.bytes) { seedBuf = Buffer.from(g0.bytes); }
        else { const dl = await fetch(g0.url!); seedBuf = Buffer.from(await dl.arrayBuffer()); }
        seedMime = g0.mimeType;
      } else {
        return Response.json({ error: 'one of seedImageId | seedSource | seedPrompt is required' }, { status: 400 });
      }
      const seedImageUrl = `data:${seedMime};base64,${seedBuf.toString('base64')}`;

      // 2. video prompt: turntable for rotation, the action for animation
      const videoPrompt = mode === 'rotation'
        ? `turntable character rotation: the camera smoothly orbits a full 360 degrees around the character while it stays completely frozen, ZERO body movement, only the camera rotates to reveal front/side/back/other side. plain solid background, no ground, consistent character.${body.prompt ? ' ' + body.prompt : ''}`
        : body.prompt!;

      const video = await generateVideo(videoPrompt, { model: body.model, seedImageUrl });

      // 3. frames -> chroma key -> downscale
      const frameCount = Math.max(2, Math.min(64, body.frames ?? (mode === 'rotation' ? 24 : 12)));
      const rawFrames = await extractFrames(video.bytes, { count: frameCount });
      const keyColor = body.keyColor ?? '#00b140';
      const tolerance = body.tolerance ?? 100;
      const pixelHeight = body.pixelHeight ?? 128;
      const sprites: Buffer[] = [];
      for (const f of rawFrames) {
        const keyed = await removeBackground(f, { keyColor, tolerance });
        // T1: snap every frame to the project palette so the whole sheet is cohesive.
        sprites.push(await downscale(keyed, { pixelHeight, palette: style?.palette }));
      }

      // 4. pack sheet (temp) -> read back -> save as a session image
      const tmp = await fsMkdtemp(join(osTmpdir(), 'spritesheet-'));
      const exportFormats = normalizeExportFormats(body.exportFormats ?? body.exportFormat);
      // Animation mode is one looping clip; rotation frames are facings, not a timeline.
      const spriteFps = body.fps ?? (mode === 'rotation' ? 0 : 12);
      const animations = mode === 'animation'
        ? [{ name: (body.prompt || 'animation').slice(0, 40), from: 0, to: sprites.length - 1, direction: 'forward' as const, repeat: 0 }]
        : [];
      let atlasBuf: Buffer; let manifest: any; let exports: any;
      try {
        const out = join(tmp, 'sheet.png');
        const packed = await packSheet(sprites, {
          columns: body.columns, fps: spriteFps, outPath: out,
          padding: body.padding, powerOfTwo: body.powerOfTwo, trim: body.trim,
          animations, exportFormats,
        });
        atlasBuf = await fsReadFile(packed.atlasPath);
        manifest = packed.manifest;
        exports = Object.fromEntries(Object.entries(packed.exports).map(([k, v]) => [k, (v as any).content]));
      } finally {
        await fsRm(tmp, { recursive: true, force: true }).catch(() => {});
      }

      const baseName = (body.name || (mode === 'rotation' ? 'rotation' : (body.prompt || 'animation').slice(0, 40)))
        .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sprite';
      const sheetName = `${baseName}-${mode === 'rotation' ? 'turntable' : 'anim'}-sheet.png`;
      const image = await imageManager.create({ name: sheetName, buffer: atlasBuf, mimeType: 'image/png' });
      wsHandler.broadcast({
        type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType,
        size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session,
      });

      return Response.json({
        success: true, mode, sheet: { id: image.id, name: image.name, size: image.size },
        manifest, exports, frameCount: sprites.length, costUsd: video.costUsd, model: video.model,
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/generate-sprite-sheet — spec-driven directional animation sheet.
  // Pipeline (validated 2026-06-14): generate a grid of N frozen animation poses on
  // per-figure marker pedestals → orbit it (one clip rotates every cell in place) →
  // extract Y angle frames → multi-key (chroma + marker) → slice grid → autocrop+recenter
  // → pack [angles × poses] sheet. ~1 image + 1 video regardless of N.
  if (path === '/api/generate-sprite-sheet' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        character?: string; animation?: string; name?: string;
        seedImageId?: string; seedSource?: string;
        frames?: number; angles?: number; fps?: number;
        cellWidth?: number; cellHeight?: number;
        keyColor?: string; markerColor?: string; model?: string;
        padding?: number; powerOfTwo?: boolean; trim?: boolean;
        exportFormat?: string | string[]; exportFormats?: string | string[];
      };
      if (!body.character || !body.animation) {
        return Response.json({ error: 'character and animation are required' }, { status: 400 });
      }
      if (!(await hasFfmpeg())) {
        return Response.json({ error: 'ffmpeg not available on the server — required for video frame extraction.' }, { status: 501 });
      }
      const { removeBackground, packSheet, sliceGrid, autocropRecenter, pickMarkerColor, normalizeExportFormats, quantizeBuffer } = await loadSpritePipeline();

      // T3: budget guard — block before spending if a cap would be exceeded.
      const estSheet = estimateCost('sprite_sheet').usd;
      const guard = await wouldExceedBudget(params.project, params.session, estSheet);
      if (guard.blocked) return Response.json({ error: guard.reason, spend: guard.spend }, { status: 402 });

      // T1: project style — same palette + aesthetic across every generated asset.
      const style = await loadProjectStyle(params.project, params.session);

      const frames = Math.max(2, Math.min(8, body.frames ?? 6));      // poses; >8 clones poses
      const angles = Math.max(2, Math.min(16, body.angles ?? 8));     // facings sampled from the orbit
      const cols = Math.min(6, frames);                                // ≤6 per row keeps detail + gaps
      const rows = Math.ceil(frames / cols);
      const keyColor = body.keyColor ?? '#00b140';
      const cellW = body.cellWidth ?? 96, cellH = body.cellHeight ?? 128;

      const { imageManager } = await createManagers(params.project, params.session);

      // 0. optional character reference (img2img) — locks a specific character
      let referenceImage: string | undefined;
      let refBuf: Buffer | undefined;
      if (body.seedImageId) {
        const c = await imageManager.getContent(body.seedImageId);
        if (!c) return Response.json({ error: `seedImageId not found: ${body.seedImageId}` }, { status: 404 });
        refBuf = c.buffer;
        referenceImage = `data:${c.mimeType};base64,${c.buffer.toString('base64')}`;
      } else if (body.seedSource) {
        const loaded = await loadImageSourceToBuffer(body.seedSource);
        refBuf = loaded.buffer;
        referenceImage = `data:${loaded.mimeType};base64,${loaded.buffer.toString('base64')}`;
      }

      // marker/pedestal color: explicit > auto-pick from the reference char > cyan default
      let marker = { name: 'cyan', hex: body.markerColor ?? '#00ecf8' };
      if (!body.markerColor && refBuf) marker = await pickMarkerColor(refBuf);
      const markerColor = marker.hex;

      // 1. seed grid image (structured prompt — the validated recipe)
      const gridDesc = rows > 1 ? `${rows} rows and ${cols} columns` : `a single row of ${cols}`;
      const seedPrompt = `a 2D game sprite sheet: ${gridDesc} of identical ${body.character} figures (${frames} total), evenly spaced with WIDE empty gaps between every figure, each figure standing on its OWN small round solid ${marker.name} turntable pedestal disc, each figure a different sequential frame of ${body.animation} (a seamless loop where the last frame leads back into the first), all identical size on a common baseline, NO text NO labels NO numbers NO grid lines, flat solid chroma green background #00b140, the only ${marker.name} is the pedestals and the only green is the background`;
      const seedGen = await xaiProvider.generate(applyStyleToPrompt(seedPrompt, style), { resolution: '2k', outDir: '', basename: '', referenceImage });
      const sImg = seedGen.images[0];
      let seedBuf: Buffer;
      if (sImg.bytes) seedBuf = Buffer.from(sImg.bytes);
      else { const dl = await fetch(sImg.url!); seedBuf = Buffer.from(await dl.arrayBuffer()); }
      const seedUrl = `data:${sImg.mimeType};base64,${seedBuf.toString('base64')}`;

      // 2. orbit the grid (turntable framing — figures stay frozen + in place)
      const orbitPrompt = `${frames} frozen plastic action figures of ${body.character}, arranged in ${gridDesc}, each standing on its OWN small round motorized turntable pedestal. Every pedestal spins slowly in place, rotating the figure on it around that pedestal's own center, so each figure pivots in its exact spot and never leaves its cell. All turntables turn together through one full 360 degree revolution showing each figure from front, side, back, other side. The figures are solid statues: poses NEVER change, nothing animates, only the pedestals rotate. Figures stay evenly spaced in fixed positions. Flat solid green background.`;
      const video = await generateVideo(orbitPrompt, { model: body.model, seedImageUrl: seedUrl });

      // 3. extract Y angle frames; 4. per angle → key → slice → recenter
      const angleFrames = await extractFrames(video.bytes, { count: angles });
      const cells: Buffer[] = [];
      for (const af of angleFrames) {
        const keyed = await removeBackground(af, { keyColor, keyColors: [markerColor, '#3cc6e6'], tolerance: 110 });
        const sliced = await sliceGrid(keyed, rows, cols);
        for (let p = 0; p < frames; p++) {
          let cell = await autocropRecenter(sliced[p] ?? sliced[sliced.length - 1], cellW, cellH);
          // T1: snap each cell to the project palette for a cohesive cross-asset look.
          if (style?.palette?.length) cell = await quantizeBuffer(cell, style.palette);
          cells.push(cell);
        }
      }

      // 5. pack [angles × poses] and save
      const tmp = await fsMkdtemp(join(osTmpdir(), 'spritesheet-'));
      const exportFormats = normalizeExportFormats(body.exportFormats ?? body.exportFormat);
      // Each angle row is one looping animation for that facing (e.g. walk_a0, walk_a1, ...).
      const animBase = (body.animation || 'anim').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'anim';
      const sheetAnimations = Array.from({ length: angles }, (_, a) => ({
        name: `${animBase}_a${a}`, from: a * frames, to: a * frames + frames - 1,
        direction: 'forward' as const, repeat: 0,
      }));
      let atlasBuf: Buffer; let manifest: any; let exports: any;
      try {
        const out = join(tmp, 'sheet.png');
        const packed = await packSheet(cells, {
          columns: frames, fps: body.fps ?? 12, outPath: out,
          padding: body.padding, powerOfTwo: body.powerOfTwo, trim: body.trim,
          animations: sheetAnimations, exportFormats,
        });
        atlasBuf = await fsReadFile(packed.atlasPath);
        manifest = { ...packed.manifest, frames, angles, rows: angles, cols: frames };
        exports = Object.fromEntries(Object.entries(packed.exports).map(([k, v]) => [k, (v as any).content]));
      } finally { await fsRm(tmp, { recursive: true, force: true }).catch(() => {}); }

      const baseName = (body.name || body.character).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sprite';
      const image = await imageManager.create({ name: `${baseName}-sheet.png`, buffer: atlasBuf, mimeType: 'image/png' });
      wsHandler.broadcast({
        type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType,
        size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session,
      });

      const sheetCost = video.costUsd + seedGen.costUsd;
      const spendAfter = await recordSpend(params.project, params.session, sheetCost, 'sprite_sheet').catch(() => null);
      return Response.json({
        success: true, sheet: { id: image.id, name: image.name, size: image.size },
        manifest, exports, frames, angles, cellCount: cells.length, costUsd: sheetCost, model: video.model,
        sessionSpendUsd: spendAfter?.totalUsd,
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/characters — list defined characters
  if (path === '/api/characters' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      return Response.json({ characters: await listCharacters(params.project, params.session) });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/character — define a reusable character. If no referenceImageId is given
  // but a description is, generate a canonical reference image and lock it in.
  if (path === '/api/character' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as CharacterDef & { generateReference?: boolean };
      if (!body.name) return Response.json({ error: 'name required' }, { status: 400 });
      const def: CharacterDef = {
        name: body.name, description: body.description,
        referenceImageId: body.referenceImageId, palette: body.palette,
        stylePromptFragment: body.stylePromptFragment,
      };
      // Generate a canonical reference (front, neutral, chroma bg) when none provided.
      if (!def.referenceImageId && def.description && body.generateReference !== false) {
        const style = await loadProjectStyle(params.project, params.session);
        const refPrompt = applyStyleToPrompt(
          `${def.description}, full body, standing in a neutral T-pose facing forward, centered, character reference sheet, flat solid chroma green background #00b140, no ground no shadow`,
          style,
        );
        const gen = await xaiProvider.generate(refPrompt, { resolution: '2k', outDir: '', basename: '' });
        const g0 = gen.images[0];
        let buf: Buffer;
        if (g0.bytes) buf = Buffer.from(g0.bytes);
        else { const dl = await fetch(g0.url!); buf = Buffer.from(await dl.arrayBuffer()); }
        const { imageManager } = await createManagers(params.project, params.session);
        const img = await imageManager.create({ name: `${characterSlug(def.name)}-reference.${g0.mimeType.includes('png') ? 'png' : 'jpg'}`, buffer: buf, mimeType: g0.mimeType });
        wsHandler.broadcast({ type: 'image_created', id: img.id, name: img.name, mimeType: img.mimeType, size: img.size, uploadedAt: img.uploadedAt, project: params.project, session: params.session });
        def.referenceImageId = img.id;
      }
      const saved = await saveCharacter(params.project, params.session, def);
      return Response.json({ success: true, character: saved });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-character-animations — batch a character's full animation SET.
  // For each resolved action, generate a directional sprite sheet locked to the
  // character's reference (consistent identity) via the /api/generate-sprite-sheet pipeline.
  if (path === '/api/generate-character-animations' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        character?: string; actions?: string[]; preset?: string;
        frames?: number; angles?: number; fps?: number; exportFormat?: string | string[]; model?: string;
      };
      if (!body.character) return Response.json({ error: 'character (name) required' }, { status: 400 });
      const char = await loadCharacter(params.project, params.session, body.character);
      if (!char) return Response.json({ error: `character not found: ${body.character}` }, { status: 404 });
      const actions = resolveActions(body.actions, body.preset);
      if (!actions.length) return Response.json({ error: 'no actions — pass actions[] and/or a known preset (fighter/platformer/topdown)' }, { status: 400 });

      const port = process.env.PORT || '9002';
      const host = process.env.HOST || 'localhost';
      const base = `http://${host}:${port}/api/generate-sprite-sheet?project=${encodeURIComponent(params.project)}&session=${encodeURIComponent(params.session)}`;
      const slug = characterSlug(char.name);
      const sheets: any[] = []; let totalCost = 0;
      for (const action of actions) {
        const r = await fetch(base, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: char.description || char.name, animation: action,
            seedImageId: char.referenceImageId, name: `${slug}-${action}`,
            frames: body.frames, angles: body.angles, fps: body.fps,
            exportFormat: body.exportFormat, model: body.model,
          }),
        });
        const j = await r.json() as any;
        if (!r.ok) { sheets.push({ action, error: j.error || r.statusText }); continue; }
        totalCost += j.costUsd ?? 0;
        sheets.push({ action, sheet: j.sheet, frames: j.frames, angles: j.angles, costUsd: j.costUsd });
      }
      return Response.json({ success: true, character: char.name, referenceImageId: char.referenceImageId, actions, sheets, totalCostUsd: totalCost });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-vfx — an effect animation sheet (sparks/explosion/smoke/ice-spray).
  // Single-facing; keyed by chroma OR luminance (glow). prompt → video → frames → key → pack.
  if (path === '/api/generate-vfx' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        prompt?: string; name?: string; frames?: number; fps?: number; columns?: number;
        keyMode?: 'chroma' | 'luminance'; keyColor?: string; tolerance?: number;
        pixelHeight?: number; model?: string; exportFormat?: string | string[]; loop?: boolean;
      };
      if (!body.prompt) return Response.json({ error: 'prompt required' }, { status: 400 });
      if (!(await hasFfmpeg())) return Response.json({ error: 'ffmpeg not available on the server' }, { status: 501 });
      const { removeBackground, alphaFromLuminance, downscale, packSheet, normalizeExportFormats, quantizeBuffer } = await loadSpritePipeline();
      const style = await loadProjectStyle(params.project, params.session);

      const keyMode = body.keyMode === 'luminance' ? 'luminance' : 'chroma';
      const bg = keyMode === 'luminance' ? 'pure flat solid black background #000000' : `flat solid chroma green background #00b140`;
      const vfxPrompt = applyStyleToPrompt(`${body.prompt}, a ${body.loop === false ? 'one-shot' : 'seamlessly looping'} 2D game visual effect animation, the effect centered, ${bg}, no characters no scenery just the effect`, style);
      // VFX is text-driven; generate a seed still first (the video model needs an image seed).
      const seedGen = await xaiProvider.generate(vfxPrompt, { resolution: '2k', outDir: '', basename: '' });
      const s0 = seedGen.images[0];
      const seedBuf = s0.bytes ? Buffer.from(s0.bytes) : Buffer.from(await (await fetch(s0.url!)).arrayBuffer());
      const seedUrl = `data:${s0.mimeType};base64,${seedBuf.toString('base64')}`;
      const vid = await generateVideo(`${body.prompt}, the effect animates and ${body.loop === false ? 'plays once' : 'loops seamlessly'}, ${bg}, only the effect moves`, { model: body.model, seedImageUrl: seedUrl });

      const frameCount = Math.max(2, Math.min(32, body.frames ?? 8));
      const raw = await extractFrames(vid.bytes, { count: frameCount });
      const pixelHeight = body.pixelHeight ?? 128;
      const cells: Buffer[] = [];
      for (const f of raw) {
        let c = keyMode === 'luminance'
          ? await alphaFromLuminance(f, {})
          : await removeBackground(f, { keyColor: body.keyColor ?? '#00b140', tolerance: body.tolerance ?? 100 });
        c = await downscale(c, { pixelHeight });
        if (style?.palette?.length && keyMode !== 'luminance') c = await quantizeBuffer(c, style.palette);
        cells.push(c);
      }
      const tmp = await fsMkdtemp(join(osTmpdir(), 'vfx-'));
      let atlasBuf: Buffer; let manifest: any; let exports: any;
      try {
        const out = join(tmp, 'vfx.png');
        const packed = await packSheet(cells, { columns: body.columns, fps: body.fps ?? 16, outPath: out, exportFormats: normalizeExportFormats(body.exportFormat), animations: [{ name: 'effect', from: 0, to: cells.length - 1, direction: 'forward', repeat: body.loop === false ? 1 : 0 }] });
        atlasBuf = await fsReadFile(packed.atlasPath); manifest = packed.manifest;
        exports = Object.fromEntries(Object.entries(packed.exports).map(([k, v]: any) => [k, v.content]));
      } finally { await fsRm(tmp, { recursive: true, force: true }).catch(() => {}); }

      const baseName = (body.name || body.prompt.slice(0, 40)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'vfx';
      const { imageManager } = await createManagers(params.project, params.session);
      const image = await imageManager.create({ name: `${baseName}-vfx-sheet.png`, buffer: atlasBuf, mimeType: 'image/png' });
      wsHandler.broadcast({ type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session });
      const vfxCost = (vid.costUsd ?? 0) + (seedGen.costUsd ?? 0);
      const vfxSpend = await recordSpend(params.project, params.session, vfxCost, 'vfx').catch(() => null);
      return Response.json({ success: true, sheet: { id: image.id, name: image.name, size: image.size }, manifest, exports, frameCount: cells.length, keyMode, costUsd: vfxCost, model: vid.model, sessionSpendUsd: vfxSpend?.totalUsd });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-prop — a single transparent asset (item/icon/prop), chroma-keyed + trimmed + palette.
  if (path === '/api/generate-prop' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        prompt?: string; name?: string; task?: ImageTask; pixelHeight?: number;
        keyColor?: string; tolerance?: number; transparent?: boolean; model?: string;
      };
      if (!body.prompt) return Response.json({ error: 'prompt required' }, { status: 400 });
      const { removeBackground, downscale, quantizeBuffer } = await loadSpritePipeline();
      const style = await loadProjectStyle(params.project, params.session);
      const keyColor = body.keyColor ?? '#00b140';
      const wantTransparent = body.transparent !== false;
      const finalPrompt = applyStyleToPrompt(
        applyTaskPreset(`${body.prompt}, single game ${body.task ?? 'prop'}, centered${wantTransparent ? `, flat solid chroma ${keyColor} background, the only ${keyColor} is the background` : ''}`, body.task),
        style,
      );
      const gen = await xaiProvider.generate(finalPrompt, { model: body.model, resolution: '2k', outDir: '', basename: '' });
      const g0 = gen.images[0];
      let buf: Buffer = g0.bytes ? Buffer.from(g0.bytes) : Buffer.from(await (await fetch(g0.url!)).arrayBuffer());
      if (wantTransparent) buf = await removeBackground(buf, { keyColor, tolerance: body.tolerance ?? 100 });
      if (body.pixelHeight) buf = await downscale(buf, { pixelHeight: body.pixelHeight });
      if (style?.palette?.length) buf = await quantizeBuffer(buf, style.palette);

      const baseName = (body.name || body.prompt.slice(0, 40)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'prop';
      const { imageManager } = await createManagers(params.project, params.session);
      const image = await imageManager.create({ name: `${baseName}.png`, buffer: buf, mimeType: 'image/png' });
      wsHandler.broadcast({ type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session });
      return Response.json({ success: true, image: { id: image.id, name: image.name, size: image.size }, transparent: wantTransparent, costUsd: gen.costUsd, model: gen.model });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-tileset — N seamlessly-tileable terrain/wall tiles packed into a tilesheet.
  if (path === '/api/generate-tileset' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        prompt?: string; tiles?: string[]; tileSize?: number; columns?: number; name?: string;
        heal?: boolean; model?: string;
      };
      const tileDescs = (body.tiles && body.tiles.length) ? body.tiles : (body.prompt ? [body.prompt] : []);
      if (!tileDescs.length) return Response.json({ error: 'provide prompt or tiles[]' }, { status: 400 });
      const { downscale, packSheet, quantizeBuffer, makeSeamless } = await loadSpritePipeline();
      const style = await loadProjectStyle(params.project, params.session);
      const tileSize = body.tileSize ?? 32;

      const cells: Buffer[] = []; let cost = 0;
      for (const desc of tileDescs) {
        const p = applyStyleToPrompt(`${desc}, a seamless tileable game terrain texture tile, edges wrap continuously on all sides, top-down, no border, fills the frame, square`, style);
        const gen = await xaiProvider.generate(p, { model: body.model, resolution: '2k', outDir: '', basename: '' });
        cost += gen.costUsd ?? 0;
        const g0 = gen.images[0];
        let buf: Buffer = g0.bytes ? Buffer.from(g0.bytes) : Buffer.from(await (await fetch(g0.url!)).arrayBuffer());
        if (body.heal !== false) buf = await makeSeamless(buf, { axis: 'both' });
        buf = await downscale(buf, { pixelHeight: tileSize });
        if (style?.palette?.length) buf = await quantizeBuffer(buf, style.palette);
        cells.push(buf);
      }
      const tmp = await fsMkdtemp(join(osTmpdir(), 'tileset-'));
      let atlasBuf: Buffer; let manifest: any;
      try {
        const out = join(tmp, 'tileset.png');
        const packed = await packSheet(cells, { columns: body.columns ?? Math.min(8, cells.length), fps: 0, outPath: out });
        atlasBuf = await fsReadFile(packed.atlasPath);
        manifest = { tilewidth: packed.manifest.frameWidth, tileheight: packed.manifest.frameHeight, columns: packed.manifest.columns, tilecount: packed.manifest.count, atlasWidth: packed.manifest.atlasWidth, atlasHeight: packed.manifest.atlasHeight, image: packed.manifest.image, tiles: packed.manifest.frames };
      } finally { await fsRm(tmp, { recursive: true, force: true }).catch(() => {}); }

      const baseName = (body.name || tileDescs[0].slice(0, 32)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'tileset';
      const { imageManager } = await createManagers(params.project, params.session);
      const image = await imageManager.create({ name: `${baseName}-tileset.png`, buffer: atlasBuf, mimeType: 'image/png' });
      wsHandler.broadcast({ type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session });
      return Response.json({ success: true, tileset: { id: image.id, name: image.name, size: image.size }, manifest, tileCount: cells.length, costUsd: cost });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-background — a scene background; optional horizontal-tileable (scroll)
  // and optional parallax layers (each a transparent layer generated separately).
  if (path === '/api/generate-background' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as {
        prompt?: string; name?: string; aspectRatio?: string; tileableX?: boolean;
        layers?: string[]; keyColor?: string; pixelHeight?: number; model?: string;
      };
      if (!body.prompt) return Response.json({ error: 'prompt required' }, { status: 400 });
      const { removeBackground, downscale, quantizeBuffer, makeSeamless } = await loadSpritePipeline();
      const style = await loadProjectStyle(params.project, params.session);
      const { imageManager } = await createManagers(params.project, params.session);
      const keyColor = body.keyColor ?? '#00b140';
      const aspect = body.aspectRatio ?? '16:9';

      const outs: any[] = []; let cost = 0;
      // base scene (opaque) + optional transparent parallax layers
      const layerSpecs: Array<{ desc: string; transparent: boolean; tag: string }> = [
        { desc: `${body.prompt}, full game scene background, wide establishing shot`, transparent: false, tag: 'base' },
        ...(body.layers ?? []).map((l, i) => ({ desc: `${body.prompt}, ${l}, parallax foreground layer, isolated elements only, flat solid chroma ${keyColor} background`, transparent: true, tag: `layer${i + 1}-${l.replace(/[^a-z0-9]+/gi, '-').slice(0, 16)}` })),
      ];
      for (const spec of layerSpecs) {
        const gen = await xaiProvider.generate(applyStyleToPrompt(spec.desc, style), { model: body.model, aspectRatio: aspect, resolution: '2k', outDir: '', basename: '' });
        cost += gen.costUsd ?? 0;
        const g0 = gen.images[0];
        let buf: Buffer = g0.bytes ? Buffer.from(g0.bytes) : Buffer.from(await (await fetch(g0.url!)).arrayBuffer());
        if (spec.transparent) buf = await removeBackground(buf, { keyColor, tolerance: 100 });
        else if (body.tileableX) buf = await makeSeamless(buf, { axis: 'x' });
        if (body.pixelHeight) buf = await downscale(buf, { pixelHeight: body.pixelHeight });
        if (style?.palette?.length) buf = await quantizeBuffer(buf, style.palette);
        const baseName = (body.name || body.prompt.slice(0, 24)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'bg';
        const image = await imageManager.create({ name: `${baseName}-${spec.tag}.png`, buffer: buf, mimeType: 'image/png' });
        wsHandler.broadcast({ type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session });
        outs.push({ tag: spec.tag, id: image.id, name: image.name, transparent: spec.transparent });
      }
      return Response.json({ success: true, layers: outs, tileableX: !!body.tileableX, costUsd: cost });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // GET /api/asset-spend — running spend + budget for the session
  if (path === '/api/asset-spend' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try { return Response.json(await loadSpend(params.project, params.session)); }
    catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/asset-budget — set (or clear with null) the session spend cap
  if (path === '/api/asset-budget' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { budgetUsd?: number | null };
      const s = await setBudget(params.project, params.session, body.budgetUsd ?? null);
      return Response.json({ success: true, spend: s });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/estimate-cost — preview the $ of an operation before running it
  if (path === '/api/estimate-cost' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { op?: string; params?: Record<string, any> };
      if (!body.op) return Response.json({ error: 'op required (image|sprite_sheet|character_animations|vfx|tileset|background|voiceover)' }, { status: 400 });
      const est = estimateCost(body.op, body.params ?? {});
      const spend = await loadSpend(params.project, params.session);
      return Response.json({ op: body.op, estimateUsd: est.usd, breakdown: est.breakdown, spentUsd: spend.totalUsd, budgetUsd: spend.budgetUsd ?? null });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/replace-sheet-cell — composite a replacement image into one cell of a sheet
  if (path === '/api/replace-sheet-cell' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { sheetImageId?: string; replacementImageId?: string; cellIndex?: number; rect?: { x: number; y: number; w: number; h: number }; name?: string };
      if (!body.sheetImageId || !body.replacementImageId) return Response.json({ error: 'sheetImageId and replacementImageId required' }, { status: 400 });
      const { imageManager } = await createManagers(params.project, params.session);
      const sheet = await imageManager.getContent(body.sheetImageId);
      const repl = await imageManager.getContent(body.replacementImageId);
      if (!sheet) return Response.json({ error: `sheetImageId not found: ${body.sheetImageId}` }, { status: 404 });
      if (!repl) return Response.json({ error: `replacementImageId not found: ${body.replacementImageId}` }, { status: 404 });
      // rect: explicit, or derived from the sheet's sidecar manifest by cellIndex
      let rect = body.rect;
      if (!rect && typeof body.cellIndex === 'number') {
        try {
          const meta = await imageManager.get(body.sheetImageId);
          const manifestPath = meta?.path?.replace(/\.[^.]+$/, '') + '.json';
          const m = JSON.parse(await fsReadFile(manifestPath!, 'utf-8'));
          const fr = (m.frames || m.tiles || [])[body.cellIndex];
          if (fr) rect = { x: fr.x, y: fr.y, w: fr.w, h: fr.h };
        } catch { /* no sidecar manifest */ }
      }
      if (!rect) return Response.json({ error: 'provide rect {x,y,w,h} or a cellIndex resolvable from the sheet manifest' }, { status: 400 });
      const { compositeCell } = await import('../../tooling/imagegen/pipeline/spriteSheet');
      const out = await compositeCell(sheet.buffer, repl.buffer, rect);
      const name = (body.name || `${body.sheetImageId}-patched`).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sheet-patched';
      const image = await imageManager.create({ name: `${name}.png`, buffer: out, mimeType: 'image/png' });
      wsHandler.broadcast({ type: 'image_created', id: image.id, name: image.name, mimeType: image.mimeType, size: image.size, uploadedAt: image.uploadedAt, project: params.project, session: params.session });
      return Response.json({ success: true, image: { id: image.id, name: image.name, size: image.size }, rect });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // GET /api/dsp-presets — list the shared audio DSP presets (voice/sfx/music)
  if (path === '/api/dsp-presets' && req.method === 'GET') {
    return Response.json({ presets: listPresets() });
  }

  // POST /api/generate-sfx — Grok-text → sfxr params → pure-JS synth → audio artifact
  if (path === '/api/generate-sfx' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { description?: string; dspPreset?: string; name?: string; model?: string };
      if (!body.description) return Response.json({ error: 'description required' }, { status: 400 });
      const sys = `You are a retro game sound designer. Given an effect description, output JSON sfxr synth params. Fields (all 0..1 unless noted): wave ('square'|'saw'|'sine'|'triangle'|'noise'), attack, sustain, punch, decay, freq, freqMin, slide (-1..1), deltaSlide (-1..1), vibratoDepth, vibratoSpeed, arpMod (-1..1), arpSpeed, duty, dutySweep (-1..1), lowpass, repeat, volume. Pick values that sound like the described effect (e.g. coin=square+upward arp; laser=saw+downward slide; explosion=noise+long decay; jump=square+upward slide). Output ONLY the JSON object.`;
      const sfxr = await completeJson<any>(sys, body.description, { model: body.model });
      let buf: Buffer = renderSfxr(sfxr);
      if (body.dspPreset) buf = await applyChain(buf, { preset: body.dspPreset, codec: 'wav' });
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      const baseName = (body.name || body.description.slice(0, 32)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'sfx';
      const saved = await audio.create({ name: `${baseName}.wav`, buffer: buf, mimeType: 'audio/wav' });
      wsHandler.broadcast({ type: 'audio_created' as any, id: saved.id, name: saved.name, mimeType: saved.mimeType, size: saved.size, project: params.project, session: params.session });
      return Response.json({ success: true, audio: { id: saved.id, name: saved.name, size: saved.size }, params: sfxr, dspPreset: body.dspPreset ?? null });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-music — Grok-text → chiptune pattern → pure-JS synth → audio artifact
  if (path === '/api/generate-music' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { brief?: string; bars?: number; dspPreset?: string; name?: string; model?: string };
      if (!body.brief) return Response.json({ error: 'brief required' }, { status: 400 });
      const bars = Math.max(1, Math.min(16, body.bars ?? 4));
      const sys = `You are a chiptune composer. Output JSON: { bpm:number, beats:number, masterVol:0..1, channels:[ { wave:'square'|'triangle'|'saw'|'noise', duty?:0..1, notes:[ { note:'C4'|midiNumber, start:beatFloat, dur:beatFloat, vol?:0..1 } ] } ] }. Compose a ${bars}-bar (= ${bars * 4} beats) LOOPABLE NES-style track for the brief. Use 2-3 channels: a lead (square), bass (triangle), and optional percussion (noise). Make it musical (a clear melody + bassline) and end so it loops back to the start cleanly. Output ONLY the JSON.`;
      const pattern = await completeJson<any>(sys, body.brief, { model: body.model });
      pattern.beats = pattern.beats ?? bars * 4;
      let buf: Buffer = renderChiptune(pattern);
      if (body.dspPreset) buf = await applyChain(buf, { preset: body.dspPreset, codec: 'wav' });
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      const baseName = (body.name || body.brief.slice(0, 32)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'music';
      const saved = await audio.create({ name: `${baseName}.wav`, buffer: buf, mimeType: 'audio/wav' });
      wsHandler.broadcast({ type: 'audio_created' as any, id: saved.id, name: saved.name, mimeType: saved.mimeType, size: saved.size, project: params.project, session: params.session });
      return Response.json({ success: true, audio: { id: saved.id, name: saved.name, size: saved.size }, bpm: pattern.bpm, channels: (pattern.channels || []).length, dspPreset: body.dspPreset ?? null });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/generate-voiceover — Grok TTS → optional shared DSP preset → audio artifact
  if (path === '/api/generate-voiceover' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { text?: string; voiceId?: string; language?: string; speed?: number; dspPreset?: string; codec?: 'mp3' | 'wav'; name?: string };
      if (!body.text) return Response.json({ error: 'text required' }, { status: 400 });
      const codec = body.codec ?? 'mp3';
      const tts = await synthesizeSpeech(body.text, { voiceId: body.voiceId, language: body.language, speed: body.speed, codec });
      let buf: Buffer = Buffer.from(tts.bytes);
      let mime = tts.mimeType;
      if (body.dspPreset) { buf = await applyChain(buf, { preset: body.dspPreset, codec }); mime = codec === 'wav' ? 'audio/wav' : 'audio/mpeg'; }
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      const baseName = (body.name || body.text.slice(0, 32)).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'voiceover';
      const saved = await audio.create({ name: `${baseName}.${codec}`, buffer: buf, mimeType: mime });
      wsHandler.broadcast({ type: 'audio_created' as any, id: saved.id, name: saved.name, mimeType: saved.mimeType, size: saved.size, project: params.project, session: params.session });
      const spend = await recordSpend(params.project, params.session, tts.costUsd, 'voiceover').catch(() => null);
      return Response.json({ success: true, audio: { id: saved.id, name: saved.name, size: saved.size }, voiceId: tts.voiceId, dspPreset: body.dspPreset ?? null, costUsd: tts.costUsd, sessionSpendUsd: spend?.totalUsd });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // POST /api/apply-audio-dsp — apply a shared DSP preset to an EXISTING audio artifact
  // (the same adjustments for voice, SFX, and music).
  if (path === '/api/apply-audio-dsp' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const body = await req.json() as { audioId?: string; preset?: string; name?: string };
      if (!body.audioId || !body.preset) return Response.json({ error: 'audioId and preset required' }, { status: 400 });
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      const src = await audio.getContent(body.audioId);
      if (!src) return Response.json({ error: `audioId not found: ${body.audioId}` }, { status: 404 });
      const codec = src.mimeType.includes('wav') ? 'wav' : 'mp3';
      const out = await applyChain(src.buffer, { preset: body.preset, codec });
      const baseName = (body.name || `${body.audioId}-${body.preset}`).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'audio-dsp';
      const saved = await audio.create({ name: `${baseName}.${codec}`, buffer: out, mimeType: codec === 'wav' ? 'audio/wav' : 'audio/mpeg' });
      wsHandler.broadcast({ type: 'audio_created' as any, id: saved.id, name: saved.name, mimeType: saved.mimeType, size: saved.size, project: params.project, session: params.session });
      return Response.json({ success: true, audio: { id: saved.id, name: saved.name, size: saved.size }, preset: body.preset });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // GET /api/audio — list audio artifacts
  if (path === '/api/audio' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      return Response.json({ audio: await audio.list() });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // GET /api/audio/:id/content — stream audio bytes
  if (path.startsWith('/api/audio/') && path.endsWith('/content') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const id = decodeURIComponent(path.slice('/api/audio/'.length, -'/content'.length));
      const audio = new AudioManager(sessionRegistry.resolvePath(params.project, params.session, 'audio'));
      await audio.initialize();
      const c = await audio.getContent(id);
      if (!c) return Response.json({ error: 'audio not found' }, { status: 404 });
      return new Response(new Uint8Array(c.buffer), { headers: { 'Content-Type': c.mimeType } });
    } catch (error: any) { return Response.json({ error: error.message }, { status: 400 }); }
  }

  // GET /api/images — list
  if (path === '/api/images' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const { imageManager } = await createManagers(params.project, params.session);
      const images = await imageManager.list();
      return Response.json({ images });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/storybook/validate
  if (path === '/api/storybook/validate' && req.method === 'GET') {
    const port = url.searchParams.get('port');
    const storyId = url.searchParams.get('storyId');

    const portNum = parseInt(port || '', 10);
    if (!portNum || portNum < 1 || portNum > 65535 || !storyId) {
      return Response.json({ valid: false, storyId: storyId || '', error: 'Valid port (1-65535) and storyId query params required' }, { status: 400 });
    }

    try {
      const response = await fetch(`http://localhost:${portNum}/index.json`);
      if (!response.ok) {
        return Response.json({ valid: false, storyId, error: 'Storybook returned HTTP ' + response.status });
      }
      const data = (await response.json()) as { entries?: Record<string, unknown> };
      const valid = storyId in (data.entries || {});
      return Response.json({ valid, storyId, error: valid ? undefined : 'Story "' + storyId + '" not found in Storybook index' });
    } catch (error: any) {
      return Response.json({ valid: false, storyId, error: 'Could not reach Storybook at localhost:' + port + '. Is the dev server running? (' + error.message + ')' });
    }
  }

  // POST /api/claude-session/register?project=...&session=...
  if (path === '/api/claude-session/register' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { claudeSessionId } = await req.json() as { claudeSessionId?: string };

    if (!claudeSessionId) {
      return Response.json({ error: 'claudeSessionId required' }, { status: 400 });
    }

    let claudePid: number | undefined;
    try {
      const fsPromises = await import('fs/promises');
      const bindingRaw = await fsPromises.readFile(`/tmp/.mermaid-collab-binding-${claudeSessionId}.json`, 'utf-8');
      const binding = JSON.parse(bindingRaw) as { claudePid?: string | number };
      const rawPid = Number(binding.claudePid);
      claudePid = Number.isInteger(rawPid) && rawPid > 0 ? rawPid : undefined;
    } catch {
      // non-fatal — proceed without claudePid
    }

    wsHandler.broadcast({
      type: 'claude_session_registered',
      claudeSessionId,
      claudePid,
      project: params.project,
      session: params.session,
    });

    void watchSession(params.project, params.session);

    return Response.json({ success: true, claudeSessionId });
  }

  // POST /api/session-notify
  if (path === '/api/session-notify' && req.method === 'POST') {
    const { claudeSessionId, project, session, status } = await req.json() as {
      claudeSessionId?: string;
      project?: string;
      session?: string;
      status?: string;
    };

    const ALLOWED_STATUS = new Set(['active', 'waiting', 'permission', 'checkpoint_ready']);
    if (!claudeSessionId || !project || !session || !status || !ALLOWED_STATUS.has(status)) {
      return Response.json({ error: 'claudeSessionId, project, session, and valid status (active|waiting|permission|checkpoint_ready) required' }, { status: 400 });
    }

    // Validate claudeSessionId is a strict UUID before using it as a filename component.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(claudeSessionId)) {
      return Response.json({ error: 'Invalid claudeSessionId format (expected UUID)' }, { status: 400 });
    }

    // Trust boundary: require a matching on-disk binding file written by register_claude_session.
    // This replaces the in-memory claudeSessionMap registry check. Use async fs to avoid
    // blocking the event loop.
    const bindingPath = `/tmp/.mermaid-collab-binding-${claudeSessionId}.json`;
    let bindingRaw: string;
    try {
      const fsPromises = await import('fs/promises');
      bindingRaw = await fsPromises.readFile(bindingPath, 'utf-8');
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        return Response.json({ error: 'Unknown session (no binding)' }, { status: 404 });
      }
      return Response.json({ error: `Failed to read binding: ${err?.message || String(err)}` }, { status: 500 });
    }
    try {
      const binding = JSON.parse(bindingRaw) as { project?: string; session?: string };
      if (binding.project !== project || binding.session !== session) {
        return Response.json({ error: 'Binding mismatch' }, { status: 403 });
      }
    } catch (err: any) {
      return Response.json({ error: `Corrupt binding file: ${err?.message || String(err)}` }, { status: 500 });
    }

    // Capture the prior status BEFORE overwriting, to detect transitions.
    let prevStatus: string | null = null;
    try {
      prevStatus = getStatus(project, session)?.status ?? null;
    } catch { /* ignore */ }

    try {
      recordStatus(project, session, status as ClaudeStatus);
    } catch (err: any) {
      console.error(`[session-notify] Failed to persist status for ${project}/${session}: ${err?.message || String(err)}`);
    }

    wsHandler.broadcast({
      type: 'claude_session_status',
      claudeSessionId,
      project,
      session,
      status: status as ClaudeStatus,
      lastUpdate: Date.now(),
    });

    // Real-time push to the supervisor: when a SUPERVISED worker transitions
    // into a state that needs attention (waiting / permission), nudge the
    // supervisor's own tmux to reconcile now — so it doesn't have to wait for
    // its next turn / scheduled wake. Fire-and-forget; never push to self.
    if ((status === 'waiting' || status === 'permission') && status !== prevStatus) {
      void (async () => {
        try {
          if (!isSupervised(project, session)) return;
          const sup = getSupervisorIdentity();
          if (!sup) return;
          if (sup.project === project && sup.session === session) return; // don't notify self
          const base = project.split('/').filter(Boolean).pop() ?? project;
          await sendTmuxKeys(
            sup.project,
            sup.session,
            `[mc-supervisor] worker "${session}" (${base}) → ${status}. Run a supervisor reconcile and handle it.`,
          );
        } catch (err: any) {
          console.warn(`[session-notify] supervisor push failed: ${err?.message || String(err)}`);
        }
      })();
    }

    return Response.json({ success: true });
  }

  // GET /api/session-status?project=
  if (path === '/api/session-status' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) {
      return Response.json({ error: 'project required' }, { status: 400 });
    }
    return Response.json({ statuses: getStatuses(project) });
  }

  // GET /api/session-runtime?project=
  // Unified read model feed for the FleetGraph: status + claim + identity joined
  // server-side with a single deriveLiveness, so the UI consumes one shape
  // instead of re-stitching session-status + todos client-side.
  if (path === '/api/session-runtime' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) {
      return Response.json({ error: 'project required' }, { status: 400 });
    }
    return Response.json({ runtimes: listSessionRuntimes(project) });
  }

  // GET /api/fleet?project=
  // Live fleet read-model: per in-progress lane, its worker, derived WorkerState
  // from REAL tmux liveness (not session-status age) + a stable lastActivity for
  // the card timer. The Bridge worker roster consumes this so a live-but-idle
  // worker reads as PRESENT and each timer reflects its own real activity.
  if (path === '/api/fleet' && req.method === 'GET') {
    const project = url.searchParams.get('project');
    if (!project) {
      return Response.json({ error: 'project required' }, { status: 400 });
    }
    return Response.json(getFleetStatus(project));
  }

  // GET /api/transcript/last-turn?claudeSessionId=  (peer-callable)
  if (path === '/api/transcript/last-turn' && req.method === 'GET') {
    const claudeSessionId = url.searchParams.get('claudeSessionId');
    if (!claudeSessionId) {
      return Response.json({ error: 'claudeSessionId required' }, { status: 400 });
    }
    try {
      return Response.json(await lastAssistantTurn(claudeSessionId));
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/session/context-update
  if (path === '/api/session/context-update' && req.method === 'POST') {
    const { claudePid, contextPercent } = await req.json() as { claudePid?: number; contextPercent?: number };

    if (claudePid == null || contextPercent == null) {
      return Response.json({ error: 'claudePid and contextPercent required' }, { status: 400 });
    }

    const fsPromises = await import('fs/promises');

    let claudeSessionId: string;
    try {
      claudeSessionId = (await fsPromises.readFile(`/tmp/.claude-session-id-${claudePid}`, 'utf-8')).trim();
    } catch {
      return Response.json({ error: 'No session found for claudePid' }, { status: 404 });
    }

    let project: string;
    let session: string;
    try {
      const bindingRaw = await fsPromises.readFile(`/tmp/.mermaid-collab-binding-${claudeSessionId}.json`, 'utf-8');
      const binding = JSON.parse(bindingRaw) as { project?: string; session?: string };
      if (!binding.project || !binding.session) {
        return Response.json({ error: 'Binding missing project or session' }, { status: 404 });
      }
      project = binding.project;
      session = binding.session;
    } catch {
      return Response.json({ error: 'Binding not found' }, { status: 404 });
    }

    // Persist server-side so the supervisor/context-watchdog can read it via
    // HTTP (GET /api/session-status), not just transient WS broadcast.
    recordContextPercent(project, session, contextPercent);
    wsHandler.broadcast({ type: 'claude_context_update', project, session, contextPercent });

    return Response.json({ success: true });
  }


  // ============================================
  // Lessons Routes
  // ============================================

  // GET /api/lessons?project=...&session=...
  if (path === '/api/lessons' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const result = await listLessons(params.project, params.session);
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/lesson?project=...&session=...
  if (path === '/api/lesson' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { lesson, category } = await req.json() as { lesson?: string; category?: LessonCategory };

    if (!lesson) {
      return Response.json({ error: 'lesson content required' }, { status: 400 });
    }

    try {
      // Register session if not already registered
      const sessionResult = await sessionRegistry.register(params.project, params.session);
      if (sessionResult.created) {
        wsHandler.broadcast({ type: 'session_created', project: params.project, session: params.session });
      }

      const result = await addLesson(params.project, params.session, lesson, category);

      wsHandler.broadcast({
        type: 'lesson_added',
        lessonCount: result.lessonCount,
        project: params.project,
        session: params.session,
      });

      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // ============================================
  // Session Todos Routes (per-session checklist)
  // ============================================

  // GET /api/session-todos?project=...&session=...&includeCompleted=...&ownerSession=...&assigneeSession=...&status=...
  if (path === '/api/session-todos' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const includeCompletedParam = url.searchParams.get('includeCompleted');
    const includeCompleted = includeCompletedParam === null
      ? true
      : includeCompletedParam !== 'false';
    const ownerSession = url.searchParams.get('ownerSession') ?? undefined;
    const assigneeSession = url.searchParams.get('assigneeSession') ?? undefined;
    const status = url.searchParams.get('status') as import('../services/todo-store').TodoStatus | null ?? undefined;

    try {
      const todos = listTodos(params.project, { session: params.session, ownerSession, assigneeSession, status, includeCompleted });
      return Response.json({ todos });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/session-todos - Add a session todo
  if (path === '/api/session-todos' && req.method === 'POST') {
    try {
      const body = await req.json() as {
        project?: string;
        session?: string;
        title?: string;
        text?: string;
        link?: SessionTodoLink;
        status?: import('../services/todo-store').TodoStatus;
        assigneeSession?: string;
        priority?: 0 | 1 | 2 | 3 | 4;
        dueDate?: string;
        description?: string;
      };

      const { project, session, link, status, assigneeSession, priority, dueDate, description } = body;
      const title = body.title ?? body.text;

      if (!project || !session || !title) {
        return Response.json({ error: 'project, session, and title (or text) required' }, { status: 400 });
      }
      if (!title.trim()) {
        return Response.json({ error: 'title must be non-empty' }, { status: 400 });
      }

      const todo = await createTodo(project, { ownerSession: session, title, link, status, assigneeSession, priority, dueDate, description });

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
        ownerSession: todo.ownerSession,
        assigneeSession: todo.assigneeSession ?? undefined,
      });

      return Response.json({ todo }, { status: 201 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/session-todos/clear-completed - Clear all completed session todos
  if (path === '/api/session-todos/clear-completed' && req.method === 'POST') {
    try {
      const { project, session } = await req.json() as { project?: string; session?: string };

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      const result = await clearCompleted(project, session);

      if (result.removed > 0) {
        wsHandler.broadcast({
          type: 'session_todos_updated',
          project,
          session,
        });
      }

      // Return both keys: `removedCount` is the historical contract the UI/MCP read.
      return Response.json({ removed: result.removed, removedCount: result.removed });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/session-todos/reorder - Reorder session todos
  if (path === '/api/session-todos/reorder' && req.method === 'POST') {
    try {
      const { project, session, orderedIds } = await req.json() as {
        project?: string;
        session?: string;
        orderedIds?: string[];
      };

      if (!project || !session || !Array.isArray(orderedIds)) {
        return Response.json({ error: 'project, session, and orderedIds required' }, { status: 400 });
      }

      await reorder(project, orderedIds);

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
      });

      return Response.json({ ok: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // PATCH /api/session-todos/:id - Update a session todo
  const sessionTodosPatchMatch = path.match(/^\/api\/session-todos\/([^/]+)$/);
  if (sessionTodosPatchMatch && req.method === 'PATCH') {
    try {
      const body = await req.json() as {
        project?: string;
        session?: string;
        title?: string;
        text?: string;
        completed?: boolean;
        status?: import('../services/todo-store').TodoStatus;
        assigneeSession?: string | null;
        priority?: 0 | 1 | 2 | 3 | 4 | null;
        dueDate?: string | null;
        description?: string | null;
        link?: SessionTodoLink | null;
      };

      const { project, session, completed, status, assigneeSession, priority, dueDate, description, link } = body;
      const title = body.title ?? body.text;

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }
      if (title !== undefined && !title.trim()) {
        return Response.json({ error: 'title must be non-empty' }, { status: 400 });
      }

      const id = sessionTodosPatchMatch[1];
      const prev = getTodo(project, id); // snapshot the prior assignee for broadcast targeting
      const todo = await updateTodo(project, id, { title, completed, status, assigneeSession, priority, dueDate, description, link });

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
        ownerSession: todo.ownerSession,
        assigneeSession: todo.assigneeSession ?? undefined,
        // The session a todo was moved AWAY from must also refresh its list.
        previousAssigneeSession: prev?.assigneeSession ?? undefined,
      });

      return Response.json({ todo });
    } catch (error: any) {
      const status = error.message?.includes('not found') ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
  }

  // DELETE /api/session-todos/:id?project=...&session=...
  const sessionTodosDeleteMatch = path.match(/^\/api\/session-todos\/([^/]+)$/);
  if (sessionTodosDeleteMatch && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = sessionTodosDeleteMatch[1];

    try {
      const deletedTodo = getTodo(params.project, id); // snapshot before delete for broadcast targeting
      await removeTodo(params.project, id);

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project: params.project,
        session: params.session,
        ownerSession: deletedTodo?.ownerSession,
        assigneeSession: deletedTodo?.assigneeSession ?? undefined,
      });

      return Response.json({ ok: true });
    } catch (error: any) {
      const status = error.message?.includes('not found') ? 404 : 500;
      return Response.json({ error: error.message }, { status });
    }
  }

  // GET /api/metadata?project=...&session=...
  if (path === '/api/metadata' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { metadataManager } = await createManagers(params.project, params.session);
    return Response.json(metadataManager.getMetadata());
  }

  // POST /api/metadata/item/:id?project=...&session=... - update item folder/locked status
  if (path.match(/^\/api\/metadata\/item\/[^/]+$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const updates = await req.json() as { folder?: string | null; locked?: boolean; deprecated?: boolean; pinned?: boolean; blueprint?: boolean };

    try {
      const { metadataManager } = await createManagers(params.project, params.session);
      await metadataManager.updateItem(id, updates);

      wsHandler.broadcast({
        type: 'metadata_updated',
        itemId: id,
        updates,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/metadata/folders?project=...&session=... - create/rename/delete folders
  if (path === '/api/metadata/folders' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { action, name, newName } = await req.json() as { action: string; name?: string; newName?: string };

    try {
      const { metadataManager } = await createManagers(params.project, params.session);

      if (action === 'create') {
        if (!name) {
          return Response.json({ error: 'Folder name required' }, { status: 400 });
        }
        await metadataManager.createFolder(name);
      } else if (action === 'rename') {
        if (!name || !newName) {
          return Response.json({ error: 'Old and new folder names required' }, { status: 400 });
        }
        await metadataManager.renameFolder(name, newName);
      } else if (action === 'delete') {
        if (!name) {
          return Response.json({ error: 'Folder name required' }, { status: 400 });
        }
        await metadataManager.deleteFolder(name, true);
      } else {
        return Response.json({ error: 'Invalid action' }, { status: 400 });
      }

      wsHandler.broadcast({
        type: 'metadata_updated',
        foldersChanged: true,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true, folders: metadataManager.getFolders() });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // ============================================
  // Question/UI Response Routes
  // ============================================

  // GET /api/question?project=...&session=... - Get current pending question
  if (path === '/api/question' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const sessionKey = `${params.project}:${params.session}`;
      const question = questionManager.getQuestion(sessionKey);
      return Response.json({ question });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/question-response?project=...&session=... - Submit response to a pending question
  if (path === '/api/question-response' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { questionId, response } = await req.json() as { questionId?: string; response?: string };

      if (!questionId || response === undefined) {
        return Response.json({ error: 'questionId and response required' }, { status: 400 });
      }

      const sessionKey = `${params.project}:${params.session}`;
      const success = questionManager.receiveResponse(sessionKey, {
        questionId,
        response,
        timestamp: Date.now(),
      });

      if (!success) {
        return Response.json(
          { error: 'No pending question found or question ID mismatch' },
          { status: 404 }
        );
      }

      // Broadcast question response via WebSocket
      wsHandler.broadcast({
        type: 'question_responded',
        questionId,
        response,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/dismiss-ui?project=...&session=... - Dismiss current UI (used by mcp-dismiss-ui)
  if (path === '/api/dismiss-ui' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const sessionKey = `${params.project}:${params.session}`;
      const dismissed = questionManager.dismissQuestion(sessionKey);

      // Broadcast dismiss event via WebSocket
      wsHandler.broadcast({
        type: 'ui_dismissed',
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true, dismissed });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/update-ui?project=...&session=... - Update current UI (used by mcp-update-ui)
  if (path === '/api/update-ui' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { patch } = await req.json() as { patch?: Record<string, unknown> };

      if (!patch) {
        return Response.json({ error: 'patch required' }, { status: 400 });
      }

      // Broadcast update event via WebSocket
      wsHandler.broadcast({
        type: 'ui_updated',
        patch,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/render-ui?project=...&session=... - Render UI to browser
  if (path === '/api/render-ui' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { ui, blocking } = await req.json() as { ui?: any; blocking?: boolean };

      if (!ui) {
        return Response.json({ error: 'ui required' }, { status: 400 });
      }

      // Generate uiId
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const uiId = `ui_${timestamp}_${random}`;

      // Build WebSocket message
      const message = {
        type: 'ui_render' as const,
        uiId,
        project: params.project,
        session: params.session,
        ui,
        blocking: blocking ?? true,
        timestamp: Date.now(),
      };

      // Broadcast to browsers
      wsHandler.broadcast(message);

      // If non-blocking mode, cache UI and return immediately
      if (blocking === false) {
        // Still call renderUI to cache the UI for polling, but don't await
        uiManager.renderUI({
          project: params.project,
          session: params.session,
          ui,
          blocking: false,
          uiId,
        });
        return Response.json({ success: true, uiId });
      }

      // If blocking mode (default), await response via uiManager
      const response = await uiManager.renderUI({
        project: params.project,
        session: params.session,
        ui,
        blocking: blocking ?? true,
        uiId,  // Pass the same uiId that was sent to browsers
      });
      return Response.json(response);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/ui-response?project=...&session=...&uiId=... - Poll for UI response status
  if (path === '/api/ui-response' && req.method === 'GET') {
    const params = getSessionParams(url);
    const uiId = url.searchParams.get('uiId');
    if (!params || !uiId) {
      return Response.json({ error: 'project, session, and uiId required' }, { status: 400 });
    }

    try {
      const status = uiManager.getUIStatus(params.project, params.session, uiId);
      return Response.json(status);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/ui-response?project=...&session=... - Receive UI response from browser
  if (path === '/api/ui-response' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { uiId, action, data, source } = await req.json() as { uiId?: string; action?: string; data?: Record<string, any>; source?: string };

      if (!uiId) {
        return Response.json({ error: 'uiId required' }, { status: 400 });
      }

      // Build session key
      const sessionKey = `${params.project}:${params.session}`;

      // Forward to uiManager
      const success = uiManager.receiveResponse(sessionKey, uiId, {
        action,
        data,
        source: (source || 'browser') as 'browser' | 'terminal' | 'timeout',
      });

      if (!success) {
        return Response.json(
          { error: 'No pending UI or uiId mismatch' },
          { status: 404 }
        );
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // ============================================
  // Terminal Session Management (PTY-backed, project/session scoped)
  // ============================================

  // POST /api/terminal/sessions - Create new terminal session
  if (path === '/api/terminal/sessions' && req.method === 'POST') {
    try {
      const { project: rawProject, session, name } = await req.json() as { project?: string; session?: string; name?: string };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      // tmux hosts every terminal session; if it's missing on the server PATH the
      // PTY shell exits instantly and the pane opens dead. Fail loudly so the UI
      // can tell the user instead of silently presenting a broken terminal. (Most
      // common after a GUI/login-item app relaunch with a Homebrew-less PATH.)
      const { isTmuxAvailable, TMUX_UNAVAILABLE_MESSAGE } = await import('../services/tmux-availability.js');
      if (!(await isTmuxAvailable())) {
        return Response.json(
          { error: TMUX_UNAVAILABLE_MESSAGE, code: 'tmux-unavailable' },
          { status: 503 },
        );
      }

      // Import managers
      const { terminalManager } = await import('../services/terminal-manager.js');
      const { ptyManager } = await import('../terminal/index.js');
      const { randomUUID } = await import('crypto');

      // Read current sessions for naming
      const state = await terminalManager.readSessions(project, session);

      // Determine display name
      let displayName = name;
      if (!displayName || typeof displayName !== 'string') {
        displayName = `Terminal ${state.sessions.length + 1}`;
      }

      // Generate unique session ID
      const id = randomUUID();

      // Attach directly to the project/session's base tmux session. (We used to
      // attach to a 'vscode-collab-*' grouped session to share the live terminal
      // with the VSCode extension; that's deprecated — VSCode now only opens
      // diffs — and sharing one tmux window between differently-sized clients
      // garbled full-screen TUIs.)
      // Cross-project workers (coordinator spawn with targetProject != tracking
      // project) had their tmux created under the LAUNCH project; the supervised
      // row is keyed by the tracking project, so deriving from `project` here
      // would name a different tmux than the one that exists. Resolve the launch
      // project (null → same as `project`) so we attach to the SAME session the
      // worker runs in. Same-project case is unchanged.
      const launchProject = getSupervisedLaunchProject(project, session) ?? project;
      const base = tmuxBaseName(launchProject, session);

      // Self-heal: if a pre-fix session is parked in the wrong dir, kill it so
      // the attach below recreates it in the project dir.
      const { healStaleTmuxSession } = await import('../services/tmux-session.js');
      await healStaleTmuxSession(base, launchProject);

      // Create PTY session via ptyManager with the launch project as cwd (matches
      // where the worker's tmux actually lives for cross-project spawns).
      await ptyManager.create(id, { cwd: launchProject, tmux: { base } });

      // Create session record for persistence
      const newSession = {
        id,
        name: displayName,
        tmuxSession: base,
        created: new Date().toISOString(),
        order: state.sessions.length,
      };

      // Add to sessions array and persist
      state.sessions.push(newSession);
      await terminalManager.writeSessions(project, session, state);

      // Return session info with 201 Created status
      return Response.json({
        id,
        tmuxSession: base,
        wsUrl: `ws://localhost:9002/terminal/${id}`,
      }, { status: 201 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/terminal/sessions?project=...&session=... - List terminal sessions
  if (path === '/api/terminal/sessions' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      // Import managers
      const { terminalManager } = await import('../services/terminal-manager.js');
      const { ptyManager } = await import('../terminal/index.js');

      // Read sessions from storage
      const state = await terminalManager.readSessions(params.project, params.session);

      // Sort sessions by order field and augment with live status
      const sortedSessions = state.sessions
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          ...s,
          alive: ptyManager.has(s.id),
        }));

      return Response.json({ sessions: sortedSessions }, { status: 200 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // DELETE /api/terminal/sessions/:id?project=...&session=... - Kill a terminal session
  if (path.match(/^\/api\/terminal\/sessions\/[^/]+$/) && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const id = path.split('/').pop()!;

      if (!id) {
        return Response.json({ error: 'Session ID required' }, { status: 400 });
      }

      // Import managers
      const { terminalManager } = await import('../services/terminal-manager.js');
      const { ptyManager } = await import('../terminal/index.js');

      // Read current sessions
      const state = await terminalManager.readSessions(params.project, params.session);

      // Find session by id
      const sessionIndex = state.sessions.findIndex(s => s.id === id);
      if (sessionIndex === -1) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }

      // Kill PTY session
      ptyManager.kill(id);

      // Remove from sessions array
      state.sessions.splice(sessionIndex, 1);

      // Recompute order for remaining sessions
      for (let i = 0; i < state.sessions.length; i++) {
        state.sessions[i].order = i;
      }

      // Write updated sessions
      await terminalManager.writeSessions(params.project, params.session, state);

      // Return 204 No Content on success
      return new Response(null, { status: 204 });
    } catch (error: any) {
      if (error.message === 'Session not found') {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/terminal/sessions/:id/rename?project=...&session=... - Rename a terminal session
  if (path.match(/^\/api\/terminal\/sessions\/[^/]+\/rename$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const sessionId = path.split('/')[4];
      const { name } = await req.json() as { name?: string };

      if (!sessionId) {
        return Response.json({ error: 'Session ID required' }, { status: 400 });
      }

      if (!name) {
        return Response.json({ error: 'name required' }, { status: 400 });
      }

      // Import terminal manager
      const { terminalManager } = await import('../services/terminal-manager.js');

      // Read current sessions
      const state = await terminalManager.readSessions(params.project, params.session);

      // Find session by id
      const sessionToRename = state.sessions.find(s => s.id === sessionId);
      if (!sessionToRename) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }

      // Update name field
      let trimmedName = name.trim();
      if (!trimmedName) {
        trimmedName = 'Terminal';
      }
      sessionToRename.name = trimmedName;

      // Write updated sessions
      await terminalManager.writeSessions(params.project, params.session, state);

      return Response.json({ success: true }, { status: 200 });
    } catch (error: any) {
      if (error.message === 'Session not found') {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/terminal/sessions/:id/reset?project=...&session=... - Unstick a wedged
  // terminal: re-sync Claude's TUI (/tui fullscreen, the real cure for missing
  // history + wheel-sends-arrows) and re-assert tmux mouse-off modes.
  if (path.match(/^\/api\/terminal\/sessions\/[^/]+\/reset$/) && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) return Response.json({ error: 'project and session query params required' }, { status: 400 });
    try {
      const sessionId = path.split('/')[4];
      if (!sessionId) return Response.json({ error: 'Session ID required' }, { status: 400 });
      const { terminalManager } = await import('../services/terminal-manager.js');
      const state = await terminalManager.readSessions(params.project, params.session);
      const target = state.sessions.find(s => s.id === sessionId);
      if (!target) return Response.json({ error: 'Session not found' }, { status: 404 });
      await terminalManager.resetTmuxModes(target.tmuxSession);
      await terminalManager.resyncClaudeTui(target.tmuxSession);
      return Response.json({ success: true }, { status: 200 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // PUT /api/terminal/sessions/reorder?project=...&session=... - Reorder terminal sessions
  if (path === '/api/terminal/sessions/reorder' && req.method === 'PUT') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { orderedIds } = await req.json() as { orderedIds?: string[] };

      if (!orderedIds || !Array.isArray(orderedIds)) {
        return Response.json({ error: 'orderedIds array required' }, { status: 400 });
      }

      // Import terminal manager
      const { terminalManager } = await import('../services/terminal-manager.js');

      // Read current sessions
      const state = await terminalManager.readSessions(params.project, params.session);

      // Validate orderedIds - must contain all session IDs (no missing, no extras)
      const sessionIds = new Set(state.sessions.map(s => s.id));
      const orderedIdSet = new Set(orderedIds);

      // Check for duplicates
      if (orderedIds.length !== orderedIdSet.size) {
        return Response.json({ error: 'orderedIds contains duplicate IDs' }, { status: 400 });
      }

      // Check for missing sessions
      for (const id of sessionIds) {
        if (!orderedIdSet.has(id)) {
          return Response.json({ error: 'orderedIds is missing a session ID' }, { status: 400 });
        }
      }

      // Check for unknown IDs
      for (const id of orderedIds) {
        if (!sessionIds.has(id)) {
          return Response.json({ error: 'orderedIds contains unknown session ID' }, { status: 400 });
        }
      }

      // Reorder sessions array and update order fields
      const newSessions: typeof state.sessions = [];
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i];
        const foundSession = state.sessions.find(s => s.id === id);
        if (foundSession) {
          foundSession.order = i;
          newSessions.push(foundSession);
        }
      }

      state.sessions = newSessions;

      // Write updated sessions
      await terminalManager.writeSessions(params.project, params.session, state);

      return Response.json({ success: true }, { status: 200 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // GET /api/settings - Return merged Claude Code settings
  if (path === '/api/settings' && req.method === 'GET') {
    try {
      const project = url.searchParams.get('project') ?? undefined;
      const cwd = project ? expandPath(project) : undefined;
      const result = await mergeSettings(cwd);
      return Response.json(result, {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  // PUT /api/settings - Patch a Claude Code settings layer
  if (path === '/api/settings' && req.method === 'PUT') {
    try {
      const body = await req.json() as { project?: string; source?: string; patch?: Record<string, unknown> };
      const { project: rawProject, source, patch } = body;
      if (!source || !patch) return Response.json({ error: 'source and patch are required' }, { status: 400 });
      const validSources = ['global', 'project', 'local'];
      if (!validSources.includes(source)) return Response.json({ error: 'source must be global, project, or local' }, { status: 400 });
      const cwd = rawProject ? expandPath(rawProject) : undefined;
      const updated = await patchSettings(patch, source as 'global' | 'project' | 'local', cwd);
      return Response.json({ success: true, settings: updated });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  // POST /api/settings/env - Save env vars to .claude/settings.local.json
  if (path === '/api/settings/env' && req.method === 'POST') {
    try {
      const body = await req.json() as { project?: string; env?: Record<string, string> };
      const { project: rawProject, env } = body;
      if (!rawProject) return Response.json({ error: 'project is required' }, { status: 400 });
      if (!env || typeof env !== 'object' || Array.isArray(env)) return Response.json({ error: 'env must be a key/value object' }, { status: 400 });
      const cwd = expandPath(rawProject);
      const current = (await readSettings('local', cwd)) ?? {};
      const updated = { ...current, env };
      await writeSettings(updated, 'local', cwd);
      return Response.json({ success: true });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  // GET /api/settings/secrets - Read secrets/API keys from ~/.mermaid-collab/config.json
  if (path === '/api/settings/secrets' && req.method === 'GET') {
    try {
      const { getConfigEntries } = await import('../services/config-service.ts');
      const entries = getConfigEntries();
      // Only surface string-valued entries (secrets/API keys); the file may also
      // hold non-secret structured config we don't want to render as a text field.
      const secrets: Record<string, string> = {};
      for (const [k, v] of Object.entries(entries)) {
        if (typeof v === 'string') secrets[k] = v;
      }
      return Response.json({ secrets }, { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  // POST /api/settings/secrets - Save secrets/API keys to ~/.mermaid-collab/config.json.
  // Writes via the config service so the in-memory cache refreshes and the next
  // consult_grok (and other getConfig readers) pick up the new value with no restart.
  if (path === '/api/settings/secrets' && req.method === 'POST') {
    try {
      const body = await req.json() as { secrets?: Record<string, string> };
      const { secrets } = body;
      if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
        return Response.json({ error: 'secrets must be a key/value object' }, { status: 400 });
      }
      const updates: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets)) {
        if (typeof k === 'string' && k.trim()) updates[k.trim()] = typeof v === 'string' ? v : String(v);
      }
      const { setConfig } = await import('../services/config-service.ts');
      setConfig(updates);
      return Response.json({ success: true });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  // GET /api/mcp/servers - List configured MCP servers
  if (path === '/api/mcp/servers' && req.method === 'GET') {
    try {
      const { readFile: fsReadFile } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');
      const { homedir: osHomedir } = await import('node:os');
      const configPath = pathJoin(osHomedir(), '.claude', 'config.json');
      let config: { mcpServers?: Record<string, unknown> } = {};
      try { config = JSON.parse(await fsReadFile(configPath, 'utf-8')); } catch { /* missing */ }
      const servers = Object.entries(config.mcpServers ?? {}).map(([name, def]) => ({
        name, id: name, status: 'configured', ...(def as object),
      }));
      return Response.json({ servers }, { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  // POST /api/mcp/servers - Add an MCP server
  if (path === '/api/mcp/servers' && req.method === 'POST') {
    try {
      const body = await req.json() as { name?: string; command?: string; args?: string[]; env?: Record<string, string> };
      const { name, command, args, env: serverEnv } = body;
      if (!name || !command) return Response.json({ error: 'name and command are required' }, { status: 400 });
      const { readFile: fsReadFile, writeFile: fsWriteFile, rename: fsRename, mkdir: fsMkdir } = await import('node:fs/promises');
      const { join: pathJoin, dirname: pathDirname } = await import('node:path');
      const { homedir: osHomedir } = await import('node:os');
      const configPath = pathJoin(osHomedir(), '.claude', 'config.json');
      let config: { mcpServers?: Record<string, unknown> } = {};
      try { config = JSON.parse(await fsReadFile(configPath, 'utf-8')); } catch { config = {}; }
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers[name] = { command, args: args ?? [], ...(serverEnv ? { env: serverEnv } : {}) };
      await fsMkdir(pathDirname(configPath), { recursive: true });
      const tmp = configPath + '.tmp';
      await fsWriteFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      await fsRename(tmp, configPath);
      return Response.json({ success: true, name }, { status: 201 });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  // DELETE /api/mcp/servers - Remove an MCP server
  if (path === '/api/mcp/servers' && req.method === 'DELETE') {
    try {
      const name = url.searchParams.get('name');
      if (!name) return Response.json({ error: 'name query param is required' }, { status: 400 });
      const { readFile: fsReadFile, writeFile: fsWriteFile, rename: fsRename } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');
      const { homedir: osHomedir } = await import('node:os');
      const configPath = pathJoin(osHomedir(), '.claude', 'config.json');
      let config: { mcpServers?: Record<string, unknown> } = {};
      try { config = JSON.parse(await fsReadFile(configPath, 'utf-8')); } catch { return Response.json({ error: 'MCP config not found' }, { status: 404 }); }
      if (!config.mcpServers || !(name in config.mcpServers)) return Response.json({ error: `Server '${name}' not found` }, { status: 404 });
      delete config.mcpServers[name];
      const tmp = configPath + '.tmp';
      await fsWriteFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      await fsRename(tmp, configPath);
      return Response.json({ success: true });
    } catch (error: unknown) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  // POST /api/mcp/servers/:name/test - Probe an MCP server
  if (path.startsWith('/api/mcp/servers/') && path.endsWith('/test') && req.method === 'POST') {
    try {
      const parts = path.split('/');
      const name = decodeURIComponent(parts[4] ?? '');
      if (!name) return Response.json({ error: 'server name required' }, { status: 400 });
      const { readFile: fsReadFile } = await import('node:fs/promises');
      const { join: pathJoin } = await import('node:path');
      const { homedir: osHomedir } = await import('node:os');
      const configPath = pathJoin(osHomedir(), '.claude', 'config.json');
      let config: { mcpServers?: Record<string, { command: string; args?: string[] }> } = {};
      try { config = JSON.parse(await fsReadFile(configPath, 'utf-8')); } catch { return Response.json({ error: 'MCP config not found' }, { status: 404 }); }
      const serverDef = config.mcpServers?.[name];
      if (!serverDef) return Response.json({ error: `Server '${name}' not found` }, { status: 404 });
      const { spawn } = await import('node:child_process');
      const start = Date.now();
      await new Promise<void>((resolve, reject) => {
        const child = spawn(serverDef.command, serverDef.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] });
        const timer = setTimeout(() => { child.kill(); resolve(); }, 2500);
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('spawn', () => { clearTimeout(timer); child.kill(); resolve(); });
      });
      return Response.json({ success: true, latencyMs: Date.now() - start });
    } catch (error: unknown) {
      return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // GET /api/mcp/oauth/callback - OAuth redirect landing
  if (path === '/api/mcp/oauth/callback' && req.method === 'GET') {
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      return new Response(`<html><body><p>OAuth error: ${oauthError}. You may close this window.</p></body></html>`, { headers: { 'Content-Type': 'text/html' } });
    }
    if (!code || !state) {
      return new Response('<html><body><p>Missing code or state.</p></body></html>', { status: 400, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('<html><body><p>Authentication complete. You may close this window and return to the app.</p></body></html>', { headers: { 'Content-Type': 'text/html' } });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
