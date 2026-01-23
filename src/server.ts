import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { config } from './config';
import { DiagramManager } from './services/diagram-manager';
import { DocumentManager } from './services/document-manager';
import { MetadataManager } from './services/metadata-manager';
import { Validator } from './services/validator';
import { Renderer } from './services/renderer';
import { WebSocketHandler } from './websocket/handler';
import { handleAPI } from './routes/api';
import { sessionRegistry } from './services/session-registry';

// Scratch session - a default workspace for casual use
const SCRATCH_PROJECT = join(homedir(), '.mermaid-collab');
const SCRATCH_SESSION = 'scratch';

// Register scratch session on startup
await sessionRegistry.register(SCRATCH_PROJECT, SCRATCH_SESSION);
console.log(`📋 Scratch session: ${SCRATCH_PROJECT}/.collab/${SCRATCH_SESSION}/`);

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

    // React UI from ui/dist/ (SPA fallback)
    if (existsSync(config.UI_DIST_DIR)) {
      // Try to serve static file from dist
      const filePath = join(config.UI_DIST_DIR, url.pathname);
      const file = Bun.file(filePath);
      const fileExists = await file.exists();

      if (fileExists) {
        const ext = url.pathname.split('.').pop() || '';
        const mimeTypes: Record<string, string> = {
          'html': 'text/html',
          'js': 'application/javascript',
          'css': 'text/css',
          'json': 'application/json',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'svg': 'image/svg+xml',
          'ico': 'image/x-icon',
          'woff': 'font/woff',
          'woff2': 'font/woff2',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        return new Response(file, {
          headers: { 'Content-Type': contentType },
        });
      }

      // SPA fallback: serve index.html for non-file routes
      const indexPath = join(config.UI_DIST_DIR, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(Bun.file(indexPath), {
          headers: { 'Content-Type': 'text/html' },
        });
      }
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
