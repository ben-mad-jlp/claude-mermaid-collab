import { createHash } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { mkdir, writeFile, rename, unlink, readdir, readFile, open, rm } from 'fs/promises';
import { Socket } from 'net';
import { homedir } from 'os';
import { join } from 'path';
import { lock, type LockOptions } from 'proper-lockfile';

/** Schema for a single live mermaid-collab server instance record on disk. */
export interface Instance {
  version: 1;
  sessionId: string;
  port: number;
  project: string;
  session: string;
  pid: number;
  startedAt: string;
  serverVersion: string;
}

/** Filesystem layout for instance discovery records and their lockfiles. */
export interface DiscoveryPaths {
  root: string;
  instancesDir: string;
  instanceFile(id: string): string;
  lockFile(id: string): string;
}

/** Module-level map of held lockfile release functions, keyed by sessionId. */
const lockReleaseMap = new Map<string, () => Promise<void>>();

/** Module-level per-id mutex for serializing lock/cleanup operations on the same id. */
const idMutex = new Map<string, Promise<void>>();

/** Module-level flag indicating global signal handlers have been installed. */
let globalHandlersInstalled = false;

/** Compute the discovery paths rooted at the given home directory (defaults to $HOME). */
export function getDiscoveryPaths(home: string = homedir()): DiscoveryPaths {
  const root = join(home, '.mermaid-collab');
  const instancesDir = join(root, 'instances');
  return {
    root,
    instancesDir,
    instanceFile: (id: string) => join(instancesDir, `${id}.json`),
    lockFile: (id: string) => join(instancesDir, `${id}.lock`),
  };
}

/**
 * Liveness probe: is `pid` a running process? `process.kill(pid, 0)` throws
 * ESRCH when the process is gone (a SIGKILL'd server) and EPERM when it exists
 * but is owned by another user — EPERM still means alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code === 'EPERM';
  }
}

/**
 * Liveness probe: is something accepting TCP connections on host:port? Used to
 * distinguish a genuinely-live server from a stale instance file whose pid was
 * recycled by an unrelated process (pid-alive but nothing listening → dead).
 */
export function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (alive: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best-effort */ }
      resolve(alive);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/** Derive a stable 12-char sessionId from (project, session) via sha1. */
export function deriveSessionId(project: string, session: string): string {
  return createHash('sha1').update(project + '\0' + session).digest('hex').slice(0, 12);
}

/**
 * Build lock options with a safe onCompromised handler that synchronously clears
 * the lockReleaseMap entry and calls its cleanup, never throwing or leaving
 * rejections unhandled.
 */
export function buildLockOptions(id: string): LockOptions {
  return {
    realpath: false,
    retries: 0,
    onCompromised: (err: Error) => {
      console.warn(`[instance-discovery] lock compromised for ${id}: ${err.message}`);
      const release = lockReleaseMap.get(id);
      lockReleaseMap.delete(id);
      if (release) {
        release().catch(() => {});
      }
    },
  };
}

/**
 * Serialize operations on the same id by chaining them onto a per-id tail promise.
 * Ensures that concurrent lock() and cleanup operations for the same id cannot
 * interleave. A throwing fn() does not stall later calls for the same id.
 */
export async function withPerIdLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prior = idMutex.get(id) ?? Promise.resolve();
  const settled = prior.catch(() => {}) as Promise<void>;
  const current = settled.then(() => fn());
  const settled_tail = current.then(() => {}, () => {}) as Promise<void>;
  idMutex.set(id, settled_tail);
  try {
    return await current;
  } finally {
    if (idMutex.get(id) === settled_tail) {
      idMutex.delete(id);
    }
  }
}

/**
 * True when `err` reflects an already-held proper-lockfile lock — either the
 * coded `ELOCKED` form or a message-only variant carrying the same phrase.
 */
function isLockHeldError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    if ((err as { code?: string }).code === 'ELOCKED') return true;
    const message = (err as { message?: string }).message;
    if (typeof message === 'string' && message.includes('already being held')) return true;
  }
  return false;
}

