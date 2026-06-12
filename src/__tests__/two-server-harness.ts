/**
 * Two-server integration harness (verification spine — design §5, [H0]).
 *
 * The shared rig the two-server phase leaves write their assertions INTO. It is
 * deliberately a plain module (NOT a `*.test.ts`, so the vitest include glob
 * `src/**​/*.test.ts` never picks it up as an empty suite) — phase leaves import
 * these helpers from their own `*.integration.test.ts` files.
 *
 * It composes two patterns that already exist in the repo, so the rig reuses
 * proven plumbing rather than re-inventing it:
 *   - the real-sidecar spawn (ephemeral PORT=0, parse the `listening on :PORT,
 *     advertised as <id>` log, SIGKILL teardown) from
 *     `src/__tests__/multi-instance.integration.test.ts`;
 *   - the socket-level fake upstream (a `ws` `WebSocketServer` that records
 *     accepted/closed/open and echoes) from
 *     `desktop/src/main/__tests__/server-proxy.test.ts` (`makeFakeUpstream`).
 *
 * What it provides:
 *   - `TwoServerRig` — spawns TWO real sidecars on ephemeral ports and tears
 *     them down cleanly (use in beforeAll/afterAll).
 *   - `makeFakeUpstream` — a fake `/ws` upstream a forged-frame test can point at.
 *   - `injectForgedFrame` — opens a raw client and pushes an arbitrary (forged)
 *     frame at a server's WS endpoint, returning the live socket to assert on.
 *   - `connectRenderer` — a renderer-facing client with a message log + `waitFor`,
 *     so a phase leaf asserts on what the browser side would receive.
 *   - `installFakeClock` — opt-in fake timers so lease/heartbeat logic the phase
 *     leaves exercise runs sub-second and the rig stays in the normal `test:ci`
 *     lane. NOT enabled by the rig itself (real sidecar spawn needs real timers);
 *     a phase leaf installs it AFTER the servers are up, around the logic it drives.
 *
 * No product assertions live here — this is the reusable scaffold plus one smoke
 * (both sidecars answer `/api/health`); see `two-server-harness.integration.test.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

// ws v7 (the root dep) exposes the server as a static `WebSocket.Server` — the
// named `WebSocketServer` export only landed in v8. Alias it so the rig reads the
// same either way.
const WebSocketServer = WebSocket.Server;
import { vi } from 'vitest';

/** Repo root — two levels up from `src/__tests__`. The sidecar entrypoint
 *  (`src/server.ts`) is spawned relative to it, matching the multi-instance rig. */
const REPO_ROOT = join(__dirname, '..', '..');

/** A spawned real sidecar: its process, the ephemeral port it bound, the session
 *  id it advertised, and a convenience base URL for `/api/*` calls. */
export interface Sidecar {
  proc: ChildProcess;
  port: number;
  sessionId: string;
  baseUrl: string;
}

/** Wait for a child to exit, SIGKILL-ing it after `timeoutMs` so a wedged
 *  sidecar can never hang teardown (mirrors the multi-instance rig's waitExit). */
export function waitExit(p: ChildProcess, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (p.exitCode !== null) return resolve();
    const t = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, timeoutMs);
    p.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

/** Spawn ONE real sidecar (`bun src/server.ts`) on an ephemeral port and resolve
 *  once it logs its listening line. Reuses the multi-instance spawn pattern; the
 *  caller supplies env overrides (HOME, MERMAID_PROJECT, MERMAID_SESSION, …). */
