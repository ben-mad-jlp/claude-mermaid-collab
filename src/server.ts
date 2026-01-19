import { join } from 'path';
import { config } from './config';
import { DiagramManager } from './services/diagram-manager';
import { DocumentManager } from './services/document-manager';
import { MetadataManager } from './services/metadata-manager';
import { Validator } from './services/validator';
import { Renderer } from './services/renderer';
import { WebSocketHandler } from './websocket/handler';
import { handleAPI } from './routes/api';

// Initialize shared services (stateless, no storage)
const validator = new Validator();
const renderer = new Renderer();
const wsHandler = new WebSocketHandler();

// Placeholder managers - these are created per-session in api.ts
// but we need them for the handleAPI signature (they're unused there now)
const diagramManager = new DiagramManager('/tmp');
const documentManager = new DocumentManager('/tmp');
const metadataManager = new MetadataManager('/tmp');

// Create HTTP server
const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: { subscriptions: new Set<string>() },
      });

      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(req, diagramManager, documentManager, metadataManager, validator, renderer, wsHandler);
    }

    // Static files (served from the server's public/ directory, not cwd)
    if (url.pathname === '/') {
      const file = Bun.file(join(config.PUBLIC_DIR, 'index.html'));
      return new Response(file);
    }

    if (url.pathname === '/diagram.html') {
      const file = Bun.file(join(config.PUBLIC_DIR, 'diagram.html'));
      return new Response(file);
    }

    if (url.pathname === '/document.html') {
      const file = Bun.file(join(config.PUBLIC_DIR, 'document.html'));
      return new Response(file);
    }

    if (url.pathname === '/smach-test.html') {
      const file = Bun.file(join(config.PUBLIC_DIR, 'smach-test.html'));
      return new Response(file);
    }

    if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
      const file = Bun.file(join(config.PUBLIC_DIR, url.pathname));
      const exists = await file.exists();

      if (!exists) {
        return new Response('Not found', { status: 404 });
      }

      const contentType = url.pathname.endsWith('.css')
        ? 'text/css'
        : url.pathname.endsWith('.js')
        ? 'application/javascript'
        : 'text/plain';

      return new Response(file, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    open(ws) {
      wsHandler.handleConnection(ws);
      ws.send(JSON.stringify({
        type: 'connected',
        diagramCount: wsHandler.getConnectionCount(),
      }));
    },

    message(ws, message) {
      wsHandler.handleMessage(ws, message.toString());
    },

    close(ws) {
      wsHandler.handleDisconnection(ws);
    },
  },
});

console.log(`🚀 Mermaid Collaboration Server running on http://${config.HOST}:${config.PORT}`);
console.log(`🌐 Public directory: ${config.PUBLIC_DIR}`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${config.PORT}/ws`);
