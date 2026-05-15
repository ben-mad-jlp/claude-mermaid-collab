import { createHash } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { mkdir, writeFile, rename, unlink, readdir, readFile, open } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { lock } from 'proper-lockfile';

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

/** Derive a stable 12-char sessionId from (project, session) via sha1. */
export function deriveSessionId(project: string, session: string): string {
  return createHash('sha1').update(project + '\0' + session).digest('hex').slice(0, 12);
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

  let release: () => Promise<void>;
  try {
    release = await lock(paths.lockFile(inst.sessionId), { realpath: false, retries: 0 });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === 'ELOCKED') {
      throw new Error(
        `Duplicate instance for sessionId ${inst.sessionId} — another mermaid-collab server is already running for this (project, session)`
      );
    }
    throw err;
  }
  lockReleaseMap.set(inst.sessionId, release);

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
      release = await lock(lockPath, { realpath: false, retries: 0 });
    } catch {
      // Owner alive — record is valid.
      out.push(original);
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
      let pidAlive = false;
      try { process.kill(original.pid, 0); pidAlive = true; } catch { /* dead */ }
      if (pidAlive) {
        // Defensive: shouldn't happen if owner released the lock, but skip.
        continue;
      }
      await unlink(instPath).catch(() => {});
      await unlink(lockPath).catch(() => {});
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
