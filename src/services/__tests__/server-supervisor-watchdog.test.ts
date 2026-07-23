import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ServerSupervisor } from '../../../desktop/src/main/server-supervisor';

class FakeChildProcess extends EventEmitter {
  pid = 12345;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string): void {
    this.exitCode = signal === 'SIGKILL' ? null : signal ? null : 1;
    this.signalCode = signal ?? null;
    // Emit asynchronously — the exit handler observes state as it stands right
    // after respawnHung's synchronous spawnChild() call, matching the real
    // process-exit event's async timing relative to a respawn.
    process.nextTick(() => {
      this.emit('exit', this.exitCode, this.signalCode);
    });
  }
}

describe('ServerSupervisor watchdog: jitter tolerance + true exit uptime', () => {
  let supervisor: ServerSupervisor;
  let forensicsDir: string;
  let supervisorDir: string;
  let spawnedChildren: FakeChildProcess[] = [];
  let healthQueue: boolean[] = [];
  let fetchCallCount = 0;
  let now = 1_000_000;
  const originalEnv = process.env.MERMAID_SUPERVISOR_DIR;

  beforeEach(() => {
    forensicsDir = mkdtempSync(join(tmpdir(), 'watchdog-forensics-'));
    supervisorDir = mkdtempSync(join(tmpdir(), 'watchdog-supervisor-'));
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    spawnedChildren = [];
    healthQueue = [];
    fetchCallCount = 0;
    now = 1_000_000;
  });

  afterEach(() => {
    supervisor?.stop?.();
    if (originalEnv !== undefined) {
      process.env.MERMAID_SUPERVISOR_DIR = originalEnv;
    } else {
      delete process.env.MERMAID_SUPERVISOR_DIR;
    }
  });

  const spawnImpl = (_cmd: string, _args: string[], _opts: any) => {
    const child = new FakeChildProcess();
    spawnedChildren.push(child);
    return child;
  };

  const fetchImpl = async (_url: string, _opts?: any) => {
    fetchCallCount++;
    // 1st call is consumed by waitForHealth during start() — always healthy so
    // start() resolves; the queued probe responses drive checkHealthOnce.
    if (fetchCallCount === 1) return { ok: true } as Response;
    const next = healthQueue.shift();
    return { ok: next ?? true } as Response;
  };

  const portInUseImpl = async () => false;
  const clockImpl = () => now;

  const POLL_MS = 15_000;
  const THRESHOLD_MS = 45_000; // ceil(45000/15000) = 3 consecutive misses to kill

  function makeSupervisor(port: number) {
    return new ServerSupervisor({
      host: '127.0.0.1',
      port,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: POLL_MS,
      healthWatchdogThresholdMs: THRESHOLD_MS,
      forensicsFilePath: forensicsDir + '/forensics.log',
      slowProbeN: 3,
      slowProbeWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);
  }

  test('interleaved healthy/timeout probes never respawn and warn at most once per window', async () => {
    supervisor = makeSupervisor(9200);
    await supervisor.start();

    // unhealthy, healthy, unhealthy, healthy, unhealthy, healthy, unhealthy, healthy
    // — never 3 consecutive misses, so no kill; 4 recoveries-after-unhealthy in the
    // same window should still fire the slow-probe warning only once.
    healthQueue = [false, true, false, true, false, true, false, true];
    const probeCount = healthQueue.length;
    for (let i = 0; i < probeCount; i++) {
      const result = await supervisor.checkHealthOnce();
      expect(result).not.toBe('respawned');
    }

    // Only the initial spawn — never respawned.
    expect(spawnedChildren.length).toBe(1);

    const escalationPath = supervisorDir + '/pending-escalations.jsonl';
    let escalationContent = '';
    try {
      escalationContent = readFileSync(escalationPath, 'utf-8');
    } catch {
      // no escalations at all would also be a failure below
    }
    const lines = escalationContent.split('\n').filter((l) => l.trim());
    const slowProbeLines = lines.filter((l) => JSON.parse(l).kind === 'sidecar-slow-probes');
    expect(slowProbeLines.length).toBe(1);
  });

  test('consecutive misses reaching the threshold DO respawn and forensics report the real uptime', async () => {
    supervisor = makeSupervisor(9201);
    const startedAt = now;
    await supervisor.start();

    // Simulate a long-lived child (~3h) before the watchdog ever sees a miss.
    now = startedAt + 3 * 60 * 60 * 1000;

    healthQueue = [false, false, false];
    const probeCount = healthQueue.length;
    let lastResult: string = 'idle';
    for (let i = 0; i < probeCount; i++) {
      lastResult = await supervisor.checkHealthOnce();
    }
    expect(lastResult).toBe('respawned');
    expect(spawnedChildren.length).toBe(2); // original + respawned

    // Let the old child's async 'exit' handler run.
    await new Promise((resolve) => process.nextTick(resolve));
    await new Promise((resolve) => process.nextTick(resolve));

    const content = readFileSync(forensicsDir + '/forensics.log', 'utf-8');
    expect(content).toContain('reason=watchdog-unresponsive');
    // Real uptime (~3h = 10_800_000ms), not the ~30ms a re-stamped spawnedAt would
    // have produced against the NEW child's just-set spawn time.
    expect(content).toContain(`uptimeMs=${3 * 60 * 60 * 1000}`);
    expect(content).not.toContain('uptimeMs=0 ');
  });

  test('a healthy probe between two failures resets the consecutive counter — no kill', async () => {
    supervisor = makeSupervisor(9202);
    await supervisor.start();

    healthQueue = [false, true, false, false];
    const probeCount = healthQueue.length;
    let lastResult: string = 'idle';
    for (let i = 0; i < probeCount; i++) {
      lastResult = await supervisor.checkHealthOnce();
      expect(lastResult).not.toBe('respawned');
    }

    expect(spawnedChildren.length).toBe(1);
  });
});
