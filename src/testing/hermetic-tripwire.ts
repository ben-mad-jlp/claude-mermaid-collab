/**
 * Hermetic tripwire guard for test isolation.
 *
 * Patches fs write and child_process spawn functions to prevent pollution:
 * - Detects writes to ~/.mermaid-collab and throws (unless in tmpdir)
 * - Detects detached spawns and throws (unless MERMAID_TEST_ALLOW_DETACHED=1)
 *
 * Wired as a `bun test` preload via bunfig.toml; guards every test that runs.
 *
 * bun:sqlite `new Database(path)` construction (e.g. supervisor-store.ts) never goes through
 * node:fs, so it is guarded separately below: the bun:sqlite `Database` export is replaced
 * with a subclass whose constructor runs the same assertHermeticWritePath check on string
 * paths before calling super(). Store isolation is further reinforced by defaulting
 * MERMAID_SUPERVISOR_DIR to a per-process tmpdir (below), so every store that reads that env
 * var opens its DB under tmpdir in tests — the two mechanisms are complementary.
 */

import fs from 'node:fs';
import cp from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// Mark that this preload has been loaded
if (typeof (globalThis as any).__hermeticTripwireLoaded === 'undefined') {
  (globalThis as any).__hermeticTripwireLoaded = true;
}

export class HermeticTripwireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HermeticTripwireError';
  }
}

export const ALLOW_DETACHED_ENV = 'MERMAID_TEST_ALLOW_DETACHED';
const FORBIDDEN_HOME_DIR = join(homedir(), '.mermaid-collab');
const TMPDIR_RESOLVED = tmpdir();

function resolveAbsolutePath(p: string): string {
  // Normalize to absolute path
  if (p.startsWith('/')) return p;
  return join(process.cwd(), p);
}

export function isHermeticAllowedPath(p: string): boolean {
  return p === ':memory:' || resolveAbsolutePath(p).startsWith(tmpdir());
}

function assertHermeticWritePath(p: string): void {
  if (isHermeticAllowedPath(p)) {
    return;
  }

  const resolved = resolveAbsolutePath(p);
  const tmpResolved = tmpdir();

  // Check forbidden home dir
  if (resolved.startsWith(FORBIDDEN_HOME_DIR)) {
    throw new HermeticTripwireError(
      `Hermetic violation: write to forbidden home dir (${resolved}). Writes must be to tmpdir. [tmpdir=${tmpResolved}, forbidden=${FORBIDDEN_HOME_DIR}]`,
    );
  }
}

function assertDetachedAllowed(opts: { detached?: boolean } | undefined): void {
  if (opts?.detached === true) {
    if (process.env[ALLOW_DETACHED_ENV] !== '1') {
      throw new HermeticTripwireError(
        `Hermetic violation: detached spawn without ${ALLOW_DETACHED_ENV}=1. Set the env var to allow this spawn.`,
      );
    }
  }
}

export const HERMETIC_SUPERVISOR_DIR_PREFIX = 'mermaid-hermetic-supervisor-';

// Default MERMAID_SUPERVISOR_DIR to a per-process tmpdir before any store module can be
// imported, so bun:sqlite writes (invisible to the fs patches below) land under tmpdir
// instead of the real ~/.mermaid-collab home dir. An explicitly-set value (e.g. a suite's
// own mkdtemp dir) is preserved verbatim.
if (!process.env.MERMAID_SUPERVISOR_DIR) {
  const hermeticSupervisorDir = join(TMPDIR_RESOLVED, `${HERMETIC_SUPERVISOR_DIR_PREFIX}${process.pid}`);
  fs.mkdirSync(hermeticSupervisorDir, { recursive: true });
  process.env.MERMAID_SUPERVISOR_DIR = hermeticSupervisorDir;
}

// Default MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG to '1' so isTransientProjectPath
// keeps its pre-widening (worktree-only) behavior under `bun test`: tests
// legitimately register/write project config at mkdtemp tmpdir roots, and widening
// the predicate unguarded would make ProjectRegistry.register/list/migrateProjectKinds
// silently no-op for every such suite. A strictness test that wants the widened
// (tmpdir-excluding) behavior opts back in by clearing the env var itself.
if (!process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG) {
  process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';
}

