#!/usr/bin/env bun
/**
 * mermaid-collab CLI
 *
 * Commands:
 *   start   - Start the server in background
 *   stop    - Stop the server
 *   status  - Check if server is running
 */

import { spawn } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync, openSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { whereami } from './whereami';
import {
  resolveOwnPort,
  currentExePath,
  serverOwner,
  type ResolvedPort,
} from '../src/services/port-ownership';
import { SERVER_VERSION } from '../src/mcp/server';
import { readPortFile } from '../src/services/config-file';

const DATA_DIR = join(homedir(), '.mermaid-collab');
const PID_FILE = join(DATA_DIR, 'server.pid');
const LOG_FILE = join(DATA_DIR, 'server.log');
const PROJECT_ROOT = dirname(dirname(import.meta.path));
const SERVER_SCRIPT = join(PROJECT_ROOT, 'src', 'server.ts');
const UI_DIST_DIR = join(PROJECT_ROOT, 'ui', 'dist');
const REQUEST_PORT = process.env.PORT || 9002;

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function buildUI(): Promise<boolean> {
  const uiDir = join(PROJECT_ROOT, 'ui');
  if (!existsSync(uiDir)) {
    console.error('UI directory not found:', uiDir);
    return false;
  }

  console.log('Building UI...');
  const result = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: uiDir,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  if (result.exitCode !== 0) {
    console.error('UI build failed');
    return false;
  }

  console.log('UI build complete');
  return true;
}

