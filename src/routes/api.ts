import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { transpile, isSmachYaml } from '../services/smach-transpiler';
import { sessionRegistry, type Session } from '../services/session-registry';
import { join } from 'path';

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
 * Create managers for a specific project+session.
 */
function createManagers(project: string, session: string) {
  const diagramsDir = sessionRegistry.resolvePath(project, session, 'diagrams');
  const documentsDir = sessionRegistry.resolvePath(project, session, 'documents');

  return {
    diagramManager: new DiagramManager(diagramsDir),
    documentManager: new DocumentManager(documentsDir),
    metadataManager: new MetadataManager(join(project, '.collab', session)),
  };
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
      return Response.json({ sessions });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  // POST /api/sessions - Register a session (called by MCP tools)
  if (path === '/api/sessions' && req.method === 'POST') {
    try {
      const { project, session } = await req.json() as { project?: string; session?: string };

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      await sessionRegistry.register(project, session);
      return Response.json({ success: true, project, session });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // DELETE /api/sessions - Unregister a session
  if (path === '/api/sessions' && req.method === 'DELETE') {
    try {
      const { project, session } = await req.json() as { project?: string; session?: string };

      if (!project || !session) {
        return Response.json({ error: 'project and session required' }, { status: 400 });
      }

      const removed = await sessionRegistry.unregister(project, session);
      return Response.json({ success: removed });
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

    const { diagramManager } = createManagers(params.project, params.session);
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
    const { diagramManager } = createManagers(params.project, params.session);
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
      await sessionRegistry.register(params.project, params.session);

      const { diagramManager } = createManagers(params.project, params.session);
      const id = await diagramManager.createDiagram(name, content);

      // Broadcast creation immediately
      wsHandler.broadcast({
        type: 'diagram_created',
        id,
        name: name + '.mmd',
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
      const { diagramManager } = createManagers(params.project, params.session);
      await diagramManager.saveDiagram(id, content);

      // Broadcast update immediately
      const diagram = await diagramManager.getDiagram(id);
      if (diagram) {
        wsHandler.broadcastToDiagram(id, {
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
      const { diagramManager } = createManagers(params.project, params.session);
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

    const { diagramManager } = createManagers(params.project, params.session);
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

    const { diagramManager } = createManagers(params.project, params.session);
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
    const { diagramManager } = createManagers(params.project, params.session);
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

    const { documentManager } = createManagers(params.project, params.session);
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
    const { documentManager } = createManagers(params.project, params.session);
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
    const { documentManager } = createManagers(params.project, params.session);
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
      await sessionRegistry.register(params.project, params.session);

      const { documentManager } = createManagers(params.project, params.session);
      const id = await documentManager.createDocument(name, content);

      wsHandler.broadcast({
        type: 'document_created',
        id,
        name: name + '.md',
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
    const { content } = await req.json() as { content?: string };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      const { documentManager } = createManagers(params.project, params.session);
      await documentManager.saveDocument(id, content);

      const document = await documentManager.getDocument(id);
      if (document) {
        wsHandler.broadcastToDocument(id, {
          type: 'document_updated',
          id,
          content: document.content,
          lastModified: document.lastModified,
          project: params.project,
          session: params.session,
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
      const { documentManager } = createManagers(params.project, params.session);
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

    const { metadataManager } = createManagers(params.project, params.session);
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
      const { metadataManager } = createManagers(params.project, params.session);
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
      const { metadataManager } = createManagers(params.project, params.session);

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

  return Response.json({ error: 'Not found' }, { status: 404 });
}
