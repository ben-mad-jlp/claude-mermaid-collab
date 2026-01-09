import { mkdir } from 'fs/promises';
import { config } from './config';
import { DiagramManager } from './services/diagram-manager';
import { Validator } from './services/validator';
import { Renderer } from './services/renderer';
import { FileWatcher } from './services/file-watcher';
import { WebSocketHandler } from './websocket/handler';
import { handleAPI } from './routes/api';

// Initialize services
const diagramManager = new DiagramManager();
const validator = new Validator();
const renderer = new Renderer();
const fileWatcher = new FileWatcher();
const wsHandler = new WebSocketHandler();

// Ensure diagrams folder exists
await mkdir(config.DIAGRAMS_FOLDER, { recursive: true });

// Initialize diagram manager
await diagramManager.initialize();

// Set up file watcher
fileWatcher.onChange((event) => {
  if (event.type === 'created') {
    diagramManager.updateIndex(event.id, event.path);
    wsHandler.broadcast({
      type: 'diagram_created',
      id: event.id,
      name: event.id + '.mmd',
    });
  } else if (event.type === 'modified') {
    diagramManager.updateIndex(event.id, event.path);
    diagramManager.getDiagram(event.id).then((diagram) => {
      if (diagram) {
        wsHandler.broadcastToDiagram(event.id, {
          type: 'diagram_updated',
          id: event.id,
          content: diagram.content,
          lastModified: diagram.lastModified,
        });
      }
    });
  } else if (event.type === 'deleted') {
    diagramManager.removeFromIndex(event.id);
    wsHandler.broadcast({
      type: 'diagram_deleted',
      id: event.id,
    });
  }
});

fileWatcher.start();

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
      return handleAPI(req, diagramManager, validator, renderer);
    }

    // Static files (will add in next task)
    if (url.pathname === '/') {
      return new Response('Dashboard coming soon', {
        headers: { 'Content-Type': 'text/plain' },
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
console.log(`📁 Diagrams folder: ${config.DIAGRAMS_FOLDER}`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${config.PORT}/ws`);
