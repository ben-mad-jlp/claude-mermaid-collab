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
import { AgentSessionRegistry } from './agent/session-registry';
import { AgentDispatcher } from './agent/dispatcher';
import { CheckpointStore } from './agent/checkpoint-store';
import { CheckpointReactor } from './agent/checkpoint-reactor';
import { createGitOps } from './agent/git-ops';
import { userInputBridge } from './agent/user-input-bridge';
import { initializeAgentRegistry } from './agent/agent-registry-manager';
import { handleAPI } from './routes/api';
import { handlePseudoAPI } from './routes/pseudo-api';
import { handleCodeAPI } from './routes/code-api.js';
import { handleOnboardingAPI } from './routes/onboarding-api';
import { handleAttachments } from './routes/agent-attachments';
import { handleEditorRoundtrip } from './routes/editor-roundtrip';
import { handleAgentSessionsAPI } from './routes/agent-sessions';
import { handleWorktreeDiffAPI } from './routes/worktree-diff';
import { handleWorktreeFilesAPI } from './routes/worktree-files';
import { sessionRegistry, SessionRegistryCorruptError } from './services/session-registry';
import { statusManager } from './services/status-manager';
import { initializeWebSocketHandler } from './services/ws-handler-manager';
import { handleMCPRequest, getActiveSessionCount } from './mcp/http-handler';
import {
  handleTerminalOpen,
  handleTerminalMessage,
  handleTerminalClose,
  handleTerminalError,
} from './routes/websocket';

// Scratch session - a default workspace for casual use
const SCRATCH_PROJECT = join(homedir(), '.mermaid-collab');
const SCRATCH_SESSION = 'scratch';

// Register scratch session on startup.
// This MUST be idempotent and non-fatal on corrupt registry — otherwise
// the very first thing every boot does is a destructive read-modify-write
// that can wipe sessions.json if the file is transiently unreadable.
try {
  const startupResult = await sessionRegistry.registerIfAbsent(SCRATCH_PROJECT, SCRATCH_SESSION);
  if (startupResult.alreadyPresent) {
    console.log(`📋 Scratch session (already registered): ${SCRATCH_PROJECT}/.collab/sessions/${SCRATCH_SESSION}/`);
  } else {
    console.log(`📋 Scratch session: ${SCRATCH_PROJECT}/.collab/sessions/${SCRATCH_SESSION}/`);
  }
} catch (error) {
  if (error instanceof SessionRegistryCorruptError) {
    console.error('');
    console.error('!!! SESSION REGISTRY IS CORRUPT !!!');
    console.error(error.message);
    console.error('Server startup will continue, but session registration is disabled until this is resolved.');
    console.error('');
  } else {
    console.error('Failed to register scratch session on startup:', error);
  }
}

// Initialize shared services (stateless, no storage)
const validator = new Validator();
const renderer = new Renderer();
const wsHandler = new WebSocketHandler();

// Initialize WebSocket handler manager for global access
initializeWebSocketHandler(wsHandler);

// Initialize status manager with WebSocket handler
statusManager.setWebSocketHandler(wsHandler);

// Initialize agent chat session registry + dispatcher.
const agentRegistry = new AgentSessionRegistry({
  broadcast: (msg) => wsHandler.broadcastToChannel(msg.channel, msg as any),
  persistDir: join(process.cwd(), '.collab', 'agent-sessions'),
});
initializeAgentRegistry(agentRegistry);
const checkpointStore = new CheckpointStore(join(process.cwd(), '.collab', 'agent-checkpoints.db'));
const gitOps = createGitOps();
const checkpointReactor = new CheckpointReactor(gitOps, checkpointStore, agentRegistry.getEventLog());
const agentDispatcher = new AgentDispatcher({
  registry: agentRegistry,
  wsHandler,
  resolvedCwd: process.cwd(),
  userInputBridge,
  gitOps,
  checkpointStore,
  eventLog: agentRegistry.getEventLog(),
  reactor: checkpointReactor,
});
wsHandler.setAgentDispatcher(agentDispatcher);

// Placeholder managers - these are created per-session in api.ts
// but we need them for the handleAPI signature (they're unused there now)
const diagramManager = new DiagramManager('/tmp');
const documentManager = new DocumentManager('/tmp');
const metadataManager = new MetadataManager('/tmp');

