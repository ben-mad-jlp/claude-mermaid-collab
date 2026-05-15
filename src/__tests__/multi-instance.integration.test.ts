import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface SpawnedServer {
  proc: ChildProcess;
  port: number;
  sessionId: string;
}

const REPO_ROOT = join(__dirname, '..', '..');

function waitExit(p: ChildProcess, timeoutMs = 1500): Promise<void> {
  return new Promise(resolve => {
    if (p.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, timeoutMs);
    p.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

function spawnServer(env: Record<string, string>): Promise<SpawnedServer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['src/server.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error('Timed out waiting for server to start (no listening log seen in 20s)'));
    }, 20_000);

    let stdoutBuf = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const m = stdoutBuf.match(/listening on :(\d+), advertised as ([a-f0-9]+)/);
      if (m) {
        clearTimeout(timeout);
        resolve({ proc, port: Number(m[1]), sessionId: m[2] });
      }
    });
    proc.on('error', err => { clearTimeout(timeout); reject(err); });
    proc.on('exit', code => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });
}

describe('multi-instance discovery integration', () => {
  let tmpHome: string;
  let serverA: SpawnedServer | null = null;
  let serverB: SpawnedServer | null = null;

  beforeAll(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'mc-multi-'));
  }, 30_000);

  afterAll(async () => {
    for (const s of [serverA, serverB]) {
      if (s?.proc.exitCode === null) {
        try { s.proc.kill('SIGKILL'); } catch {}
        await waitExit(s.proc);
      }
    }
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('spawns two servers with distinct discovery files on different ports', async () => {
    serverA = await spawnServer({
      HOME: tmpHome,
      PORT: '0',
      MERMAID_PROJECT: '/tmp/projA-' + Date.now(),
      MERMAID_SESSION: 'sessA',
    });
    serverB = await spawnServer({
      HOME: tmpHome,
      PORT: '0',
      MERMAID_PROJECT: '/tmp/projB-' + Date.now(),
      MERMAID_SESSION: 'sessB',
    });

    expect(serverA.port).not.toBe(serverB.port);
    expect(serverA.sessionId).not.toBe(serverB.sessionId);

    const fileA = join(tmpHome, '.mermaid-collab', 'instances', `${serverA.sessionId}.json`);
    const fileB = join(tmpHome, '.mermaid-collab', 'instances', `${serverB.sessionId}.json`);
    await expect(access(fileA)).resolves.toBeUndefined();
    await expect(access(fileB)).resolves.toBeUndefined();

    const ra = await fetch(`http://127.0.0.1:${serverA.port}/api/health`);
    expect(ra.status).toBe(200);
    const rb = await fetch(`http://127.0.0.1:${serverB.port}/api/health`);
    expect(rb.status).toBe(200);

    serverA.proc.kill('SIGTERM');
    serverB.proc.kill('SIGTERM');
    await Promise.all([waitExit(serverA.proc), waitExit(serverB.proc)]);

    // give exit handler a moment to unlink files
    await new Promise(r => setTimeout(r, 250));

    await expect(access(fileA)).rejects.toThrow();
    await expect(access(fileB)).rejects.toThrow();
  }, 60_000);
});
