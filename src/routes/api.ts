import type { Server } from 'bun';
import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { transpile, isSmachYaml } from '../services/smach-transpiler';

export async function handleAPI(
  req: Request,
  diagramManager: DiagramManager,
  documentManager: DocumentManager,
  metadataManager: MetadataManager,
  validator: Validator,
  renderer: Renderer,
  wsHandler: WebSocketHandler,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // GET /api/diagrams
  if (path === '/api/diagrams' && req.method === 'GET') {
    const diagrams = await diagramManager.listDiagrams();
    return Response.json({ diagrams });
  }

  // GET /api/diagram/:id
  if (path.startsWith('/api/diagram/') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const diagram = await diagramManager.getDiagram(id);

    if (!diagram) {
      return Response.json({ error: 'Diagram not found' }, { status: 404 });
    }

    return Response.json(diagram);
  }

  // POST /api/diagram (create new)
  if (path === '/api/diagram' && req.method === 'POST') {
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
      const id = await diagramManager.createDiagram(name, content);

      // Broadcast creation immediately
      wsHandler.broadcast({
        type: 'diagram_created',
        id,
        name: name + '.mmd',
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/diagram/:id (update)
  if (path.startsWith('/api/diagram/') && req.method === 'POST') {
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
      await diagramManager.saveDiagram(id, content);

      // Broadcast update immediately
      const diagram = await diagramManager.getDiagram(id);
      if (diagram) {
        wsHandler.broadcastToDiagram(id, {
          type: 'diagram_updated',
          id,
          content: diagram.content,
          lastModified: diagram.lastModified,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/diagram/:id
  if (path.startsWith('/api/diagram/') && req.method === 'DELETE') {
    const id = path.split('/').pop()!;

    try {
      await diagramManager.deleteDiagram(id);

      // Broadcast deletion immediately
      wsHandler.broadcast({
        type: 'diagram_deleted',
        id,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // GET /api/render/:id
  if (path.startsWith('/api/render/') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const theme = (url.searchParams.get('theme') || 'default') as Theme;

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

  // GET /api/thumbnail/:id
  if (path.startsWith('/api/thumbnail/') && req.method === 'GET') {
    const id = path.split('/').pop()!;

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

  // POST /api/validate
  if (path === '/api/validate' && req.method === 'POST') {
    const { content } = await req.json() as { content?: string };
    const result = await validator.validate(content || '');
    return Response.json(result);
  }

  // GET /api/transpile/:id - Get transpiled Mermaid output for SMACH diagrams
  if (path.startsWith('/api/transpile/') && req.method === 'GET') {
    const id = path.split('/').pop()!;
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

  // GET /api/documents
  if (path === '/api/documents' && req.method === 'GET') {
    const documents = await documentManager.listDocuments();
    return Response.json({ documents });
  }

  // GET /api/document/:id
  if (path.startsWith('/api/document/') && !path.includes('/clean') && req.method === 'GET') {
    const id = path.split('/').pop()!;
    const document = await documentManager.getDocument(id);

    if (!document) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json(document);
  }

  // GET /api/document/:id/clean
  if (path.match(/^\/api\/document\/[^/]+\/clean$/) && req.method === 'GET') {
    const id = path.split('/')[3];
    const content = await documentManager.getCleanContent(id);

    if (content === null) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }

    return Response.json({ content });
  }

  // POST /api/document (create new)
  if (path === '/api/document' && req.method === 'POST') {
    const { name, content } = await req.json() as { name?: string; content?: string };

    if (!name || content === undefined) {
      return Response.json({ error: 'Name and content required' }, { status: 400 });
    }

    try {
      const id = await documentManager.createDocument(name, content);

      wsHandler.broadcast({
        type: 'document_created',
        id,
        name: name + '.md',
      });

      return Response.json({ id, success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/document/:id (update)
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'POST') {
    const id = path.split('/').pop()!;
    const { content } = await req.json() as { content?: string };

    if (content === undefined) {
      return Response.json({ error: 'Content required' }, { status: 400 });
    }

    try {
      await documentManager.saveDocument(id, content);

      const document = await documentManager.getDocument(id);
      if (document) {
        wsHandler.broadcastToDocument(id, {
          type: 'document_updated',
          id,
          content: document.content,
          lastModified: document.lastModified,
        });
      }

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // DELETE /api/document/:id
  if (path.match(/^\/api\/document\/[^/]+$/) && req.method === 'DELETE') {
    const id = path.split('/').pop()!;

    try {
      await documentManager.deleteDocument(id);

      wsHandler.broadcast({
        type: 'document_deleted',
        id,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 404 });
    }
  }

  // GET /api/metadata
  if (path === '/api/metadata' && req.method === 'GET') {
    return Response.json(metadataManager.getMetadata());
  }

  // POST /api/metadata/item/:id - update item folder/locked status
  if (path.match(/^\/api\/metadata\/item\/[^/]+$/) && req.method === 'POST') {
    const id = path.split('/').pop()!;
    const updates = await req.json() as { folder?: string | null; locked?: boolean };

    try {
      await metadataManager.updateItem(id, updates);

      wsHandler.broadcast({
        type: 'metadata_updated',
        itemId: id,
        updates,
      });

      return Response.json({ success: true });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  // POST /api/metadata/folders - create/rename/delete folders
  if (path === '/api/metadata/folders' && req.method === 'POST') {
    const { action, name, newName } = await req.json() as { action: string; name?: string; newName?: string };

    try {
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
      });

      return Response.json({ success: true, folders: metadataManager.getFolders() });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
