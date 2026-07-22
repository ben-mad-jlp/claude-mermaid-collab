/**
 * Hermetic tripwire guard for test isolation.
 *
 * Patches fs write and child_process spawn functions to prevent pollution:
 * - Detects writes to ~/.mermaid-collab and throws (unless in tmpdir)
 * - Detects detached spawns and throws (unless MERMAID_TEST_ALLOW_DETACHED=1)
 *
 * Wired as a `bun test` preload via bunfig.toml; guards every test that runs.
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

function assertHermeticWritePath(p: string): void {
  const resolved = resolveAbsolutePath(p);
  const tmpResolved = tmpdir();

  // tmpdir check first — must short-circuit before checking forbidden dir
  if (resolved.startsWith(tmpResolved)) {
    return;
  }

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
