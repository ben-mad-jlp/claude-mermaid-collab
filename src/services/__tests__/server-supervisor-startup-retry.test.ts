/**
 * Regression: a FAILED sidecar startup must fail fast and retry, not hang then give up.
 *
 * Incident 2026-08-05. A user's sidecar died ~0.5s into startup (a compiled-in path to
 * another user's node_modules). Two things then made a 0.5s crash into a dead app:
 *
 *   1. waitForHealth kept polling a process that had already exited, for the FULL 60s
 *      health window. That wait is what "the app locks up" actually was — 60s to the
 *      error panel, then another 60s for every press of Retry.
 *   2. start() threw on the first failure. this.port stayed null and the liveness
 *      watchdog — armed only AFTER a successful start — never ran. Nothing ever tried
 *      again, so the app sat on its error panel until a human relaunched it. The fixed
 *      binary was installed 18 minutes later and the app still didn't come up.
 *
 * So: exit ⇒ fail in ~a poll, and a failed attempt ⇒ respawn a bounded number of times.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ServerSupervisor } from '../../../desktop/src/main/server-supervisor';

/** A child that can be made to "already have exited", the way a crashed sidecar has. */
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string[] = [];

  kill(signal?: string): void {
    this.killed.push(signal ?? 'SIGTERM');
    if (this.exitCode == null) this.exitCode = 1;
    process.nextTick(() => this.emit('exit', this.exitCode, this.signalCode));
  }

  /** Simulate a crash-on-startup: the incident's sidecar died at module load, so by
   *  the time anything probed health the process was ALREADY gone. exitCode is set
   *  synchronously for that reason — deferring it to a microtask let the first probe
   *  read a still-null exitCode and report the corpse as healthy, which is a bug in
   *  the fake, not in the supervisor. */
  die(code = 1): void {
    this.exitCode = code;
    queueMicrotask(() => this.emit('exit', code, null));
  }
}

