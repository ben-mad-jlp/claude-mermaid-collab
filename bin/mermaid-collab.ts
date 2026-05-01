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
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.mermaid-collab');
const PID_FILE = join(DATA_DIR, 'server.pid');
const LOG_FILE = join(DATA_DIR, 'server.log');
const PROJECT_ROOT = dirname(dirname(import.meta.path));
const SERVER_SCRIPT = join(PROJECT_ROOT, 'src', 'server.ts');
const UI_DIST_DIR = join(PROJECT_ROOT, 'ui', 'dist');
const PORT = process.env.PORT || 9002;

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
  }
}

async function start(): Promise<void> {
  await ensureDataDir();
  await cleanStaleVscodeServer();

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
    console.log('  PORT  Server port (default: 9002)');
    process.exit(command ? 1 : 0);
}
