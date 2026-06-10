/**
 * Canonical :9002 port-ownership protocol (the spine of the Linux/Ubuntu port —
 * design-ubuntu-native §4). Exactly one process owns the canonical port, and
 * every starter (systemd ExecStartPre, the Electron ServerSupervisor, the plugin
 * SessionStart/PreToolUse hook, and the bare CLI) must prove it is the rightful
 * owner via this bind-time handshake before binding. Lands on macOS too, where it
 * fixes the live "stale plugin-cache `bun run src/server.ts` shadows the desktop
 * app" bug that made deploys cosmetic.
 *
 * Everything here is platform-agnostic and dependency-injectable so the handshake
 * and the O_EXCL lock mutex can be unit-tested without real sockets or processes.
 */
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Identity block returned by GET /api/health (the unauthenticated route). */
export interface ServerIdentity {
  ok: boolean;
  version: string;
  pid: number;
  /** readlink(/proc/self/exe) on Linux; process.execPath elsewhere. */
  exePath: string;
  startedAt: string;
  /** desktop | headless | dev — who plays the supervisor role. */
  owner: string;
}

/** On-disk lockfile record at $XDG_RUNTIME_DIR/mermaid-collab/server.lock. */
export interface LockData {
  pid: number;
  exePath: string;
  version: string;
  port: number;
  owner: string;
}

/** Guard policy for a held, foreign/stale port. */
export type GuardMode = 'takeover' | 'refuse';

/** Outcome of the ownership handshake. */
export type HandshakeAction =
  /** Port is ours to bind (was free, or a stale holder was evicted). */
  | 'proceed'
  /** A current/newer matching owner already holds the port — defer (idempotent no-op). */
  | 'defer'
  /** A foreign/stale holder exists but guard mode forbids eviction — surface a conflict. */
  | 'refuse';

export interface HandshakeResult {
  action: HandshakeAction;
  reason: string;
  /** Identity of whoever held the port at probe time, if any. */
  holder?: ServerIdentity | null;
}

/** Resolve the runtime lock directory: $XDG_RUNTIME_DIR (tmpfs, self-clearing) → tmpdir() fallback (macOS). */
export function lockDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_RUNTIME_DIR && env.XDG_RUNTIME_DIR.trim() ? env.XDG_RUNTIME_DIR : os.tmpdir();
  return path.join(base, 'mermaid-collab');
}

/** Path to the canonical ownership lockfile. */
export function lockPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(lockDir(env), 'server.lock');
}

/** Path to the short-lived takeover mutex (serializes concurrent take-overs — risk #1). */
export function takeoverMutexPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(lockDir(env), 'server.takeover.lock');
}

/**
 * The real path of the currently-running executable. On Linux this is the
 * canonical /proc/self/exe symlink — the thing macOS lacks and the reason a
 * spoofed health response can be cross-checked against /proc/<pid>/exe. Falls
 * back to process.execPath when /proc is unavailable.
 */
export function currentExePath(): string {
  try {
    if (process.platform === 'linux' && fs.existsSync('/proc/self/exe')) {
      return fs.readlinkSync('/proc/self/exe');
    }
  } catch {
    /* fall through */
  }
  return process.execPath;
}

/** The real binary path of another pid via /proc/<pid>/exe (Linux only; null otherwise). */
export function exePathOfPid(pid: number): string | null {
  try {
    if (process.platform === 'linux') return fs.readlinkSync(`/proc/${pid}/exe`);
  } catch {
    /* unreadable / gone / not linux */
  }
  return null;
}

/** This server's declared owner role (MERMAID_OWNER), defaulting to 'dev'. */
export function serverOwner(env: NodeJS.ProcessEnv = process.env): string {
  return env.MERMAID_OWNER && env.MERMAID_OWNER.trim() ? env.MERMAID_OWNER : 'dev';
}

/**
 * Acquire a file as a mutex via open(O_CREAT|O_EXCL). Returns true iff THIS call
 * created the file (i.e. won the race); false if it already existed. The O_EXCL
 * flag makes creation atomic across processes — the primitive the concurrency
 * test exercises and the guarantee that two simultaneous starters never both
 * proceed to bind/kill.
 */