async function readPid(): Promise<number | null> {
  try {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    const content = await readFile(PID_FILE, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(maxWaitMs: number = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const boundPort = readPortFile();
    if (boundPort !== null) {
      try {
        const response = await fetch(`http://localhost:${boundPort}`);
        if (response.ok || response.status === 404) {
          return true;
        }
      } catch {
        // Server not ready yet
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Run the canonical :9002 take-over-or-refuse handshake (design-ubuntu-native §4).
 * Returns the handshake result; the caller decides whether to bind/spawn.
 */
async function runHandshake(): Promise<ResolvedPort> {
  return resolveOwnPort({
    self: {
      exePath: currentExePath(),
      version: SERVER_VERSION,
      owner: serverOwner(),
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
    },
    port: Number(REQUEST_PORT),
    env: { ...process.env, PORT: String(REQUEST_PORT) },
  });
}

async function preflight(): Promise<void> {
  // systemd ExecStartPre / generic guard: ensure THIS host may own :9002 before
  // ExecStart binds. 'proceed' (port claimed / stale holder evicted) and 'defer'
  // (a rightful owner already holds it — idempotent no-op) both exit 0; 'refuse'
  // exits non-zero so the launcher surfaces the conflict instead of double-binding.
  const result = await runHandshake();
  console.log(`preflight: ${result.action} on :${result.port} (${result.reason})`);
  if (result.action === 'refuse') {
    console.error(`Refusing to take over :${REQUEST_PORT} — ${result.reason}.`);
    process.exit(1);
  }
}

async function start(): Promise<void> {
  await ensureDataDir();

  // Check if already running
  const existingPid = await readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Server already running (PID: ${existingPid}) on http://localhost:${REQUEST_PORT}`);
    return;
  }

  // Canonical port-ownership handshake with per-user coexistence: if :9002 is
  // held by ANOTHER user, resolveOwnPort falls back to a per-user port instead
  // of refusing, so a second OS user can run their own server on this machine.
  const handshake = await runHandshake();
  const boundPort = handshake.port;
  if (handshake.action === 'defer') {
    console.log(`A rightful server already owns :${boundPort} (${handshake.reason}); deferring.`);
    return;
  }
  if (handshake.action === 'refuse') {
    console.error(`Refusing to start on :${REQUEST_PORT} — ${handshake.reason}. Set MERMAID_GUARD_MODE=takeover to evict, or resolve the conflict.`);
    process.exit(1);
  }
  // action === 'proceed' → boundPort is ours (was free, a stale holder was
  // evicted, or a per-user fallback when :9002 belonged to another user).

  // Check if server script exists
  if (!existsSync(SERVER_SCRIPT)) {
    console.error(`Server script not found: ${SERVER_SCRIPT}`);
    process.exit(1);
  }

  // Build UI if dist doesn't exist
  if (!existsSync(UI_DIST_DIR)) {
    const buildSuccess = await buildUI();
    if (!buildSuccess) {
      console.error('Failed to build UI. Server will start but UI may not work.');
    }
  }

  // Spawn detached process. Redirect the child's stdout/stderr straight to the
  // log file descriptor rather than piping through this parent: piping would
  // (a) hold the parent's event loop open via the stream refs so `start` never
  // returns to the shell, and (b) lose the child's logs once the parent exits.
  // Writing to the fd lets the daemon keep logging after we detach.
  const logFd = openSync(LOG_FILE, 'a');
  const child = spawn('bun', ['run', SERVER_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PORT: String(boundPort) },
  });
  closeSync(logFd); // child inherited its own dup of the fd

  child.unref();

  // Write PID file
  await writeFile(PID_FILE, String(child.pid));

  console.log(`Starting server (PID: ${child.pid})...`);

  // Wait for server to be ready
  const ready = await waitForServer();

  if (ready) {
    console.log(`Server started on http://localhost:${boundPort}`);
    console.log(`Logs: ${LOG_FILE}`);
  } else {
    console.error(`Server failed to start. Check logs: ${LOG_FILE}`);
    process.exit(1);
  }
}

async function stop(): Promise<void> {
  const pid = await readPid();

  if (!pid) {
    console.log('Server not running (no PID file)');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log('Server not running (stale PID file)');
    await unlink(PID_FILE).catch(() => {});
    return;
  }

  // Send SIGTERM
  console.log(`Stopping server (PID: ${pid})...`);
  process.kill(pid, 'SIGTERM');

  // Wait for graceful shutdown
  let waitTime = 0;
  const maxWait = 3000;
  while (waitTime < maxWait && isProcessRunning(pid)) {
    await new Promise(resolve => setTimeout(resolve, 100));
    waitTime += 100;
  }

  // Force kill if still running
  if (isProcessRunning(pid)) {
    console.log('Forcing shutdown...');
    process.kill(pid, 'SIGKILL');
  }

  // Clean up PID file
  await unlink(PID_FILE).catch(() => {});
  console.log('Server stopped');
}

async function status(): Promise<void> {
  const pid = await readPid();

  if (!pid) {
    console.log('Server: stopped');
    return;
  }

  if (isProcessRunning(pid)) {
    console.log(`Server: running (PID: ${pid})`);
    const boundPort = readPortFile();
    if (boundPort !== null) {
      console.log(`URL: http://localhost:${boundPort}`);
    } else {
      console.log('URL: unknown — no port file found (server has not reported a bound port)');
    }
    console.log(`Logs: ${LOG_FILE}`);
  } else {
    console.log('Server: stopped (stale PID file)');
    await unlink(PID_FILE).catch(() => {});
  }
}

// Main
const command = process.argv[2];

switch (command) {
  case 'start':
    await start();
    break;
  case 'preflight':
    await preflight();
    break;
  case 'stop':
    await stop();
    break;
  case 'status':
    await status();
    break;
  case 'whereami':
    await whereami(process.argv.slice(3));
    break;
  default:
    console.log('mermaid-collab - Mermaid collaboration server');
    console.log('');
    console.log('Usage:');
    console.log('  mermaid-collab start   Start the server in background');
    console.log('  mermaid-collab preflight  Run the :9002 ownership handshake (systemd ExecStartPre); take over a stale holder or refuse');
    console.log('  mermaid-collab stop    Stop the server');
    console.log('  mermaid-collab status  Check if server is running');
    console.log('  mermaid-collab whereami [--all] [--project <path>] [--session <name>]  List live server instances as JSON');
    console.log('');
    console.log('Environment:');
    console.log('  PORT  Requested server bind port (default: 9002) — the live URL is read from the port file, not this env var.');
    process.exit(command ? 1 : 0);
}
