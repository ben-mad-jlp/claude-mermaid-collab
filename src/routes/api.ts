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
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

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
      const { project: rawProject, session } = await req.json() as { project?: string; session?: string };

      if (!rawProject || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      // Expand ~ to home directory
      const project = expandPath(rawProject);

      const result = await sessionRegistry.register(project, session);
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
      return Response.json(state);
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

  // GET /api/diagram/:id?project=...&session=...
  if (path.startsWith('/api/diagram/') && req.method === 'GET') {
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
        name: name + '.mmd',
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
      await diagramManager.saveDiagram(id, content);

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

    const { documentManager } = await createManagers(params.project, params.session);
    const documents = await documentManager.listDocuments();
    return Response.json({ documents });
  }

  // GET /api/document/:id?project=...&session=...
  if (path.startsWith('/api/document/') && !path.includes('/clean') && req.method === 'GET') {
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
        name: name + '.md',
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
      await documentManager.saveDocument(id, content);

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

      // If non-blocking mode, return immediately
      if (blocking === false) {
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
  // Terminal Session Management
  // ============================================

  // POST /api/terminal/kill-session - Kill a tmux session
  if (path === '/api/terminal/kill-session' && req.method === 'POST') {
    try {
      const { sessionName } = await req.json() as { sessionName?: string };

      if (!sessionName) {
        return Response.json({ error: 'sessionName required' }, { status: 400 });
      }

      // Validate session name format (must start with our prefix)
      if (!sessionName.startsWith('mc-')) {
        return Response.json({ error: 'Invalid session name' }, { status: 400 });
      }

      // Kill the tmux session
      const proc = Bun.spawn(['tmux', 'kill-session', '-t', sessionName], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;

      // Success even if session didn't exist (idempotent)
      return Response.json({ success: true, sessionName });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/terminal/cleanup - Kill all orphaned mc-* tmux sessions
  if (path === '/api/terminal/cleanup' && req.method === 'POST') {
    try {
      const { activeSessions = [] } = await req.json() as { activeSessions?: string[] };

      // List all tmux sessions
      const listProc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = await new Response(listProc.stdout).text();
      await listProc.exited;

      // Find mc-* sessions that aren't in the active list
      const allSessions = output.trim().split('\n').filter(s => s.startsWith('mc-'));
      const orphaned = allSessions.filter(s => !activeSessions.includes(s));

      // Kill orphaned sessions
      for (const sessionName of orphaned) {
        const killProc = Bun.spawn(['tmux', 'kill-session', '-t', sessionName], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await killProc.exited;
      }

      return Response.json({ success: true, killed: orphaned, kept: activeSessions.filter(s => allSessions.includes(s)) });
    } catch (error: any) {
      // tmux might not be running or no sessions exist
      return Response.json({ success: true, killed: [], kept: [] });
    }
  }

  // ============================================
  // Terminal Session Management (MCP-backed)
  // ============================================

  // GET /api/terminal/sessions?project=...&session=...
  if (path === '/api/terminal/sessions' && req.method === 'GET') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { terminalListSessions } = await import('../mcp/tools/terminal-sessions.js');
      const result = await terminalListSessions(params.project, params.session);
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/terminal/sessions
  if (path === '/api/terminal/sessions' && req.method === 'POST') {
    try {
      const { project, session, name } = await req.json() as { project?: string; session?: string; name?: string };

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      const { terminalCreateSession } = await import('../mcp/tools/terminal-sessions.js');
      const result = await terminalCreateSession(project, session, name);
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // DELETE /api/terminal/sessions/:id
  if (path.startsWith('/api/terminal/sessions/') && !path.includes('/reorder') && req.method === 'DELETE') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;

    try {
      const { terminalKillSession } = await import('../mcp/tools/terminal-sessions.js');
      const result = await terminalKillSession(params.project, params.session, id);
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // PATCH /api/terminal/sessions/:id
  if (path.startsWith('/api/terminal/sessions/') && !path.includes('/reorder') && req.method === 'PATCH') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    const id = path.split('/').pop()!;
    const { name } = await req.json() as { name?: string };

    try {
      const { terminalRenameSession } = await import('../mcp/tools/terminal-sessions.js');
      const result = await terminalRenameSession(params.project, params.session, id, name || '');
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // PUT /api/terminal/sessions/reorder
  if (path === '/api/terminal/sessions/reorder' && req.method === 'PUT') {
    const params = getSessionParams(url);
    if (!params) {
      return Response.json({ error: 'project and session query params required' }, { status: 400 });
    }

    try {
      const { orderedIds } = await req.json() as { orderedIds?: string[] };

      if (!orderedIds) {
        return Response.json({ error: 'orderedIds required' }, { status: 400 });
      }

      const { terminalReorderSessions } = await import('../mcp/tools/terminal-sessions.js');
      const result = await terminalReorderSessions(params.project, params.session, orderedIds);
      return Response.json(result);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