export function acquireExclusive(filePath: string, contents: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    try {
      fs.writeSync(fd, contents);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

/** Write (or overwrite) the canonical ownership lockfile. Called by the server on a successful bind. */
export function writeLock(data: LockData, env: NodeJS.ProcessEnv = process.env): void {
  const p = lockPath(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data), { mode: 0o600 });
}

/** Read and parse the ownership lockfile, or null if absent/corrupt. */
export function readLock(env: NodeJS.ProcessEnv = process.env): LockData | null {
  try {
    const raw = fs.readFileSync(lockPath(env), 'utf8');
    const parsed = JSON.parse(raw) as LockData;
    if (typeof parsed.pid === 'number' && typeof parsed.port === 'number') return parsed;
  } catch {
    /* missing / unreadable / corrupt */
  }
  return null;
}

/** Remove the ownership lockfile iff it still records our pid (best-effort, on shutdown). */
export function releaseLock(pid: number = process.pid, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const lock = readLock(env);
    if (lock && lock.pid === pid) fs.unlinkSync(lockPath(env));
  } catch {
    /* best-effort */
  }
}

/** Probe whether `pid` is alive (signal 0). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Parse a dotted version ("5.90.1") into comparable numeric segments. */
function parseVersion(v: string): number[] {
  return v.split('.').map((s) => parseInt(s, 10) || 0);
}

/** Compare two dotted versions: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether a port holder is a current/newer rightful owner we must DEFER to
 * (vs a stale/foreign shadow to evict). Same executable AND same-or-newer version
 * → rightful owner. Any difference in exePath, or an older version, → stale/foreign.
 */
export function isRightfulOwner(holder: ServerIdentity, self: { exePath: string; version: string }): boolean {
  if (holder.exePath && self.exePath && holder.exePath !== self.exePath) return false;
  return compareVersions(holder.version, self.version) >= 0;
}

/** True if TCP `port` accepts a connection on `host` (i.e. something is listening). */
export function isPortInUse(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (inUse: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Poll until `port` is free (no listener) or the timeout elapses. Returns true if it freed. */
export async function waitForPortFree(port: number, host: string, timeoutMs: number, pollMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortInUse(port, host, 500))) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return !(await isPortInUse(port, host, 500));
}