/**
 * Steal a STALE instance lock whose owner is provably dead — the hot-swap case:
 * the supervisor SIGKILL'd the old sidecar, but proper-lockfile keeps its lock
 * "fresh" (mtime < staleness window), so an immediate respawn would hit ELOCKED
 * and refuse to start. We read the recorded owner pid; if it's dead (or there's
 * no record behind the lock at all), remove proper-lockfile's lock dir + the
 * stale record so a fresh acquire succeeds. A LIVE owner returns false → the
 * caller throws the genuine duplicate error. Best-effort; never throws.
 */
async function stealStaleInstanceLock(sessionId: string, paths: DiscoveryPaths): Promise<boolean> {
  if (lockReleaseMap.has(sessionId)) return false; // this process already legitimately holds it
  try {
    const raw = await readFile(paths.instanceFile(sessionId), 'utf8');
    const rec = JSON.parse(raw) as Instance;
    if (typeof rec.pid === 'number' && isPidAlive(rec.pid)) return false; // genuine live duplicate
  } catch {
    /* no/unreadable record behind the lock → treat as a steal-able orphan */
  }
  // proper-lockfile locks `<file>` by creating the directory `<file>.lock`.
  await rm(paths.lockFile(sessionId) + '.lock', { recursive: true, force: true }).catch(() => {});
  await unlink(paths.instanceFile(sessionId)).catch(() => {});
  return true;
}

/** Atomically write an instance record and acquire its exclusive lockfile; throws on duplicate. */
export async function writeInstance(inst: Instance, paths: DiscoveryPaths = getDiscoveryPaths()): Promise<void> {
  if (lockReleaseMap.has(inst.sessionId)) {
    throw new Error(
      `Instance for sessionId ${inst.sessionId} already registered in this process — call removeInstance first`
    );
  }
  await mkdir(paths.instancesDir, { recursive: true });
  // proper-lockfile requires the target file to exist
  await writeFile(paths.lockFile(inst.sessionId), '', { flag: 'a' });

  const release = await withPerIdLock(inst.sessionId, async () => {
    try {
      const rel = await lock(paths.lockFile(inst.sessionId), buildLockOptions(inst.sessionId));
      lockReleaseMap.set(inst.sessionId, rel);
      return rel;
    } catch (err: unknown) {
      if (isLockHeldError(err)) {
        // The lock is held. If its owner is a DEAD predecessor (hot-swap respawn
        // racing the SIGKILL'd old sidecar's still-fresh lock), steal it and retry
        // once; a LIVE owner is a real duplicate and still throws. We already hold
        // the per-id turn, so steal directly — no nested withPerIdLock (would deadlock).
        if (await stealStaleInstanceLock(inst.sessionId, paths)) {
          const rel = await lock(paths.lockFile(inst.sessionId), buildLockOptions(inst.sessionId));
          lockReleaseMap.set(inst.sessionId, rel);
          return rel;
        } else {
          throw new Error(
            `Duplicate instance for sessionId ${inst.sessionId} — another mermaid-collab server is already running for this (project, session)`
          );
        }
      } else {
        throw err;
      }
    }
  });

  const target = paths.instanceFile(inst.sessionId);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(inst, null, 2));
  const fh = await open(tmp, 'r+');
  await fh.sync();
  await fh.close();
  try {
    await rename(tmp, target);
  } catch (err) {
    try { await unlink(tmp); } catch { /* best-effort */ }
    throw err;
  }
}

/** Idempotently release the lock and delete the instance record for sessionId; never throws. */
export async function removeInstance(sessionId: string, paths: DiscoveryPaths = getDiscoveryPaths()): Promise<void> {
  const release = lockReleaseMap.get(sessionId);
  if (release) {
    try { await release(); } catch { /* swallow */ }
    lockReleaseMap.delete(sessionId);
  }
  try { await unlink(paths.instanceFile(sessionId)); } catch { /* swallow ENOENT and others */ }
  try { await unlink(paths.lockFile(sessionId)); } catch { /* swallow ENOENT and others */ }
}

