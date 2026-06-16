// MUST be first: set up the jsdom DOM globals before ANY module (e.g. the
// Validator's dynamic mermaid import) pulls in mermaid/dompurify — otherwise
// dompurify caches windowless and server-side diagram rendering fails with
// "DOMPurify.addHook is not a function".
import './services/dom-setup';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { config } from './config';
import { PORT_REQUEST, MERMAID_PROJECT, MERMAID_SESSION, MC_BROWSER_TARGET, MERMAID_CHROME_PATH, MERMAID_BROWSER_HEADLESS, MERMAID_IDLE_SHUTDOWN_MS, MERMAID_AUTO_START_COORDINATOR } from './config';
import { checkAuth } from './auth';
import { writeInstance, removeInstance, deriveSessionId, installSignalHandlers } from './services/instance-discovery';
import { writeLock, releaseLock, currentExePath, serverOwner } from './services/port-ownership';
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
import { handleFileContentAPI } from './routes/file-content.js';
import { handleAttachments } from './routes/agent-attachments';
import { handleEditorRoundtrip } from './routes/editor-roundtrip';
import { handleAgentSessionsAPI } from './routes/agent-sessions';
import { handleWorktreeDiffAPI } from './routes/worktree-diff';
import { handleWorktreeFilesAPI } from './routes/worktree-files';
import { handleArtifactAPI } from './routes/artifact-api.js';
import { handleIdeRoutes } from './routes/ide-routes.js';
import { handleSupervisorRoutes } from './routes/supervisor-routes.js';
import { handleOrchestratorRoutes } from './routes/orchestrator-routes.js';
import { touchSupervisorIdentity, SUPERVISOR_HEARTBEAT_INTERVAL_MS } from './services/supervisor-store.js';
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
import { BindingReconciler } from './services/binding-reconciler.ts';

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
// streamed-panel reuses the exact same ChromeManager spawn, then additionally
// arms a ScreencastService (L2 will subscribe a WS-broadcasting sink).
let chromeManager: import('./services/chrome-manager').ChromeManager | null = null;
let screencastService: import('./services/screencast').ScreencastService | null = null;
const ownsChrome = MC_BROWSER_TARGET === 'owned-chrome' || MC_BROWSER_TARGET === 'streamed-panel';
if (ownsChrome) {
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
    if (MC_BROWSER_TARGET === 'streamed-panel') {
      const { ScreencastService } = await import('./services/screencast.js');
      screencastService = new ScreencastService({ cdpPort: CDP_PORT });
      console.log(`🎥 streamed-panel ScreencastService armed (no subscribers yet)`);
      // L2 will subscribe a WS-broadcasting sink; L1 leaves it idle/lazy.
    }
  } catch (err) {
    console.error(`mermaid-collab: ${MC_BROWSER_TARGET} start failed — ${err instanceof Error ? err.message : String(err)}`);
    chromeManager = null;
    screencastService = null;
  }
}

// Migrate legacy per-session todo JSON files into the per-project todo-store
// (idempotent — renames sources, so it's a no-op after the first run).
try {
  const { migrateProject } = await import('./services/todo-migration.js');
  const { migrated } = await migrateProject(MERMAID_PROJECT);
  if (migrated > 0) console.log(`📋 Migrated ${migrated} legacy todo(s) into the per-project store`);
} catch (err) {
  console.error(`mermaid-collab: todo migration failed — ${err instanceof Error ? err.message : String(err)}`);
}

// Migrate roadmap.db items into todos.db (idempotent — sentinel row prevents re-run).
try {
  const { migrateRoadmapToTodos } = await import('./services/roadmap-migration.js');
  const { migrated, skipped } = await migrateRoadmapToTodos(MERMAID_PROJECT);
  if (!skipped) console.log(`📋 Roadmap migration: ${migrated} item(s) backfilled`);
} catch (err) {
  console.error(`mermaid-collab: roadmap migration failed — ${err instanceof Error ? err.message : String(err)}`);
}