export function spawnSidecar(env: Record<string, string>, startTimeoutMs = 20_000): Promise<Sidecar> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['src/server.ts'], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env, PORT: env.PORT ?? '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('Timed out waiting for sidecar to start (no listening log seen)'));
    }, startTimeoutMs);

    let stdoutBuf = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const m = stdoutBuf.match(/listening on :(\d+), advertised as ([a-f0-9]+)/);
      if (m) {
        clearTimeout(timeout);
        const port = Number(m[1]);
        resolve({ proc, port, sessionId: m[2], baseUrl: `http://127.0.0.1:${port}` });
      }
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Sidecar exited early with code ${code}`));
      }
    });
  });
}

/** Options for a {@link TwoServerRig}. */
export interface TwoServerRigOptions {
  /** Distinct project paths for the two sidecars (defaults to unique /tmp paths). */
  projectA?: string;
  projectB?: string;
  sessionA?: string;
  sessionB?: string;
}

/**
 * Two real sidecars sharing a throwaway $HOME (so their instance-discovery files
 * land in one inspectable dir) on distinct ephemeral ports. Spawn in `beforeAll`,
 * tear down in `afterAll`:
 *
 *   const rig = new TwoServerRig();
 *   beforeAll(() => rig.start(), 60_000);
 *   afterAll(() => rig.stop());
 */
export class TwoServerRig {
  a: Sidecar | null = null;
  b: Sidecar | null = null;
  private tmpHome = '';
  constructor(private readonly opts: TwoServerRigOptions = {}) {}

  /** Throwaway $HOME both sidecars share (their discovery files live here). */
  get home(): string { return this.tmpHome; }

  async start(): Promise<void> {
    this.tmpHome = await mkdtemp(join(tmpdir(), 'mc-two-server-'));
    const stamp = Date.now();
    this.a = await spawnSidecar({
      HOME: this.tmpHome,
      PORT: '0',
      MERMAID_PROJECT: this.opts.projectA ?? `/tmp/twoServerA-${stamp}`,
      MERMAID_SESSION: this.opts.sessionA ?? 'twoServerA',
    });
    this.b = await spawnSidecar({
      HOME: this.tmpHome,
      PORT: '0',
      MERMAID_PROJECT: this.opts.projectB ?? `/tmp/twoServerB-${stamp}`,
      MERMAID_SESSION: this.opts.sessionB ?? 'twoServerB',
    });
  }

  /** SIGTERM both, SIGKILL-fall-back via waitExit, then remove the throwaway HOME. */
  async stop(): Promise<void> {
    for (const s of [this.a, this.b]) {
      if (s?.proc.exitCode === null) {
        try { s.proc.kill('SIGTERM'); } catch { /* ignore */ }
        await waitExit(s.proc);
      }
    }
    this.a = null;
    this.b = null;
    if (this.tmpHome) { await rm(this.tmpHome, { recursive: true, force: true }); this.tmpHome = ''; }
  }
}

/** A fake "remote" collab `/ws` upstream — a real `ws` server that records the
 *  expensive accepts a real upstream would, echoes messages, and tears down
 *  cleanly. Ported from `makeFakeUpstream` in server-proxy.test.ts so the two
 *  rigs share one socket-level fake. */
export function makeFakeUpstream() {
  let accepted = 0;
  let closed = 0;
  const sockets = new Set<WebSocket>();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    accepted += 1;
    sockets.add(ws);
    ws.on('message', (data: Buffer, isBinary: boolean) => ws.send(data, { binary: isBinary }));
    ws.on('close', () => { closed += 1; sockets.delete(ws); });
  });
  return {
    wss,
    get accepted() { return accepted; },
    get closed() { return closed; },
    get open() { return sockets.size; },
    port: () => (wss.address() as AddressInfo).port,
    url: () => `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    async ready() { await new Promise<void>((r) => wss.once('listening', r)); },
    /** Push a frame from the upstream side to every connected socket. */
    broadcast(data: string | Buffer) { for (const s of sockets) try { s.send(data); } catch { /* ignore */ } },
    async stop() {
      for (const s of sockets) try { s.terminate(); } catch { /* ignore */ }
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

/** A live forged-frame injection: the open socket plus a `done` promise that
 *  resolves when the server closes it (e.g. it rejected the forged frame). */
export interface ForgedInjection {
  ws: WebSocket;
  /** Resolves with the close code once the server closes the connection. */
  done: Promise<number>;
  close(): void;
}

/**
 * Open a raw WS client to `url` and push an arbitrary (forged) frame at it — the
 * adversarial half of the switch-protocol tests. Objects are JSON-stringified;
 * strings/Buffers are sent verbatim. Returns the live socket and a `done` promise
 * so a phase leaf can assert the server's reaction (close code, or a reply frame).
 */
export function injectForgedFrame(url: string, frame: unknown): Promise<ForgedInjection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const done = new Promise<number>((res) => ws.once('close', (code) => res(code)));
    ws.once('open', () => {
      const payload = typeof frame === 'string' || frame instanceof Buffer ? frame : JSON.stringify(frame);
      try { ws.send(payload); } catch (e) { reject(e); return; }
      resolve({ ws, done, close: () => { try { ws.close(); } catch { /* ignore */ } } });
    });
    ws.once('error', reject);
  });
}