// Ensure idempotent patching — guard against double-wrapping on re-import
if ((fs.writeFileSync as any).__hermeticTripwire !== true) {
  // Save originals
  const origWriteFileSync = fs.writeFileSync;
  const origAppendFileSync = fs.appendFileSync;
  const origMkdirSync = fs.mkdirSync;
  const origOpenSync = fs.openSync;
  const origRmSync = fs.rmSync;
  const origPromisesWriteFile = fs.promises.writeFile;
  const origPromisesAppendFile = fs.promises.appendFile;
  const origPromisesMkdir = fs.promises.mkdir;
  const origCpSpawn = cp.spawn;
  const origCpSpawnSync = cp.spawnSync;
  const origBunSpawn = Bun.spawn;
  const origBunSpawnSync = Bun.spawnSync;

  // Patch fs.writeFileSync
  (fs.writeFileSync as any) = function (this: any, path: any, data: any, options?: any) {
    assertHermeticWritePath(path);
    return origWriteFileSync.call(this, path, data, options);
  };

  // Patch fs.appendFileSync
  (fs.appendFileSync as any) = function (this: any, path: any, data: any, options?: any) {
    assertHermeticWritePath(path);
    return origAppendFileSync.call(this, path, data, options);
  };

  // Patch fs.mkdirSync
  (fs.mkdirSync as any) = function (this: any, path: any, options?: any) {
    assertHermeticWritePath(path);
    return origMkdirSync.call(this, path, options);
  };

  // Patch fs.openSync
  (fs.openSync as any) = function (this: any, path: any, flags?: any, mode?: any) {
    assertHermeticWritePath(path);
    return origOpenSync.call(this, path, flags, mode);
  };

  // Patch fs.rmSync
  (fs.rmSync as any) = function (this: any, path: any, options?: any) {
    assertHermeticWritePath(path);
    return origRmSync.call(this, path, options);
  };

  // Patch fs.promises.writeFile
  (fs.promises.writeFile as any) = async function (this: any, path: any, data: any, options?: any) {
    assertHermeticWritePath(path);
    return origPromisesWriteFile.call(this, path, data, options);
  };

  // Patch fs.promises.appendFile
  (fs.promises.appendFile as any) = async function (this: any, path: any, data: any, options?: any) {
    assertHermeticWritePath(path);
    return origPromisesAppendFile.call(this, path, data, options);
  };

  // Patch fs.promises.mkdir
  (fs.promises.mkdir as any) = async function (this: any, path: any, options?: any) {
    assertHermeticWritePath(path);
    return origPromisesMkdir.call(this, path, options);
  };

  // Patch cp.spawn — handle both spawn(cmd, args, opts) and spawn(cmd, opts) overloads
  (cp.spawn as any) = function (this: any, cmd: any, args?: any, opts?: any) {
    const actualOpts = Array.isArray(args) ? opts : args;
    assertDetachedAllowed(actualOpts);
    return origCpSpawn.call(this, cmd, args, opts);
  };

  // Patch cp.spawnSync — same overload handling
  (cp.spawnSync as any) = function (this: any, cmd: any, args?: any, opts?: any) {
    const actualOpts = Array.isArray(args) ? opts : args;
    assertDetachedAllowed(actualOpts);
    return origCpSpawnSync.call(this, cmd, args, opts);
  };

  // Patch Bun.spawn — Bun.spawn(argv, opts?) or Bun.spawn(opts)
  (Bun as any).spawn = function (this: any, argv: any, opts?: any) {
    const actualOpts = Array.isArray(argv) ? opts : argv;
    assertDetachedAllowed(actualOpts);
    return origBunSpawn.call(this, argv, opts);
  };

  // Patch Bun.spawnSync — same logic
  (Bun as any).spawnSync = function (this: any, argv: any, opts?: any) {
    const actualOpts = Array.isArray(argv) ? opts : argv;
    assertDetachedAllowed(actualOpts);
    return origBunSpawnSync.call(this, argv, opts);
  };

  // Mark as patched
  (fs.writeFileSync as any).__hermeticTripwire = true;
}