// Unified project list reconcile (idempotent): the supervisor's watched set is
// the PERSISTENT source of truth for the Bridge — it survives restarts and only
// changes on an explicit user add/remove (the api.ts / supervisor-routes.ts
// cross-writes keep registry ⊇ watched in lockstep on those edits). Here we only
// ensure every still-watched project stays registered (watched ⊆ registered); we
// deliberately do NOT auto-watch every registered project, otherwise each restart
// would re-flood the Bridge with every project the registry ever accumulated.
try {
  const { projectRegistry } = await import('./services/project-registry.js');
  const { listWatchedProjects } = await import('./services/supervisor-store.js');
  const registeredPaths = new Set((await projectRegistry.list()).map((p) => p.path));
  for (const w of listWatchedProjects()) {
    if (!registeredPaths.has(w.project)) await projectRegistry.register(w.project).catch(() => {});
  }
} catch (err) {
  console.error(`mermaid-collab: project-list reconcile failed — ${err instanceof Error ? err.message : String(err)}`);
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

// Orchestrator Daemon Phase 1: a single daemon enumerates all registered
// projects each tick and dispatches build/reconcile by per-project level.
// Per-project autoStartCoordinator boot loops are no longer needed here.
if (MERMAID_AUTO_START_COORDINATOR) {
  // P3 (fe153cdd): rebuild the in-memory worker-pool registry from live tmux
  // sessions ∩ claimed todos BEFORE the first build pass, so a restart doesn't
  // spawn a duplicate worker into an already-occupied lane (or orphan a live one).
  try {
    const { reconcileWorkerPoolFromLiveSessions } = await import('./services/coordinator-live.js');
    const { restored } = await reconcileWorkerPoolFromLiveSessions();
    if (restored.length > 0) console.log(`🧩 Worker-pool restart-reconcile: restored ${restored.length} busy slot(s)`);
  } catch (err) {
    console.error(`mermaid-collab: worker-pool reconcile failed — ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const { startOrchestrator } = await import('./services/orchestrator-live.js');
    startOrchestrator();
    console.log('🧭 Orchestrator daemon started');
  } catch (err) {
    console.error(`mermaid-collab: orchestrator start failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Periodic reaper for orphaned/very old `mc-*` tmux sessions (deterministic
// daemon). Kills only old sessions with no live claude + no TUI, so live work
// (steward, planners, workers, consoles) is never touched. Best-effort.
try {
  const { startTmuxReaper } = await import('./services/tmux-reaper.js');
  startTmuxReaper();
} catch (err) {
  console.warn(`mermaid-collab: tmux reaper start skipped — ${err instanceof Error ? err.message : String(err)}`);
}

// Initialize shared services (stateless, no storage)
const validator = new Validator();
const renderer = new Renderer();
const wsHandler = new WebSocketHandler();

// Initialize WebSocket handler manager for global access
initializeWebSocketHandler(wsHandler);
const sweeper = new BindingSweeper();
sweeper.start();

// Continuously DERIVE session bindings from durable facts (binding files +
// supervised registry ∩ live tmux) on boot + every ~20s, so a session (human or
// worker) relights with no manual /collab after a deploy wipes the in-memory
// pid→session map. Purely additive + idempotent; runs alongside the existing
// register paths. See design-session-binding (sibling of decision 9cd01858).
const bindingReconciler = new BindingReconciler();
bindingReconciler.start();

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

    // Treat any HTTP request as activity: push the idle-shutdown deadline so a
    // server actively used over MCP/HTTP (but with no WS client) doesn't exit
    // mid-session. When a WS client is connected, idle is already cancelled.
    if (MERMAID_IDLE_SHUTDOWN_MS > 0 && wsHandler.getConnectionCount() === 0) armIdle();

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

    // File content API routes
    if (url.pathname.startsWith('/api/files/content')) {
      return handleFileContentAPI(req);
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

    if (url.pathname.startsWith('/api/supervisor')) {
      const res = await handleSupervisorRoutes(req, url);
      if (res) return res;
    }

    if (url.pathname.startsWith('/api/orchestrator')) {
      const res = await handleOrchestratorRoutes(req, url);
      if (res) return res;
    }

    if (url.pathname.startsWith('/api/browser')) {
      const res = await handleBrowserRoutes(req, url, wsHandler);
      if (res) return res;
    }

    // Serve compiled extension JS for in-place updates
    if (url.pathname === '/api/extension/js' && req.method === 'GET') {
      // Resolve relative to this module (src/server.ts → repo root) so it works
      // on any host, not just the original author's deploy path.
      const extJsPath = join(import.meta.dir, '..', 'extensions', 'vscode', 'out', 'extension.js');
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

// Canonical :9002 ownership lockfile (design-ubuntu-native §4b). Record who owns
// the port so any other starter can read it and run the take-over-or-refuse
// handshake instead of silently shadowing us. Best-effort — never block startup.
try {
  writeLock({
    pid: process.pid,
    exePath: currentExePath(),
    version: SERVER_VERSION,
    port: actualPort,
    owner: serverOwner(),
  });
} catch { /* best-effort lock write */ }

// Supervisor + steward liveness heartbeat: while this server is alive, keep the
// registered roles' updatedAt advancing so the UI can tell a running role from a
// crashed/stale one. No-op until each role registers. Both roles are kept fresh
// here (server-alive = role-alive) — otherwise an idle steward that only touches
// its identity when it loops goes stale within the 60s window between escalations
// and the StewardPanel flaps back to the "Restart steward" front door.
// Cleared on shutdown so a killed server lets updatedAt go stale.
let supervisorHeartbeat: ReturnType<typeof setInterval> | null = null;
const cancelSupervisorHeartbeat = () => {
  if (supervisorHeartbeat) { clearInterval(supervisorHeartbeat); supervisorHeartbeat = null; }
};
supervisorHeartbeat = setInterval(() => {
  try { touchSupervisorIdentity(); } catch { /* best-effort liveness */ }
  try { touchSupervisorIdentity(undefined, 'steward'); } catch { /* best-effort liveness */ }
}, SUPERVISOR_HEARTBEAT_INTERVAL_MS);
// Don't let the heartbeat alone keep the process alive.
supervisorHeartbeat.unref?.();

// Handle graceful shutdown - kill all PTY sessions
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const cancelIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
const armIdle = () => {
  cancelIdle();
  idleTimer = setTimeout(async () => {
    try { await removeInstance(sessionId); } catch {}
    try { releaseLock(); } catch {}
    process.exit(0);
  }, MERMAID_IDLE_SHUTDOWN_MS);
};

process.on('SIGINT', () => {
  cancelIdle();
  cancelSupervisorHeartbeat();
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  sweeper.stop();
  screencastService?.stop();
  chromeManager?.stop();
  try { releaseLock(); } catch {}
  removeInstance(sessionId).catch(() => {}).finally(() => {
    ptyManager.killAll();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  cancelIdle();
  cancelSupervisorHeartbeat();
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  sweeper.stop();
  screencastService?.stop();
  chromeManager?.stop();
  try { releaseLock(); } catch {}
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

if (MERMAID_IDLE_SHUTDOWN_MS > 0) {
  wsHandler.setOnConnectionsChanged((n: number) => {
    if (n === 0) armIdle(); else cancelIdle();
  });
  armIdle(); // cover startup gap before any client connects
}

console.log(`mermaid-collab listening on :${actualPort}, advertised as ${sessionId}`);
console.log(`🌐 Public directory: ${config.PUBLIC_DIR}`);
console.log(`🎨 UI dist directory: ${config.UI_DIST_DIR} (exists: ${existsSync(config.UI_DIST_DIR)})`);
console.log(`🔌 WebSocket: ws://${config.HOST}:${actualPort}/ws`);
console.log(`🔌 Terminal: ws://${config.HOST}:${actualPort}/terminal/:sessionId`);
console.log(`🤖 MCP HTTP: http://${config.HOST}:${actualPort}/mcp`);

