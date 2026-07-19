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
import { readFile, writeFile, unlink, mkdir, readdir, symlink } from 'fs/promises';
import { existsSync, openSync, closeSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { whereami } from './whereami';
import {
  performHandshake,
  currentExePath,
  serverOwner,
  type HandshakeResult,
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

async function cleanStaleVscodeServer(): Promise<void> {
  // agent-host (newer VS Code) looks in ~/.vscode/cli/servers/
  // older installs live in ~/.vscode-server/cli/servers/
  // ensure both exist and the newer path has a symlink to the old install
  const newBase = join(homedir(), '.vscode', 'cli', 'servers');
  const oldBase = join(homedir(), '.vscode-server', 'cli', 'servers');
  try {
    await mkdir(newBase, { recursive: true });
    const entries = await readdir(oldBase).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.startsWith('Stable-')) continue;
      const target = join(newBase, entry);
      if (!existsSync(target)) {
        await symlink(join(oldBase, entry), target).catch(() => {});
      }
    }
  } catch { /* ignore */ }

  // Ensure old-format Remote SSH (bin/<hash>/) symlinks exist — without these VS Code re-downloads the server
  try {
    const binBase = join(homedir(), '.vscode-server', 'bin');
    await mkdir(binBase, { recursive: true });
    const entries = await readdir(oldBase).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.startsWith('Stable-')) continue;
      const hash = entry.replace(/^Stable-/, '');
      const link = join(binBase, hash);
      if (!existsSync(link)) {
        await symlink(join(oldBase, entry, 'server'), link).catch(() => {});
        console.log(`Created VS Code server bin symlink for ${hash}`);
      }
    }
  } catch { /* ignore */ }

  // Clean stale pid.txt files in both locations
  for (const base of [oldBase, newBase]) {
    if (!existsSync(base)) continue; // base dir absent (e.g. no VS Code) — scanning it would throw ENOENT
    try {
      const glob = new Bun.Glob(join(base, 'Stable-*/pid.txt'));
      for await (const pidFile of glob.scan('/')) {
        try {
          const pid = parseInt(await readFile(pidFile, 'utf-8'), 10);
          if (!isNaN(pid) && !isProcessRunning(pid)) {
            await unlink(pidFile);
            console.log(`Cleaned stale VS Code Server pid (${pid})`);
          }
        } catch { /* ignore per-file errors */ }
      }
    } catch { /* ignore scan errors (e.g. base dir vanished mid-scan) */ }
  }
}

/**
 * Run the canonical :9002 take-over-or-refuse handshake (design-ubuntu-native §4).
 * Returns the handshake result; the caller decides whether to bind/spawn.
 */
async function runHandshake(): Promise<HandshakeResult> {
  return performHandshake({
    self: { exePath: currentExePath(), version: SERVER_VERSION, owner: serverOwner() },
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
  console.log(`preflight: ${result.action} (${result.reason})`);
  if (result.action === 'refuse') {
    console.error(`Refusing to take over :${REQUEST_PORT} — ${result.reason}.`);
    process.exit(1);
  }
}

async function start(): Promise<void> {
  await ensureDataDir();
  await cleanStaleVscodeServer();

  // Check if already running
  const existingPid = await readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Server already running (PID: ${existingPid}) on http://localhost:${REQUEST_PORT}`);
    return;
  }

  // Canonical port-ownership handshake: never silently shadow another server.
  const handshake = await runHandshake();
  if (handshake.action === 'defer') {
    console.log(`A rightful server already owns :${REQUEST_PORT} (${handshake.reason}); deferring.`);
    return;
  }
  if (handshake.action === 'refuse') {
    console.error(`Refusing to start on :${REQUEST_PORT} — ${handshake.reason}. Set MERMAID_GUARD_MODE=takeover to evict, or resolve the conflict.`);
    process.exit(1);
  }
  // action === 'proceed' → the port is ours (was free, or a stale holder was evicted).

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
    env: { ...process.env, PORT: String(REQUEST_PORT) },
  });
  closeSync(logFd); // child inherited its own dup of the fd

  child.unref();

  // Write PID file
  await writeFile(PID_FILE, String(child.pid));

  console.log(`Starting server (PID: ${child.pid})...`);

  // Wait for server to be ready
  const ready = await waitForServer();

  if (ready) {
    console.log(`Server started on http://localhost:${REQUEST_PORT}`);
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