// Guard bun:sqlite Database construction — separate idempotency marker from the fs/spawn
// patches above since this patches a different module's export, not a global.
// Use a Proxy around the original constructor to maintain prototype transparency:
// - Database.prototype === OrigDatabase.prototype (same object)
// - instances are instanceof OrigDatabase
// - prototype patches (e.g., Database.prototype.query) are observed by all instances
const sqlite: any = require('bun:sqlite');
const OrigDatabase: any = sqlite.Database;
if (!OrigDatabase.__hermeticTripwire) {
  const WATCHED_PROJECT_INSERT_RE = /\bINSERT\b[\s\S]*\bwatched_project\b/i;
  const DB_PATHS = new WeakMap<object, string>();

  // Create a Proxy that intercepts `new` calls, checks the path, then constructs with the original
  const DatabaseProxy = new Proxy(OrigDatabase, {
    construct(target, args, newTarget) {
      const [path, options] = args;
      if (typeof path === 'string' && path !== ':memory:') {
        assertHermeticWritePath(path);
      }
      const inst = Reflect.construct(target, args, newTarget);
      if (typeof path === 'string') {
        DB_PATHS.set(inst, path);
      }
      return inst;
    }
  });

  (DatabaseProxy as any).__hermeticTripwire = true;

  // Patch Database.prototype methods to guard watched_project INSERTs
  if (!(OrigDatabase.prototype as any).prepare?.__hermeticTripwireWatchedGuard) {
    const origPrepare = OrigDatabase.prototype.prepare;
    (OrigDatabase.prototype.prepare as any) = function (this: any, sql?: any) {
      if (typeof sql === 'string' && WATCHED_PROJECT_INSERT_RE.test(sql)) {
        const path = DB_PATHS.get(this) ?? (typeof (this as any)?.filename === 'string' ? (this as any).filename : undefined);
        if (path && !isHermeticAllowedPath(path)) {
          throw new HermeticTripwireError(
            `Hermetic violation: INSERT into watched_project table on non-tmpdir store (${path}). Watched project operations must use a tmpdir store.`,
          );
        }
      }
      return origPrepare.call(this, sql);
    };
    (OrigDatabase.prototype.prepare as any).__hermeticTripwireWatchedGuard = true;
  }

  if (!(OrigDatabase.prototype as any).query?.__hermeticTripwireWatchedGuard) {
    const origQuery = OrigDatabase.prototype.query;
    (OrigDatabase.prototype.query as any) = function (this: any, sql?: any) {
      if (typeof sql === 'string' && WATCHED_PROJECT_INSERT_RE.test(sql)) {
        const path = DB_PATHS.get(this) ?? (typeof (this as any)?.filename === 'string' ? (this as any).filename : undefined);
        if (path && !isHermeticAllowedPath(path)) {
          throw new HermeticTripwireError(
            `Hermetic violation: INSERT into watched_project table on non-tmpdir store (${path}). Watched project operations must use a tmpdir store.`,
          );
        }
      }
      return origQuery.call(this, sql);
    };
    (OrigDatabase.prototype.query as any).__hermeticTripwireWatchedGuard = true;
  }

  if (!(OrigDatabase.prototype as any).run?.__hermeticTripwireWatchedGuard) {
    const origRun = OrigDatabase.prototype.run;
    (OrigDatabase.prototype.run as any) = function (this: any, sql?: any) {
      if (typeof sql === 'string' && WATCHED_PROJECT_INSERT_RE.test(sql)) {
        const path = DB_PATHS.get(this) ?? (typeof (this as any)?.filename === 'string' ? (this as any).filename : undefined);
        if (path && !isHermeticAllowedPath(path)) {
          throw new HermeticTripwireError(
            `Hermetic violation: INSERT into watched_project table on non-tmpdir store (${path}). Watched project operations must use a tmpdir store.`,
          );
        }
      }
      return origRun.call(this, sql);
    };
    (OrigDatabase.prototype.run as any).__hermeticTripwireWatchedGuard = true;
  }

  if (!(OrigDatabase.prototype as any).exec?.__hermeticTripwireWatchedGuard) {
    const origExec = OrigDatabase.prototype.exec;
    (OrigDatabase.prototype.exec as any) = function (this: any, sql?: any) {
      if (typeof sql === 'string' && WATCHED_PROJECT_INSERT_RE.test(sql)) {
        const path = DB_PATHS.get(this) ?? (typeof (this as any)?.filename === 'string' ? (this as any).filename : undefined);
        if (path && !isHermeticAllowedPath(path)) {
          throw new HermeticTripwireError(
            `Hermetic violation: INSERT into watched_project table on non-tmpdir store (${path}). Watched project operations must use a tmpdir store.`,
          );
        }
      }
      return origExec.call(this, sql);
    };
    (OrigDatabase.prototype.exec as any).__hermeticTripwireWatchedGuard = true;
  }

  Object.defineProperty(sqlite, 'Database', {
    value: DatabaseProxy,
    configurable: true,
    writable: true,
  });
  if (sqlite.default && sqlite.default.Database === OrigDatabase) {
    Object.defineProperty(sqlite.default, 'Database', {
      value: DatabaseProxy,
      configurable: true,
      writable: true,
    });
  }
}