/** Fetch the identity block from GET /api/health, or null if it doesn't answer/parse. */
export async function readHealthIdentity(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 1500,
  fetchImpl: typeof fetch = fetch,
): Promise<ServerIdentity | null> {
  try {
    const r = await fetchImpl(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const body = (await r.json()) as Partial<ServerIdentity>;
    if (typeof body.pid !== 'number' || typeof body.version !== 'string') return null;
    return {
      ok: true,
      version: body.version,
      pid: body.pid,
      exePath: body.exePath ?? '',
      startedAt: body.startedAt ?? '',
      owner: body.owner ?? '',
    };
  } catch {
    return null;
  }
}

export interface HandshakeDeps {
  host?: string;
  guardMode?: GuardMode;
  /** Explicit canonical port to claim. Overrides the lock-derived / env PORT. */
  port?: number;
  env?: NodeJS.ProcessEnv;
  self?: { exePath: string; version: string; owner: string };
  fetchImpl?: typeof fetch;
  /** Send a signal to a pid. Injectable for tests; defaults to process.kill. */
  killImpl?: (pid: number, signal: NodeJS.Signals) => void;
  /** Probe a port. Injectable for tests; defaults to isPortInUse. */
  portInUseImpl?: (port: number, host: string) => Promise<boolean>;
  /** Kill grace before SIGKILL, and the port-free wait budget. */
  termGraceMs?: number;
  portFreeTimeoutMs?: number;
}

/**
 * The bind-time take-over-or-refuse handshake. Run by every starter BEFORE
 * binding (CLI `start`, `preflight`, the Electron supervisor). Returns the action
 * the caller must take; it never binds the port itself.
 *
 *   port free            → acquire O_EXCL claim → 'proceed' (caller binds)
 *   rightful owner held  → 'defer' (idempotent no-op; desktop just opens its window)
 *   stale/foreign held   → takeover: TERM→KILL the holder, wait port free → 'proceed'
 *                          refuse:   'refuse' (systemd surfaces the conflict)
 *   held, health dead    → kill the lock pid iff it's ours; else 'refuse' (never kill an unknown process)
 */
export async function performHandshake(deps: HandshakeDeps = {}): Promise<HandshakeResult> {
  const host = deps.host ?? '127.0.0.1';
  const env = deps.env ?? process.env;
  const guardMode: GuardMode = deps.guardMode ?? (env.MERMAID_GUARD_MODE as GuardMode) ?? 'takeover';
  const self =
    deps.self ?? { exePath: currentExePath(), version: '', owner: serverOwner(env) };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const killImpl = deps.killImpl ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const portInUse = deps.portInUseImpl ?? ((p: number, h: string) => isPortInUse(p, h));
  const termGraceMs = deps.termGraceMs ?? 5000;
  const portFreeTimeoutMs = deps.portFreeTimeoutMs ?? 8000;

  const lock = readLock(env);
  const port = deps.port ?? lock?.port ?? Number(env.PORT ?? '9002');

  const inUse = await portInUse(port, host);

  // 1. Port free → claim it via the O_EXCL mutex, then proceed to bind.
  if (!inUse) {
    const claim = JSON.stringify({
      pid: process.pid, exePath: self.exePath, version: self.version, port, owner: self.owner,
    });
    if (acquireExclusive(lockPath(env), claim)) {
      return { action: 'proceed', reason: 'port-free-claimed', holder: null };
    }
    // A lockfile already exists but the port is FREE → its recorded owner isn't
    // listening. If that owner process is gone, the lock is stale: drop it and
    // re-claim. Only a genuinely-alive concurrent starter makes us defer.
    if (lock && isPidAlive(lock.pid)) {
      return { action: 'defer', reason: 'claim-lost-to-concurrent-starter', holder: null };
    }
    try { fs.unlinkSync(lockPath(env)); } catch { /* raced away */ }
    if (acquireExclusive(lockPath(env), claim)) {
      return { action: 'proceed', reason: 'reclaimed-stale-lock', holder: null };
    }
    return { action: 'defer', reason: 'claim-lost-to-concurrent-starter', holder: null };
  }

  // 2. Port held — interrogate the holder's identity.
  const holder = await readHealthIdentity(port, host, 1500, fetchImpl);

  // 2a. Health dead (zombie / foreign non-collab process holding the port).
  if (!holder) {
    if (lock && isPidAlive(lock.pid)) {
      // It's recorded in OUR lockfile → it's our (hung) server; evict it under takeover.
      if (guardMode === 'refuse') return { action: 'refuse', reason: 'held-health-dead-refuse', holder: null };
      await evict(lock.pid, port, host, killImpl, portInUse, termGraceMs, portFreeTimeoutMs);
      acquireExclusive(takeoverMutexPath(env), String(process.pid));
      return { action: 'proceed', reason: 'evicted-dead-own-holder', holder: null };
    }
    // Unknown process, no health, not in our lock → never kill blindly.
    return { action: 'refuse', reason: 'held-by-unknown-process', holder: null };
  }

  // 2b. Rightful owner (same exe, same-or-newer version) → defer.
  if (isRightfulOwner(holder, self)) {
    return { action: 'defer', reason: 'rightful-owner-present', holder };
  }

  // 2c. Stale/foreign collab server (the shadow). Refuse or take over.
  if (guardMode === 'refuse') {
    return { action: 'refuse', reason: 'stale-holder-refuse-mode', holder };
  }

  // Serialize concurrent take-overs with the O_EXCL mutex BEFORE killing (risk #1).
  if (!acquireExclusive(takeoverMutexPath(env), String(process.pid))) {
    // Another starter is taking over — defer to the owner it will install.
    return { action: 'defer', reason: 'takeover-in-progress-elsewhere', holder };
  }
  try {
    // Cross-check the holder's real binary so exePath can't be spoofed (Linux).
    const realExe = exePathOfPid(holder.pid);
    if (realExe && self.exePath && realExe === self.exePath) {
      // Real binary matches ours after all — it's a rightful owner, don't kill.
      return { action: 'defer', reason: 'real-exe-matches-self', holder };
    }
    await evict(holder.pid, port, host, killImpl, portInUse, termGraceMs, portFreeTimeoutMs);
    return { action: 'proceed', reason: 'took-over-stale-holder', holder };
  } finally {
    try {
      fs.unlinkSync(takeoverMutexPath(env));
    } catch {
      /* best-effort */
    }
  }
}

/** Bounded TERM → (grace) → KILL of a holder pid, then wait for the port to free. */
async function evict(
  pid: number,
  port: number,
  host: string,
  killImpl: (pid: number, signal: NodeJS.Signals) => void,
  portInUse: (port: number, host: string) => Promise<boolean>,
  termGraceMs: number,
  portFreeTimeoutMs: number,
): Promise<void> {
  try {
    killImpl(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  const start = Date.now();
  while (Date.now() - start < termGraceMs) {
    if (!isPidAlive(pid) && !(await portInUse(port, host))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isPidAlive(pid)) {
    try {
      killImpl(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  // Poll until the port actually frees (the OS may hold it briefly post-kill).
  const deadline = Date.now() + portFreeTimeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port, host))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}