// Create HTTP server
type WsData = { type: string; sessionId?: string; subscriptions: Set<string> };
const server = Bun.serve<WsData>({
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

    // WebSocket upgrade for terminal (PTY-based)
    // Supports: /terminal/:sessionId
    if (url.pathname.startsWith('/terminal/')) {
      // Extract session ID from path: /terminal/:sessionId
      const sessionId = url.pathname.slice('/terminal/'.length).split('/')[0] || null;

      if (!sessionId) {
        return new Response('Missing session ID in path', { status: 400 });
      }

      const upgraded = server.upgrade(req, {
        data: { type: 'terminal', sessionId, subscriptions: new Set<string>() },
      });

      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // MCP Streamable HTTP transport (protocol version 2025-03-26)
    if (url.pathname === '/mcp') {
      return handleMCPRequest(req);
    }

    // Pseudo API routes
    if (url.pathname.startsWith('/api/pseudo')) {
      return handlePseudoAPI(req);
    }

    // Code API routes
    if (url.pathname.startsWith('/api/code')) {
      return handleCodeAPI(req);
    }

    // Onboarding API routes
    if (url.pathname.startsWith('/api/onboarding')) {
      return handleOnboardingAPI(req);
    }

    if (url.pathname.startsWith('/api/agent/attachments')) {
      const res = await handleAttachments(req, url, { registry: agentRegistry });
      if (res) return res;
    }
    if (url.pathname.startsWith('/api/agent/editor-')) {
      const res = await handleEditorRoundtrip(req, url);
      if (res) return res;
    }
    if (url.pathname.startsWith('/api/agent/sessions')) {
      return handleAgentSessionsAPI(req);
    }
    if (url.pathname.startsWith('/api/agent/worktree-diff')) {
      return handleWorktreeDiffAPI(req);
    }
    if (url.pathname.startsWith('/api/worktree/files')) {
      return handleWorktreeFilesAPI(req);
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
          'ttf': 'font/ttf',
          'otf': 'font/otf',
          'wasm': 'application/wasm',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        return new Response(file, {
          headers: { 'Content-Type': contentType },
        });
      }

      // SPA fallback: serve index.html for non-file routes
      // Don't serve HTML for static asset requests (prevents MIME type errors
      // when browser requests stale chunk filenames after a rebuild)
      const isStaticAsset = /\.(js|css|map|json|png|jpg|jpeg|svg|ico|woff2?|ttf|otf|eot|wasm)$/i.test(url.pathname);
      if (!isStaticAsset) {
        const indexPath = join(config.UI_DIST_DIR, 'index.html');
        if (existsSync(indexPath)) {
          return new Response(Bun.file(indexPath), {
            headers: { 'Content-Type': 'text/html' },
          });
        }
      }
    }

    return new Response('Not found', { status: 404 });
  },

  websocket: {
    open(ws) {
      const data = ws.data as { type: string; sessionId?: string };

      if (data.type === 'terminal') {
        // Terminal WebSocket connection - PTY-based handler extracts sessionId from ws.data
        handleTerminalOpen(ws as any);
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
        handleTerminalMessage(ws as any, message);
      } else {
        wsHandler.handleMessage(ws, message.toString());
      }
    },

    close(ws) {
      const data = ws.data as { type: string };

      if (data.type === 'terminal') {
        try {
          handleTerminalClose(ws as any);
        } catch (error) {
          // Surface unexpected close-time errors through the terminal error path
          handleTerminalError(ws as any, error instanceof Error ? error : new Error(String(error)));
        }
      } else {
        wsHandler.handleDisconnection(ws);
      }
    },
  },
});

// Initialize PTY manager and register shutdown handlers
import { ptyManager } from './terminal/index';

// Handle graceful shutdown - kill all PTY sessions
process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  ptyManager.killAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  ptyManager.killAll();
  process.exit(0);
});

console.log(`🚀 Mermaid Collaboration Server running on http://${config.HOST}:${config.PORT}`);
console.log(`🌐 Public directory: ${config.PUBLIC_DIR}`);
console.log(`🎨 UI dist directory: ${config.UI_DIST_DIR} (exists: ${existsSync(config.UI_DIST_DIR)})`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${config.PORT}/ws`);
console.log(`🔌 Terminal: ws://${config.HOST}:${config.PORT}/terminal/:sessionId`);
console.log(`🤖 MCP HTTP: http://${config.HOST}:${config.PORT}/mcp`);

