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
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.mermaid-collab');
const PID_FILE = join(DATA_DIR, 'server.pid');
const LOG_FILE = join(DATA_DIR, 'server.log');
const PROJECT_ROOT = dirname(dirname(import.meta.path));
const SERVER_SCRIPT = join(PROJECT_ROOT, 'src', 'server.ts');
const UI_DIST_DIR = join(PROJECT_ROOT, 'ui', 'dist');
const PORT = process.env.PORT || 3737;

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

async function waitForServer(maxWaitMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  const url = `http://localhost:${PORT}`;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

async function start(): Promise<void> {
  await ensureDataDir();

  // Check if already running
  const existingPid = await readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Server already running (PID: ${existingPid}) on http://localhost:${PORT}`);
    return;
  }

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

  // Spawn detached process
  const logStream = Bun.file(LOG_FILE).writer();
  const child = spawn('bun', ['run', SERVER_SCRIPT], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });

  // Pipe output to log file
  child.stdout?.on('data', (data) => logStream.write(data));
  child.stderr?.on('data', (data) => logStream.write(data));

  child.unref();

  // Write PID file
  await writeFile(PID_FILE, String(child.pid));

  console.log(`Starting server (PID: ${child.pid})...`);

  // Wait for server to be ready
  const ready = await waitForServer();

  if (ready) {
    console.log(`Server started on http://localhost:${PORT}`);
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
    console.log(`URL: http://localhost:${PORT}`);
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
  case 'stop':
    await stop();
    break;
  case 'status':
    await status();
    break;
  default:
    console.log('mermaid-collab - Mermaid collaboration server');
    console.log('');
    console.log('Usage:');
    console.log('  mermaid-collab start   Start the server in background');
    console.log('  mermaid-collab stop    Stop the server');
    console.log('  mermaid-collab status  Check if server is running');
    console.log('');
    console.log('Environment:');
    console.log('  PORT  Server port (default: 3737)');
    process.exit(command ? 1 : 0);
}