describe('ServerSupervisor startup: fail fast on a dead child, then retry', () => {
  let supervisor: ServerSupervisor | undefined;
  let forensicsDir: string;
  let spawned: FakeChildProcess[] = [];
  /** Per-attempt outcome: true → that child serves; false → it dies immediately. */
  let attemptSucceeds: boolean[] = [];

  // Each test gets its own runtime dir. The port-ownership handshake persists a lock
  // at $XDG_RUNTIME_DIR/mermaid-collab/server-<port>.lock recording the claiming PID —
  // which here is the TEST PROCESS, still very much alive. Share one dir and test N
  // finds test N-1's claim, reads it as "our own server already owns this port",
  // answers 'defer', and attaches instead of spawning; every assertion about spawn
  // counts and retries then passes while testing nothing.
  let runtimeDir: string;
  let supervisorDir: string;
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR;
  const originalSupervisorDir = process.env.MERMAID_SUPERVISOR_DIR;

  beforeEach(() => {
    forensicsDir = mkdtempSync(join(tmpdir(), 'startup-retry-'));
    runtimeDir = mkdtempSync(join(tmpdir(), 'startup-retry-run-'));
    supervisorDir = mkdtempSync(join(tmpdir(), 'startup-retry-sup-'));
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    spawned = [];
    attemptSucceeds = [];
  });
  afterEach(() => {
    supervisor?.stop?.();
    if (originalRuntimeDir !== undefined) process.env.XDG_RUNTIME_DIR = originalRuntimeDir;
    else delete process.env.XDG_RUNTIME_DIR;
    if (originalSupervisorDir !== undefined) process.env.MERMAID_SUPERVISOR_DIR = originalSupervisorDir;
    else delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  const spawnImpl = () => {
    const child = new FakeChildProcess();
    spawned.push(child);
    // Decide this attempt's fate the way the real world does: the process either
    // comes up, or it exits on its own a moment later.
    const ok = attemptSucceeds[spawned.length - 1] ?? true;
    if (!ok) child.die(1);
    return child as any;
  };

  // Healthy iff the CURRENT child is still alive — mirrors a real server, which
  // answers /api/health only while its process is running.
  const fetchImpl = async () => {
    const cur = spawned[spawned.length - 1];
    return { ok: !!cur && cur.exitCode == null } as Response;
  };

  function makeSupervisor(over: Record<string, unknown> = {}) {
    return new ServerSupervisor({
      host: '127.0.0.1',
      port: 9300,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      forensicsFilePath: join(forensicsDir, 'forensics.log'),
      project: '/fake/project',
      session: 'test-session',
      healthTimeoutMs: 5_000,
      healthPollMs: 5,
      startupRetryDelayMs: 1,
      spawnImpl,
      fetchImpl,
      portInUseImpl: async () => false,
      ...over,
    } as any);
  }

  test('a child that exits fails in ~a poll instead of burning the health window', async () => {
    attemptSucceeds = [false];
    supervisor = makeSupervisor({ startupAttempts: 1, healthTimeoutMs: 30_000 });

    const started = Date.now();
    await expect(supervisor.start()).rejects.toThrow(/exited during startup/);
    const elapsed = Date.now() - started;

    // The point of the fix: nowhere near the 30s window it would have sat through.
    // "Fast" means AGAINST THE 60s HEALTH WINDOW this path exists to avoid — not against
    // wall-clock on an idle box. Under the land gate's 6-way file concurrency this took 3989ms
    // while the code behaved perfectly, and the 2s bound blocked THREE different epics' lands
    // on 2026-08-11 (3/3 green in isolation each time). 15s keeps the assertion meaningful:
    // 4x the loaded measurement, 4x under the window it guards.
    expect(elapsed).toBeLessThan(15_000);
  });

  test('the fail-fast error names the exit code, not a bare timeout', async () => {
    attemptSucceeds = [false];
    supervisor = makeSupervisor({ startupAttempts: 1 });
    await expect(supervisor.start()).rejects.toThrow(/code=1/);
  });

  test('a first-attempt failure is retried and the app comes up with no user action', async () => {
    attemptSucceeds = [false, true]; // dies once, then serves
    supervisor = makeSupervisor();

    const res = await supervisor.start();
    expect(res.port).toBe(9300);
    expect(res.attached).toBe(false);
    expect(spawned.length).toBe(2); // respawned rather than surfacing an error
  });

  test('retries are bounded — a permanently broken sidecar still surfaces the error', async () => {
    attemptSucceeds = [false, false, false, false];
    supervisor = makeSupervisor({ startupAttempts: 3 });

    await expect(supervisor.start()).rejects.toThrow(/exited during startup/);
    expect(spawned.length).toBe(3); // exactly the cap, not an infinite loop
  });

  test('a failed attempt is reaped, so it cannot hold the port against the next one', async () => {
    attemptSucceeds = [false, true];
    supervisor = makeSupervisor();
    await supervisor.start();

    // The first child must have been killed; a survivor would still own :9300 and
    // the retry would fail against our own orphan.
    expect(spawned[0].killed.length).toBeGreaterThan(0);
  });

  test('the health watchdog IS armed after a retry succeeds', async () => {
    attemptSucceeds = [false, true];
    supervisor = makeSupervisor();
    await supervisor.start();

    // Pre-fix, a first-attempt failure threw and left the watchdog unarmed forever.
    // checkHealthOnce returning a real verdict (not 'idle') proves this.port is set
    // and the supervisor is live — the recovery half is actually wired up.
    const verdict = await supervisor.checkHealthOnce();
    expect(verdict).not.toBe('idle');
  });

  test('a healthy first attempt still spawns exactly once (no behaviour change)', async () => {
    attemptSucceeds = [true];
    supervisor = makeSupervisor();
    const res = await supervisor.start();
    expect(res.attached).toBe(false);
    expect(spawned.length).toBe(1);
  });
});
