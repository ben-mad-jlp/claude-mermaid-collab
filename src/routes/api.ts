import type { Server } from 'bun';
import { DiagramManager } from '../services/diagram-manager';
import { Validator } from '../services/validator';
import { Renderer, type Theme } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';

export async function handleAPI(
  req: Request,
  diagramManager: DiagramManager,
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
    const { name, content } = await req.json();

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
    const { content } = await req.json();

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
    const { content } = await req.json();
    const result = await validator.validate(content);
    return Response.json(result);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
