/**
 * @serial-test-lane: this file drives a real SIGTERM/SIGKILL escalation race against a fake
 * child process on a fixed grace window (TERM_GRACE_MS); CPU contention from co-scheduled
 * test processes can starve the compliant child's process.nextTick exit past the timer.
 *
 * The liveness watchdog must ASK before it shoots.
 *
 * WHY (2026-08-10 incident): a wedged sidecar is normally mid-work — a leaf executing, a base
 * gate running, a land merging. The watchdog killed it with a bare SIGKILL, so 477 kills
 * between 2026-07-23 and 2026-08-10 each abandoned that work: leaves were left as
 * `in_progress` rows with no executor behind them and no leaf_inflight record, recoverable
 * only by hand. SIGTERM first lets the sidecar's graceful-shutdown path close its databases
 * and terminalise in-flight work; SIGKILL still follows if it does not comply, so a truly
 * wedged process is never left running.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ServerSupervisor } from '../../../desktop/src/main/server-supervisor';

/** Generous grace so a compliant child's process.nextTick exit always wins the race against the
 *  timer even on a loaded box; the wedged tests pay this once each (~1.5s total). */
const TERM_GRACE_MS = 750;

/** Records every signal it receives. `compliant` decides whether SIGTERM makes it exit. */
class SignalRecordingChild extends EventEmitter {
  pid = 4242;
  signals: string[] = [];
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(private compliant: boolean) { super(); }
  kill(signal?: string): void {
    this.signals.push(signal ?? 'SIGTERM');
    if (signal === 'SIGTERM' && !this.compliant) return; // wedged: ignores the polite ask
    process.nextTick(() => this.emit('exit', null, signal ?? null));
  }
}

describe('watchdog kill escalates SIGTERM → SIGKILL', () => {
  let supervisor: ServerSupervisor;
  let children: SignalRecordingChild[] = [];
  let healthQueue: boolean[] = [];
  let fetchCallCount = 0;
  let now = 1_000_000;
  let compliant = true;
  let forensicsDir: string;
  let supervisorDir: string;
  const originalEnv = process.env.MERMAID_SUPERVISOR_DIR;

  beforeEach(() => {
    forensicsDir = mkdtempSync(join(tmpdir(), 'term-grace-forensics-'));
    supervisorDir = mkdtempSync(join(tmpdir(), 'term-grace-supervisor-'));
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    children = []; healthQueue = []; fetchCallCount = 0; now = 1_000_000; compliant = true;
  });
  afterEach(() => {
    supervisor?.stop?.();
    if (originalEnv !== undefined) process.env.MERMAID_SUPERVISOR_DIR = originalEnv;
    else delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  function makeSupervisor(port: number) {
    return new ServerSupervisor({
      host: '127.0.0.1', port, version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 15_000,
      healthWatchdogThresholdMs: 45_000,
      watchdogTermGraceMs: TERM_GRACE_MS,
      forensicsFilePath: join(forensicsDir, 'forensics.log'),
      project: '/fake/project', session: 'test-session',
      spawnImpl: () => { const c = new SignalRecordingChild(compliant); children.push(c); return c as never; },
      fetchImpl: async () => {
        fetchCallCount++;
        if (fetchCallCount === 1) return { ok: true } as Response;
        return { ok: healthQueue.shift() ?? true } as Response;
      },
      portInUseImpl: async () => false,
      clockImpl: () => now,
    } as never);
  }

  /** Drive enough consecutive failed probes to cross the 45s threshold. */
  async function driveToKill() {
    healthQueue = [false, false, false, false];
    for (let i = 0; i < 4; i++) {
      const r = await supervisor.checkHealthOnce();
      now += 15_000;
      if (r === 'respawned') return;
    }
  }

  test('a sidecar that exits on SIGTERM is never SIGKILLed', async () => {
    compliant = true;
    supervisor = makeSupervisor(9310);
    await supervisor.start();
    await driveToKill();

    const wedged = children[0];
    expect(wedged.signals[0]).toBe('SIGTERM'); // asked first
    expect(wedged.signals).not.toContain('SIGKILL'); // and never shot
  });

  test('a sidecar that ignores SIGTERM is still SIGKILLed after the grace window', async () => {
    compliant = false;
    supervisor = makeSupervisor(9311);
    await supervisor.start();
    await driveToKill();

    const wedged = children[0];
    expect(wedged.signals[0]).toBe('SIGTERM');
    expect(wedged.signals).toContain('SIGKILL'); // escalation still happens
    expect(wedged.signals.indexOf('SIGTERM')).toBeLessThan(wedged.signals.indexOf('SIGKILL'));
  });

  test('the sidecar is replaced either way, so recovery is not weakened', async () => {
    compliant = false;
    supervisor = makeSupervisor(9312);
    await supervisor.start();
    await driveToKill();
    expect(children.length).toBeGreaterThan(1); // a fresh child was spawned
  });
});
