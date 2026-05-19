/**
 * Spawns `bun src/server.ts` with PORT=0 and the discovery env vars, pipes
 * stdio to a VS Code output channel, and returns the child identity.
 * Pre-flight detects an already-running server for the same (project, session).
 */
import * as child_process from 'child_process';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import type * as vscode from 'vscode';

export interface SpawnedServer {
  pid: number;
  sessionId: string;
  child: ChildProcess;
}

export class AlreadyRunning extends Error {
  constructor(
    public readonly pid: number,
    public readonly port: number,
    public readonly sessionId: string,
  ) {
    super(`mermaid-collab server already running for sessionId ${sessionId} (pid ${pid}, port ${port})`);
    this.name = 'AlreadyRunning';
  }
}

/** Matches src/services/instance-discovery.ts deriveSessionId — kept inline
 *  because the extension tsconfig rootDir excludes src/services/. */
function deriveSessionId(project: string, session: string): string {
  return createHash('sha1').update(project + '\0' + session).digest('hex').slice(0, 12);
}

interface InstanceFile {
  pid?: number;
  port?: number;
}

/** Forwards a readable stream to the output channel, buffered by line. */
function pipeLines(
  stream: NodeJS.ReadableStream | null,
  prefix: string,
  output: vscode.OutputChannel,
): void {
  if (!stream) return;
  // Decode as UTF-8 so a multibyte sequence split across chunk boundaries
  // isn't corrupted (chunk.toString() per-chunk would mangle it).
  stream.setEncoding('utf8');
  let buf = '';
  stream.on('data', (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) output.appendLine(prefix + line);
  });
  stream.on('end', () => {
    if (buf.length > 0) output.appendLine(prefix + buf);
  });
}

export async function spawnCollabServer(opts: {
  project: string;
  session: string;
  source: { rootDir: string; bunPath: string; version?: string };
  output: vscode.OutputChannel;
  signal?: AbortSignal;
}): Promise<SpawnedServer> {
  const { output } = opts;
  const sessionId = deriveSessionId(opts.project, opts.session);
  const instancesDir = path.join(os.homedir(), '.mermaid-collab', 'instances');
  const instancePath = path.join(instancesDir, sessionId + '.json');
  const lockPath = path.join(instancesDir, sessionId + '.lock');

  // Pre-flight duplicate check.
  if (existsSync(instancePath)) {
    let inst: InstanceFile | null = null;
    try {
      inst = JSON.parse(await fs.readFile(instancePath, 'utf8')) as InstanceFile;
    } catch {
      inst = null;
    }
    if (inst && typeof inst.pid === 'number') {
      let alive = false;
      try { process.kill(inst.pid, 0); alive = true; } catch { /* dead */ }
      if (alive) {
        throw new AlreadyRunning(inst.pid, typeof inst.port === 'number' ? inst.port : 0, sessionId);
      }
    }
    // Stale or unparseable — best-effort cleanup.
    await fs.unlink(instancePath).catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }

  output.appendLine('─'.repeat(60));
  output.appendLine(`[spawn] mermaid-collab server`);
  output.appendLine(`[spawn] source : ${opts.source.rootDir}`);
  output.appendLine(`[spawn] version: ${opts.source.version ?? 'unknown'}`);
  output.appendLine(`[spawn] bun    : ${opts.source.bunPath}`);
  output.appendLine(`[spawn] project: ${opts.project}`);
  output.appendLine(`[spawn] session: ${opts.session}`);
  output.appendLine(`[spawn] sessionId: ${sessionId}`);
  output.appendLine(`[spawn] at ${new Date().toISOString()}`);
  output.appendLine('─'.repeat(60));

  const child = child_process.spawn(opts.source.bunPath, ['src/server.ts'], {
    cwd: opts.source.rootDir,
    env: {
      ...process.env,
      PORT: '0',
      MERMAID_PROJECT: opts.project,
      MERMAID_SESSION: opts.session,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  pipeLines(child.stdout, '[server] ', output);
  pipeLines(child.stderr, '[server:err] ', output);

  child.on('error', err => output.appendLine(`[server:error] ${err.message}`));
  child.on('exit', (code, signal) =>
    output.appendLine(`[server:exit] code=${code} signal=${signal}`),
  );

  if (opts.signal) {
    opts.signal.addEventListener('abort', () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    });
  }

  if (typeof child.pid !== 'number') {
    throw new Error('Failed to spawn bun — child has no pid (bad bun path?)');
  }

  return { pid: child.pid, sessionId, child };
}
