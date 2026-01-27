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
import { handleKodexAPI } from './routes/kodex-api';
import { sessionRegistry } from './services/session-registry';
import { statusManager } from './services/status-manager';
import { initializeWebSocketHandler } from './services/ws-handler-manager';
import { handleMCPRequest, getActiveSessionCount } from './mcp/http-handler';
import {
  handleTerminalConnection,
  handleTerminalMessage,
  handleTerminalDisconnection,
} from './services/terminal-ws-server';

// Scratch session - a default workspace for casual use
const SCRATCH_PROJECT = join(homedir(), '.mermaid-collab');
const SCRATCH_SESSION = 'scratch';

// Register scratch session on startup
await sessionRegistry.register(SCRATCH_PROJECT, SCRATCH_SESSION);
console.log(`📋 Scratch session: ${SCRATCH_PROJECT}/.collab/sessions/${SCRATCH_SESSION}/`);

// Initialize shared services (stateless, no storage)
const validator = new Validator();
const renderer = new Renderer();
const wsHandler = new WebSocketHandler();

// Initialize WebSocket handler manager for global access
initializeWebSocketHandler(wsHandler);

// Initialize status manager with WebSocket handler
statusManager.setWebSocketHandler(wsHandler);

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

    // WebSocket upgrade for collaboration
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: { type: 'collab', subscriptions: new Set<string>() },
      });

      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // WebSocket upgrade for terminal
    if (url.pathname === '/terminal') {
      const session = url.searchParams.get('session') || 'default';
      const upgraded = server.upgrade(req, {
        data: { type: 'terminal', tmuxSession: session },
      });

      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // MCP Streamable HTTP transport (protocol version 2025-03-26)
    if (url.pathname === '/mcp') {
      return handleMCPRequest(req);
    }

    // Kodex API routes
    if (url.pathname.startsWith('/api/kodex')) {
      return handleKodexAPI(req);
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPI(req, diagramManager, documentManager, metadataManager, validator, renderer, wsHandler);
    }

    // React UI from ui/dist/ (primary UI)
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
      const data = ws.data as { type: string; tmuxSession?: string };

      if (data.type === 'terminal') {
        // Terminal WebSocket connection
        handleTerminalConnection(ws, data.tmuxSession || 'default');
      } else {
        // Collab WebSocket connection
        wsHandler.handleConnection(ws);
        ws.send(JSON.stringify({
          type: 'connected',
          diagramCount: wsHandler.getConnectionCount(),
        }));
      }
    },

    message(ws, message) {
      const data = ws.data as { type: string };

      if (data.type === 'terminal') {
        handleTerminalMessage(ws, message.toString());
      } else {
        wsHandler.handleMessage(ws, message.toString());
      }
    },

    close(ws) {
      const data = ws.data as { type: string };

      if (data.type === 'terminal') {
        handleTerminalDisconnection(ws);
      } else {
        wsHandler.handleDisconnection(ws);
      }
    },
  },
});

console.log(`🚀 Mermaid Collaboration Server running on http://${config.HOST}:${config.PORT}`);
console.log(`🌐 Public directory: ${config.PUBLIC_DIR}`);
console.log(`🎨 UI dist directory: ${config.UI_DIST_DIR} (exists: ${existsSync(config.UI_DIST_DIR)})`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${config.PORT}/ws`);
console.log(`🤖 MCP HTTP: http://${config.HOST}:${config.PORT}/mcp`);
