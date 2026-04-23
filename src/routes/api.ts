import { DiagramManager } from '../services/diagram-manager';
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
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { archiveSession, type ArchiveOptions } from '../mcp/tools/collab-state';
import { addLesson, listLessons, type LessonCategory } from '../mcp/tools/lessons';
import {
  listSessionTodos,
  addSessionTodo,
  updateSessionTodo,
  removeSessionTodo,
  clearCompletedSessionTodos,
  reorderSessionTodos,
} from '../mcp/tools/session-todos';
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

  // Probe the Vite dev server on its fixed port. Short timeout so health
  // stays fast even when the UI is down.
  const UI_PORT = 9102;
  let uiRunning = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const res = await fetch(`http://localhost:${UI_PORT}/`, { signal: controller.signal });
    clearTimeout(timer);
    uiRunning = res.ok;
  } catch {
    uiRunning = false;
  }

  // Get WebSocket connection count
  const connections = wsHandler.getConnectionCount();

  // Determine overall health
  const healthy = apiRunning && uiRunning;

  return Response.json({
    healthy,
    services: {
      api: { running: apiRunning, port },
      ui: { running: uiRunning, port: UI_PORT },
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
      const sessions = await sessionRegistry.list();
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

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ success: false, error: error.message }, { status: 400 });
    }
  }

  // GET /api/health - Server health check
  if (path === '/api/health' && req.method === 'GET') {
    return handleHealthCheck(wsHandler);
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
    const theme = (url.searchParams.get('theme') || 'default') as Theme;

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

    wsHandler.broadcast({
      type: 'claude_session_registered',
      claudeSessionId,
      project: params.project,
      session: params.session,
    });

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

    const ALLOWED_STATUS = new Set(['active', 'waiting', 'permission']);
    if (!claudeSessionId || !project || !session || !status || !ALLOWED_STATUS.has(status)) {
      return Response.json({ error: 'claudeSessionId, project, session, and valid status (active|waiting|permission) required' }, { status: 400 });
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

    wsHandler.broadcast({
      type: 'claude_session_status',
      claudeSessionId,
      project,
      session,
      status: status as 'active' | 'waiting' | 'permission',
      lastUpdate: Date.now(),
    });

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

  // GET /api/session-todos?project=...&session=...&includeCompleted=...
  if (path === '/api/session-todos' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const includeCompletedParam = url.searchParams.get('includeCompleted');
    const includeCompleted = includeCompletedParam === null
      ? true
      : includeCompletedParam !== 'false';

    try {
      const todos = await listSessionTodos(params.project, params.session, { includeCompleted });
      return Response.json({ todos });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/session-todos - Add a session todo
  if (path === '/api/session-todos' && req.method === 'POST') {
    try {
      const { project, session, text } = await req.json() as {
        project?: string;
        session?: string;
        text?: string;
      };

      if (!project || !session || !text) {
        return Response.json({ error: 'project, session, and text required' }, { status: 400 });
      }
      if (!text.trim()) {
        return Response.json({ error: 'text must be non-empty' }, { status: 400 });
      }

      const todo = await addSessionTodo(project, session, text);

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
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

      const result = await clearCompletedSessionTodos(project, session);

      if (result.removedCount > 0) {
        wsHandler.broadcast({
          type: 'session_todos_updated',
          project,
          session,
        });
      }

      return Response.json(result);
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
        orderedIds?: number[];
      };

      if (!project || !session || !Array.isArray(orderedIds)) {
        return Response.json({ error: 'project, session, and orderedIds required' }, { status: 400 });
      }

      const todos = await reorderSessionTodos(project, session, orderedIds);

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
      });

      return Response.json({ todos });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // PATCH /api/session-todos/:id - Update a session todo
  const sessionTodosPatchMatch = path.match(/^\/api\/session-todos\/(\d+)$/);
  if (sessionTodosPatchMatch && req.method === 'PATCH') {
    try {
      const { project, session, text, completed, order } = await req.json() as {
        project?: string;
        session?: string;
        text?: string;
        completed?: boolean;
        order?: number;
      };

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }
      if (text !== undefined && !text.trim()) {
        return Response.json({ error: 'text must be non-empty' }, { status: 400 });
      }

      const id = parseInt(sessionTodosPatchMatch[1], 10);
      const todo = await updateSessionTodo(project, session, id, { text, completed, order });

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project,
        session,
      });

      return Response.json({ todo });
    } catch (error: any) {
      const status = error.message === 'Todo not found' ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
  }

  // DELETE /api/session-todos/:id?project=...&session=...
  const sessionTodosDeleteMatch = path.match(/^\/api\/session-todos\/(\d+)$/);
  if (sessionTodosDeleteMatch && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = parseInt(sessionTodosDeleteMatch[1], 10);

    try {
      const todo = await removeSessionTodo(params.project, params.session, id);

      wsHandler.broadcast({
        type: 'session_todos_updated',
        project: params.project,
        session: params.session,
      });

      return Response.json({ todo });
    } catch (error: any) {
      const status = error.message === 'Todo not found' ? 404 : 500;
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

      // Create PTY session via ptyManager with project as cwd
      await ptyManager.create(id, { cwd: project });

      // Create session record for persistence
      const newSession = {
        id,
        name: displayName,
        tmuxSession: id, // Use same ID (no tmux, but keep field for compatibility)
        created: new Date().toISOString(),
        order: state.sessions.length,
      };

      // Add to sessions array and persist
      state.sessions.push(newSession);
      await terminalManager.writeSessions(project, session, state);

      // Return session info with 201 Created status
      return Response.json({
        id,
        tmuxSession: id,
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