/** A renderer-facing client: a logged WS connection mimicking what the browser
 *  side receives, with a `waitFor` so phase leaves assert on delivered frames. */
export interface RendererClient {
  ws: WebSocket;
  /** Every message received as a UTF-8 string, in arrival order. */
  messages: string[];
  /** Resolve once a received message satisfies `pred` (scans the backlog first). */
  waitFor(pred: (msg: string) => boolean, timeoutMs?: number): Promise<string>;
  send(data: string | Buffer): void;
  close(): Promise<void>;
}

/** Connect a renderer-facing client to `url`. The message listener is attached at
 *  construction (before 'open') so a frame flushed during the upgrade is captured
 *  — matching a browser whose onmessage is set before any frame lands. */
export function connectRenderer(url: string): Promise<RendererClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: string[] = [];
    const waiters: Array<{ pred: (m: string) => boolean; res: (m: string) => void }> = [];
    ws.on('message', (d) => {
      const msg = d.toString();
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) { waiters[i].res(msg); waiters.splice(i, 1); }
      }
    });
    ws.once('open', () => {
      resolve({
        ws,
        messages,
        waitFor(pred, timeoutMs = 2000) {
          const hit = messages.find(pred);
          if (hit !== undefined) return Promise.resolve(hit);
          return new Promise<string>((res, rej) => {
            const entry = { pred, res };
            waiters.push(entry);
            setTimeout(() => {
              const idx = waiters.indexOf(entry);
              if (idx !== -1) { waiters.splice(idx, 1); rej(new Error('renderer waitFor timed out')); }
            }, timeoutMs);
          });
        },
        send(data) { ws.send(data); },
        close() {
          return new Promise<void>((res) => {
            if (ws.readyState === WebSocket.CLOSED) return res();
            ws.once('close', () => res());
            ws.close();
          });
        },
      });
    });
    ws.once('error', reject);
  });
}

/** An installed fake clock: advance virtual time, or restore real timers. */
export interface FakeClock {
  /** Advance virtual time by `ms`, flushing timers (await — async-aware). */
  advance(ms: number): Promise<void>;
  restore(): void;
}

/**
 * Install vitest fake timers so lease/heartbeat logic runs sub-second. OPT-IN:
 * the rig never enables this itself (spawning real sidecars needs real timers).
 * A phase leaf installs it AFTER the servers are up, drives the lease/heartbeat
 * logic via `advance(...)`, then `restore()`s. `toFake` defaults to the timer set
 * leases/heartbeats use; real-time I/O (`process.nextTick`, queueMicrotask) is
 * left real so awaited socket round-trips still settle.
 */
export function installFakeClock(toFake: Array<'setTimeout' | 'setInterval' | 'clearTimeout' | 'clearInterval' | 'Date'> = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date']): FakeClock {
  vi.useFakeTimers({ toFake });
  return {
    async advance(ms: number) { await vi.advanceTimersByTimeAsync(ms); },
    restore() { vi.useRealTimers(); },
  };
}

/** Convenience: GET `/api/health` on a sidecar, returning the HTTP status. */
export async function health(s: Sidecar): Promise<number> {
  const r = await fetch(`${s.baseUrl}/api/health`);
  return r.status;
}