/** List all live instances, garbage-collecting stale records whose owners are dead. */
export async function readInstances(paths: DiscoveryPaths = getDiscoveryPaths()): Promise<Instance[]> {
  if (!existsSync(paths.instancesDir)) return [];
  const files = await readdir(paths.instancesDir);
  const out: Instance[] = [];
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    const instPath = paths.instanceFile(id);
    const lockPath = paths.lockFile(id);

    // Step 1: read + parse the JSON before touching the lock.
    let original: Instance;
    try {
      const raw = await readFile(instPath, 'utf8');
      original = JSON.parse(raw) as Instance;
      if (typeof original?.pid !== 'number' || typeof original?.startedAt !== 'string') {
        console.warn(`[instance-discovery] skip ${id}: missing pid/startedAt`);
        continue;
      }
    } catch {
      // Can't read or parse → skip; don't unlink (might be mid-write by owner).
      continue;
    }

    // Step 2: try to acquire the lock non-blocking.
    let release: (() => Promise<void>) | undefined;
    try {
      release = await withPerIdLock(id, () => lock(lockPath, buildLockOptions(id)));
    } catch {
      // Lock held — but the owner may have been SIGKILL'd, leaving an
      // orphan lock that proper-lockfile won't release until its staleness
      // window elapses. Probe the pid directly.
      if (isPidAlive(original.pid)) {
        out.push(original);
        continue;
      }
      // Owner is dead but lock is orphaned — best-effort cleanup of both
      // files and skip. proper-lockfile will eventually GC its lock dir.
      await withPerIdLock(id, async () => {
        await unlink(instPath).catch(() => {});
        await unlink(lockPath).catch(() => {});
      });
      continue;
    }

    // Step 3+: lock acquired — verify ownership claim before unlinking.
    try {
      let current: Instance | null = null;
      try {
        const raw2 = await readFile(instPath, 'utf8');
        current = JSON.parse(raw2) as Instance;
      } catch {
        // File gone or unreadable — nothing to clean up further.
        continue;
      }
      const sameContent =
        current !== null &&
        current.pid === original.pid &&
        current.startedAt === original.startedAt;
      if (!sameContent) {
        // Another process took over between our read and our lock; leave it alone.
        continue;
      }
      // Lock was free, so no live owner holds it. Treat the record as live
      // ONLY if its pid is still running AND something is listening on the
      // recorded port — this reaps both SIGKILL'd servers (pid gone) and the
      // subtler case where the pid was recycled by an unrelated process
      // (pid-alive but the port is dead). Either way the record is stale.
      if (isPidAlive(original.pid) && (await isPortListening(original.port))) {
        // Defensive: a genuinely-live server that released its lock — leave it.
        continue;
      }
      await withPerIdLock(id, async () => {
        await unlink(instPath).catch(() => {});
        await unlink(lockPath).catch(() => {});
      });
    } catch (err) {
      console.warn(`[instance-discovery] failed to process ${name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (release) {
        try { await release(); } catch { /* swallow */ }
      }
    }
  }
  return out;
}

/** Find the first live instance matching project (and optionally session); returns null if none. */
export async function findInstance(
  project: string,
  session?: string,
  paths: DiscoveryPaths = getDiscoveryPaths()
): Promise<Instance | null> {
  const instances = await readInstances(paths);
  return instances.find(i => i.project === project && (!session || i.session === session)) ?? null;
}

/** Install one-shot SIGINT/SIGTERM and exit handlers to clean up the instance record on shutdown. */
export function installSignalHandlers(_sessionId: string): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  process.once('SIGINT', () => {
    Promise.all([...lockReleaseMap.keys()].map(id => removeInstance(id).catch(() => {})))
      .finally(() => process.exit(130));
  });
  process.once('SIGTERM', () => {
    Promise.all([...lockReleaseMap.keys()].map(id => removeInstance(id).catch(() => {})))
      .finally(() => process.exit(143));
  });
  process.on('exit', () => {
    const paths = getDiscoveryPaths();
    for (const id of lockReleaseMap.keys()) {
      try { unlinkSync(paths.instanceFile(id)); } catch { /* best-effort */ }
      try { unlinkSync(paths.lockFile(id)); } catch { /* best-effort */ }
    }
  });
}
