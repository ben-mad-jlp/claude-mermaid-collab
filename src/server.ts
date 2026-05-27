import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { config } from './config';
import { PORT_REQUEST, MERMAID_PROJECT, MERMAID_SESSION, MC_BROWSER_TARGET, MERMAID_CHROME_PATH, MERMAID_BROWSER_HEADLESS } from './config';
import { checkAuth } from './auth';
import { writeInstance, removeInstance, deriveSessionId, installSignalHandlers } from './services/instance-discovery';
import { SERVER_VERSION } from './mcp/server';
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
import { handleFileContentAPI } from './routes/file-content.js';
import { handleOnboardingAPI } from './routes/onboarding-api';
import { handleAttachments } from './routes/agent-attachments';
import { handleEditorRoundtrip } from './routes/editor-roundtrip';
import { handleAgentSessionsAPI } from './routes/agent-sessions';
import { handleWorktreeDiffAPI } from './routes/worktree-diff';
import { handleWorktreeFilesAPI } from './routes/worktree-files';
import { handleArtifactAPI } from './routes/artifact-api.js';
import { handleIdeRoutes } from './routes/ide-routes.js';
import { handleBrowserRoutes } from './routes/browser-routes.js';
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
import { BindingSweeper } from './services/binding-sweeper.ts';

// Scratch session - a default workspace for casual use
const SCRATCH_PROJECT = join(homedir(), '.mermaid-collab');
const SCRATCH_SESSION = 'scratch';

// Close any browser tabs left open from a previous server run
try {
  const { closePersistedTabs, CDP_PORT } = await import('./services/cdp-session.js');
  await closePersistedTabs(CDP_PORT);
} catch {}

// Owned-chrome mode (Phase 7): on remote/headless boxes the server spawns and
// owns its own Chrome on CDP_PORT so the browser_* tools work without any
// cross-network CDP. Non-fatal on failure — tools just error until it's up.
let chromeManager: import('./services/chrome-manager').ChromeManager | null = null;
if (MC_BROWSER_TARGET === 'owned-chrome') {
  try {
    const { ChromeManager } = await import('./services/chrome-manager.js');
    const { CDP_PORT } = await import('./config.js');
    const headless = MERMAID_BROWSER_HEADLESS || (process.platform === 'linux' && !process.env.DISPLAY);
    chromeManager = new ChromeManager({
      cdpPort: CDP_PORT,
      headless,
      chromePath: MERMAID_CHROME_PATH || undefined,
    });
    await chromeManager.start();
    console.log(`🌐 owned Chrome ready on CDP ${CDP_PORT}${headless ? ' (headless)' : ''}`);
  } catch (err) {
    console.error(`mermaid-collab: owned-chrome start failed — ${err instanceof Error ? err.message : String(err)}`);
    chromeManager = null;
  }
}

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
const sweeper = new BindingSweeper();
sweeper.start();

