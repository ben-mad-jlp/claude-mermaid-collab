import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
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
import { getDisplayName } from '../mcp/workflow/state-machine';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { archiveSession, type ArchiveOptions } from '../mcp/tools/collab-state';
import { addLesson, listLessons, type LessonCategory } from '../mcp/tools/lessons';
import {
  listWireframesHandler,
  createWireframeHandler,
  getWireframeHandler,
  updateWireframeHandler,
} from '../api/wireframe-routes';
import { WireframeRenderer as WireframeSVGRenderer } from '../services/wireframe-renderer';
import { WireframeValidator } from '../services/wireframe-validator';
import {
  parseTaskGraph,
  buildBatches,
  type TaskGraphTask,
} from '../mcp/workflow/task-sync';

// Single shared validator instance
const wireframeValidator = new WireframeValidator();

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
  const port = parseInt(process.env.PORT || '3737', 10);

  // Check UI status by trying to serve index.html
  let uiRunning = false;
  try {
    const indexPath = join(process.cwd(), 'ui', 'dist', 'index.html');
    const indexFile = Bun.file(indexPath);
    uiRunning = await indexFile.exists();
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
      ui: { running: uiRunning },
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

  const diagramManager = new DiagramManager(diagramsDir);
  const documentManager = new DocumentManager(documentsDir);
  const metadataManager = new MetadataManager(join(project, '.collab', session));

  // Initialize managers (creates directories, builds index)
  await diagramManager.initialize();
  await documentManager.initialize();

  return { diagramManager, documentManager, metadataManager };
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
      const { project: rawProject, session, sessionType } = await req.json() as {
        project?: string;
        session?: string;
        sessionType?: 'structured' | 'vibe';
      };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      const result = await sessionRegistry.register(project, session, sessionType);
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

      // Compute displayName from state if available
      if (state.state && !state.displayName) {
        state.displayName = getDisplayName(state.state);
      }
      // Fallback: use phase as displayName for older sessions without state
      // Try getDisplayName first (handles vibe-active -> Vibing), then capitalize
      else if (!state.state && state.phase && !state.displayName) {
        const lookup = getDisplayName(state.phase);
        // If getDisplayName returned the same value (no mapping found), capitalize it
        state.displayName = lookup !== state.phase
          ? lookup
          : state.phase.charAt(0).toUpperCase() + state.phase.slice(1);
      }

      return Response.json(state);
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
      // Read task-graph.md document
      const documentsPath = sessionRegistry.resolvePath(project, session, 'documents');
      const taskGraphPath = join(documentsPath, 'task-graph.md');
      const taskGraphFile = Bun.file(taskGraphPath);

      if (!await taskGraphFile.exists()) {
        // No task graph yet - return empty state
        return Response.json({
          diagram: null,
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        });
      }

      const content = await taskGraphFile.text();

      // Parse the task graph
      let tasks: TaskGraphTask[] = [];
      try {
        const taskGraph = parseTaskGraph(content);
        tasks = taskGraph.tasks;
      } catch {
        // Parsing failed - return empty state
        return Response.json({
          diagram: null,
          batches: [],
          completedTasks: [],
          pendingTasks: [],
        });
      }

      // Build batches
      const batches = buildBatches(tasks);

      // Generate Mermaid diagram
      const waveColors = ['#c8e6c9', '#bbdefb', '#fff3e0', '#f3e5f5', '#ffccbc'];
      const mermaidLines: string[] = ['graph TD'];

      // Add nodes
      for (const task of tasks) {
        const shortDesc = task.description.substring(0, 30) + (task.description.length > 30 ? '...' : '');
        mermaidLines.push(`    ${task.id}["${task.id}<br/>${shortDesc}"]`);
      }

      mermaidLines.push('');

      // Add edges based on dependencies
      for (const task of tasks) {
        const deps = task['depends-on'] || [];
        for (const dep of deps) {
          mermaidLines.push(`    ${dep} --> ${task.id}`);
        }
      }

      mermaidLines.push('');

      // Get session state for completed/pending tasks
      const stateFile = Bun.file(join(project, '.collab', 'sessions', session, 'collab-state.json'));
      let completedTasks: string[] = [];
      let pendingTasks: string[] = [];

      if (await stateFile.exists()) {
        try {
          const stateContent = await stateFile.text();
          const state = JSON.parse(stateContent);
          completedTasks = state.completedTasks || [];
          pendingTasks = state.pendingTasks || [];
        } catch {
          // Failed to read state, continue with empty arrays
        }
      }

      const completedSet = new Set(completedTasks);

      // Add styles based on wave and completion status
      batches.forEach((batch, waveIndex) => {
        const waveColor = waveColors[waveIndex % waveColors.length];
        for (const task of batch.tasks) {
          if (completedSet.has(task.id)) {
            // Completed tasks get green with darker border
            mermaidLines.push(`    style ${task.id} fill:#4caf50,stroke:#2e7d32,color:#fff`);
          } else {
            mermaidLines.push(`    style ${task.id} fill:${waveColor}`);
          }
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

  // ============================================
  // Session-scoped routes (require project + session params)
  // ============================================

  // GET /api/diagrams?project=...&session=...
  if (path === '/api/diagrams' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const { diagramManager } = await createManagers(params.project, params.session);
    const diagrams = await diagramManager.listDiagrams();
    return Response.json({ diagrams });
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
  // Wireframe Routes
  // ============================================

  // GET /api/wireframes?project=...&session=...
  if (path === '/api/wireframes' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const mockRes = {
        json: (data: any) => Response.json(data),
      };
      return await listWireframesHandler({ query: params }, mockRes);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/wireframe?project=...&session=... (create new)
  if (path === '/api/wireframe' && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { name, content } = await req.json();

      if (!name || !content) {
        return Response.json({ error: 'Name and content required' }, { status: 400 });
      }

      // Validate wireframe structure before saving
      const validation = wireframeValidator.validate(content);
      if (!validation.valid) {
        return Response.json({
          success: false,
          error: validation.error,
          path: validation.path,
        }, { status: 400 });
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
      // Create a mock request with pre-parsed JSON
      const mockReq = {
        query: params,
        json: async () => ({ name, content }),
      };
      const response = await createWireframeHandler(mockReq, mockRes);

      // Broadcast wireframe creation if successful
      if (capturedData && capturedData.success && capturedData.id) {
        wsHandler.broadcast({
          type: 'wireframe_created',
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

  // GET /api/wireframe/:id/history?project=...&session=...
  if (path.match(/^\/api\/wireframe\/[^/]+\/history$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/')[3];

    try {
      const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
      const updateLogManager = new UpdateLogManager(sessionPath);
      const history = await updateLogManager.getHistory('wireframes', id);

      // Return empty history if none exists (not a 404 - the item exists, just no changes yet)
      if (!history) {
        return Response.json({ original: null, changes: [] });
      }

      return Response.json({ original: history.original, changes: history.changes });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/wireframe/:id/version?project=...&session=...&timestamp=...
  if (path.match(/^\/api\/wireframe\/[^/]+\/version$/) && req.method === 'GET') {
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
      const content = await updateLogManager.replayToTimestamp('wireframes', id, timestamp);

      return Response.json({ content, timestamp });
    } catch (error: any) {
      if (error.message.includes('No history found')) {
        return Response.json({ error: error.message }, { status: 404 });
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // GET /api/wireframe/:id?project=...&session=...
  if (path.startsWith('/api/wireframe/') && !path.endsWith('/render') && !path.includes('/history') && !path.includes('/version') && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const mockRes = {
        status: (code: number) => ({
          json: (data: any) => Response.json(data, { status: code }),
        }),
        json: (data: any) => Response.json(data),
      };
      return await getWireframeHandler({ query: { ...params, id } }, mockRes);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // POST /api/wireframe/:id?project=...&session=... (update)
  if (path.startsWith('/api/wireframe/') && !path.endsWith('/render') && req.method === 'POST') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const { content } = await req.json();

      if (!content) {
        return Response.json({ error: 'Content required' }, { status: 400 });
      }

      // Validate wireframe structure before saving
      const validation = wireframeValidator.validate(content);
      if (!validation.valid) {
        return Response.json({
          success: false,
          error: validation.error,
          path: validation.path,
        }, { status: 400 });
      }

      // Get old content before saving (for history logging)
      let oldContent = '';
      try {
        const wireframePath = join(params.project, '.collab', 'sessions', params.session, 'wireframes', `${id}.wireframe.json`);
        const wireframeFile = Bun.file(wireframePath);
        if (await wireframeFile.exists()) {
          oldContent = await wireframeFile.text();
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
      // Create a mock request with pre-parsed JSON
      const mockReq = {
        query: { ...params, id },
        json: async () => ({ content }),
      };
      const response = await updateWireframeHandler(mockReq, mockRes);

      // Broadcast wireframe update if successful
      if (capturedData && capturedData.success) {
        // Log the update (don't fail the request if logging fails)
        try {
          const sessionPath = sessionRegistry.resolvePath(params.project, params.session, '.');
          const updateLogManager = new UpdateLogManager(sessionPath);
          const newContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          await updateLogManager.logUpdate('wireframes', id, oldContent, newContent);

          // Get updated change count for broadcast
          const history = await updateLogManager.getHistory('wireframes', id);
          const changeCount = history?.changes.length ?? 0;

          // Broadcast history update if there's history
          if (changeCount > 0) {
            wsHandler.broadcast({
              type: 'wireframe_history_updated',
              id,
              project: params.project,
              session: params.session,
              changeCount,
            });
          }
        } catch (logError) {
          // Log error but don't fail the request - history is supplementary
          console.warn('Failed to log wireframe update:', logError);
        }

        wsHandler.broadcast({
          type: 'wireframe_updated',
          id,
          project: params.project,
          session: params.session,
        });
      }

      return response;
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/wireframe/:id?project=...&session=...
  if (path.match(/^\/api\/wireframe\/[^/]+$/) && !path.includes('/render') && !path.includes('/history') && !path.includes('/version') && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const wireframePath = join(params.project, '.collab', 'sessions', params.session, 'wireframes', `${id}.wireframe.json`);
      const wireframeFile = Bun.file(wireframePath);

      if (!await wireframeFile.exists()) {
        return Response.json({ error: 'Wireframe not found' }, { status: 404 });
      }

      // Delete the file
      const { unlink } = await import('fs/promises');
      await unlink(wireframePath);

      // Broadcast deletion
      wsHandler.broadcast({
        type: 'wireframe_deleted',
        id,
        project: params.project,
        session: params.session,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // GET /api/wireframe/:id/render?project=...&session=... - Render wireframe as SVG image
  if (path.match(/^\/api\/wireframe\/[^/]+\/render$/) && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    // Extract id from path (between /wireframe/ and /render)
    const pathParts = path.split('/');
    const id = pathParts[3];
    const scale = parseFloat(url.searchParams.get('scale') || '1') || 1;

    try {
      // Read wireframe directly from file
      const wireframePath = join(params.project, '.collab', 'sessions', params.session, 'wireframes', `${id}.wireframe.json`);
      const wireframeFile = Bun.file(wireframePath);

      if (!await wireframeFile.exists()) {
        return Response.json({ error: 'Wireframe not found' }, { status: 404 });
      }

      const wireframeContent = await wireframeFile.json();

      // Render to SVG
      const wireframeRenderer = new WireframeSVGRenderer();
      const svg = wireframeRenderer.renderToSVG(wireframeContent, scale);

      return new Response(svg, {
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
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

  // POST /api/wireframe/validate (no session required - validates structure only)
  if (path === '/api/wireframe/validate' && req.method === 'POST') {
    const { content } = await req.json() as { content?: any };
    const result = wireframeValidator.validate(content);
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

    const { documentManager } = await createManagers(params.project, params.session);
    const documents = await documentManager.listDocuments();
    return Response.json({ documents });
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
      const { documentManager } = await createManagers(params.project, params.session);

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
    const updates = await req.json() as { folder?: string | null; locked?: boolean };

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
        type: 'ui_render',
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
        wsUrl: `ws://localhost:3737/terminal/${id}`,
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

  return Response.json({ error: 'Not found' }, { status: 404 });
}