// Periodically clean stale VS Code Server pid files so SSH reconnects don't hang.
// VS Code leaves a stale pid.txt when the server process dies ungracefully.
(async function cleanVscodeServerPids() {
  const { promises: fsp } = await import('node:fs');
  const { existsSync: fsExists } = await import('node:fs');
  const { join: pathJoin } = await import('node:path');
  const oldBase = pathJoin(homedir(), '.vscode-server', 'cli', 'servers');
  const newBase = pathJoin(homedir(), '.vscode', 'cli', 'servers');

  // Ensure agent-host (newer VS Code) can find servers installed under ~/.vscode-server
  try {
    await fsp.mkdir(newBase, { recursive: true });
    const entries = await fsp.readdir(oldBase).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.startsWith('Stable-')) continue;
      const link = pathJoin(newBase, entry);
      if (!fsExists(link)) {
        await fsp.symlink(pathJoin(oldBase, entry), link).catch(() => {});
      }
    }
  } catch { /* ignore */ }

  // Ensure old-format Remote SSH (bin/<hash>/) symlinks exist for each cli/servers/Stable-<hash>/server/
  // VS Code Remote SSH bootstrap checks ~/.vscode-server/bin/<hash>/ — without this it downloads fresh.
  try {
    const binBase = pathJoin(homedir(), '.vscode-server', 'bin');
    await fsp.mkdir(binBase, { recursive: true });
    const entries = await fsp.readdir(oldBase).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.startsWith('Stable-')) continue;
      const hash = entry.replace(/^Stable-/, '');
      const link = pathJoin(binBase, hash);
      const target = pathJoin(oldBase, entry, 'server');
      if (!fsExists(link)) {
        await fsp.symlink(target, link).catch(() => {});
        console.log(`[vscode-cleaner] Created bin symlink for ${hash}`);
      }
    }
  } catch { /* ignore */ }

  // Clean stale pid.txt in both locations
  for (const base of [oldBase, newBase]) {
    try {
      const entries = await fsp.readdir(base).catch(() => [] as string[]);
      for (const entry of entries) {
        const pidFile = pathJoin(base, entry, 'pid.txt');
        try {
          const pid = parseInt(await fsp.readFile(pidFile, 'utf-8'), 10);
          if (!isNaN(pid)) {
            try { process.kill(pid, 0); } catch {
              await fsp.unlink(pidFile);
              console.log(`[vscode-cleaner] Removed stale pid.txt for dead PID ${pid}`);
            }
          }
        } catch { /* pid.txt missing or unreadable — skip */ }
      }
    } catch { /* base dir missing — skip */ }
  }

  setTimeout(cleanVscodeServerPids, 5 * 60 * 1000);
})();

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
  port: PORT_REQUEST,
  hostname: config.HOST,

  async fetch(req, server) {
    const url = new URL(req.url);

    // Auth gate — precedes WS upgrades, /mcp, and all /api routes.
    const denied = checkAuth(req, url);
    if (denied) return denied;

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

    // File content API routes
    if (url.pathname.startsWith('/api/files/content')) {
      return handleFileContentAPI(req);
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

    if (url.pathname.startsWith('/api/artifact')) {
      return handleArtifactAPI(req);
    }

    if (url.pathname.startsWith('/api/ide')) {
      const res = await handleIdeRoutes(req, url, wsHandler);
      if (res) return res;
    }

    if (url.pathname.startsWith('/api/browser')) {
      const res = await handleBrowserRoutes(req, url, wsHandler);
      if (res) return res;
    }

    // Serve compiled extension JS for in-place updates
    if (url.pathname === '/api/extension/js' && req.method === 'GET') {
      const extJsPath = '/srv/codebase/claude-mermaid-collab/extensions/vscode/out/extension.js';
      const extJs = Bun.file(extJsPath);
      if (await extJs.exists()) {
        return new Response(extJs, { headers: { 'Content-Type': 'application/javascript' } });
      }
      return Response.json({ error: 'Extension JS not found' }, { status: 404 });
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

if (typeof server.port !== 'number' || server.port === 0) {
  console.error(`mermaid-collab: Bun.serve returned an invalid port: ${server.port}`);
  process.exit(1);
}
const actualPort = server.port;
const sessionId = deriveSessionId(MERMAID_PROJECT, MERMAID_SESSION);

// Handle graceful shutdown - kill all PTY sessions
process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  sweeper.stop();
  chromeManager?.stop();
  removeInstance(sessionId).catch(() => {}).finally(() => {
    ptyManager.killAll();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  sweeper.stop();
  chromeManager?.stop();
  removeInstance(sessionId).catch(() => {}).finally(() => {
    ptyManager.killAll();
    process.exit(0);
  });
});

try {
  await writeInstance({
    version: 1,
    sessionId,
    port: actualPort,
    project: MERMAID_PROJECT,
    session: MERMAID_SESSION,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    serverVersion: SERVER_VERSION,
  });
} catch (err) {
  console.error(`mermaid-collab: failed to register instance — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
installSignalHandlers(sessionId);
console.log(`mermaid-collab listening on :${actualPort}, advertised as ${sessionId}`);
console.log(`🌐 Public directory: ${config.PUBLIC_DIR}`);
console.log(`🎨 UI dist directory: ${config.UI_DIST_DIR} (exists: ${existsSync(config.UI_DIST_DIR)})`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${actualPort}/ws`);
console.log(`🔌 Terminal: ws://${config.HOST}:${actualPort}/terminal/:sessionId`);
console.log(`🤖 MCP HTTP: http://${config.HOST}:${actualPort}/mcp`);

