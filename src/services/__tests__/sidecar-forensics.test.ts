import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { ServerSupervisor } from '../../../desktop/src/main/server-supervisor';
import {
  CrashLoopTripwire,
  buildCrashLoopEscalationPayload,
  appendEscalationIntent,
  drainEscalationIntents,
  parseEscalationIntent,
  formatExitForensics,
  formatWatchdogKillReason,
} from '../sidecar-forensics';
import { createEscalation, listOpenEscalations, _closeDb } from '../supervisor-store';

class FakeChildProcess extends EventEmitter {
  pid = 12345;
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string): void {
    this.exitCode = signal === 'SIGKILL' ? null : signal ? null : 1;
    this.signalCode = signal ?? null;
    // Emit asynchronously so exit handler observes post-increment respawnCount
    process.nextTick(() => {
      this.emit('exit', this.exitCode, this.signalCode);
    });
  }
}

describe('ServerSupervisor crash loop and forensics', () => {
  let supervisor: ServerSupervisor;
  let forensicsDir: string;
  let supervisorDir: string;
  let spawnedChildren: FakeChildProcess[] = [];
  let fetchCallCount = 0;
  let now = 1_000_000;
  const originalEnv = process.env.MERMAID_SUPERVISOR_DIR;

  beforeEach(() => {
    _closeDb();
    forensicsDir = mkdtempSync(join(tmpdir(), 'sidecar-forensics-'));
    supervisorDir = mkdtempSync(join(tmpdir(), 'sidecar-supervisor-'));
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    spawnedChildren = [];
    fetchCallCount = 0;
    now = 1_000_000;
  });

  afterEach(() => {
    supervisor?.stop?.();
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.MERMAID_SUPERVISOR_DIR = originalEnv;
    } else {
      delete process.env.MERMAID_SUPERVISOR_DIR;
    }
  });

  const spawnImpl = (cmd: string, args: string[], opts: any) => {
    const child = new FakeChildProcess();
    spawnedChildren.push(child);
    return child;
  };

  const fetchImpl = async (url: string, opts?: any) => {
    fetchCallCount++;
    // 1st call (consumed by waitForHealth) returns healthy
    if (fetchCallCount === 1) {
      return { ok: true };
    }
    // All subsequent calls (consumed by probeHealth) return unhealthy
    return { ok: false };
  };

  const portInUseImpl = async () => false;

  const clockImpl = () => now;

  test('exit line contains reason and respawnCount after watchdog kill', async () => {
    supervisor = new ServerSupervisor({
      host: '127.0.0.1',
      port: 9100,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,
      forensicsFilePath: forensicsDir + '/forensics.log',
      crashLoopN: 3,
      crashLoopWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);

    await supervisor.start();

    // Call checkHealthOnce once to trigger first respawn
    await supervisor.checkHealthOnce();
    // Yield to event loop so exit event handler completes
    await new Promise((resolve) => process.nextTick(resolve));

    // Read forensics file and verify it contains the exit reason and count
    const content = readFileSync(forensicsDir + '/forensics.log', 'utf-8');
    expect(content).toContain('reason=watchdog-unresponsive');
    expect(content).toContain('respawnCount=1');
  });

  test('watchdog-kill line appears before exit line', async () => {
    supervisor = new ServerSupervisor({
      host: '127.0.0.1',
      port: 9101,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,
      forensicsFilePath: forensicsDir + '/forensics.log',
      crashLoopN: 3,
      crashLoopWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);

    await supervisor.start();
    await supervisor.checkHealthOnce();
    // Yield to event loop so exit event handler completes
    await new Promise((resolve) => process.nextTick(resolve));

    const content = readFileSync(forensicsDir + '/forensics.log', 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    const killLineIdx = lines.findIndex(l => l.includes('watchdog-kill:'));
    const exitLineIdx = lines.findIndex(l => l.includes('sidecar-exit'));

    expect(killLineIdx).toBeGreaterThanOrEqual(0);
    expect(exitLineIdx).toBeGreaterThanOrEqual(0);
    expect(killLineIdx).toBeLessThan(exitLineIdx);
    expect(lines[killLineIdx]).toContain('thresholdMs=10');
    expect(lines[killLineIdx]).toContain('probeLatenciesMs=[');
  });

  test('crash loop tripwire fires once per window', async () => {
    supervisor = new ServerSupervisor({
      host: '127.0.0.1',
      port: 9102,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,
      forensicsFilePath: forensicsDir + '/forensics.log',
      crashLoopN: 3,
      crashLoopWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);

    await supervisor.start();

    // Respawns 1-4 with frozen now at 1_000_000
    // Respawn #3 should trigger the crash loop alert
    await supervisor.checkHealthOnce(); // respawn #1
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // respawn #2
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // respawn #3 → fires
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // respawn #4 → no fire (same window)
    await new Promise((resolve) => process.nextTick(resolve));

    // Read pending-escalations.jsonl
    const escalationContent = readFileSync(supervisorDir + '/pending-escalations.jsonl', 'utf-8');
    const lines = escalationContent.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(1);
    const intent = JSON.parse(lines[0]);
    expect(intent.kind).toBe('sidecar-crash-loop');

    // Advance time past window and respawn 3 more times
    now = 1_000_000 + 60_000 + 1;
    await supervisor.checkHealthOnce(); // respawn #5
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // respawn #6
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // respawn #7 → fires in new window
    await new Promise((resolve) => process.nextTick(resolve));

    const escalationContent2 = readFileSync(supervisorDir + '/pending-escalations.jsonl', 'utf-8');
    const lines2 = escalationContent2.split('\n').filter(l => l.trim());
    expect(lines2.length).toBe(2);
  });

  test('drainEscalationIntents processes and clears file', async () => {
    supervisor = new ServerSupervisor({
      host: '127.0.0.1',
      port: 9103,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,
      forensicsFilePath: forensicsDir + '/forensics.log',
      crashLoopN: 3,
      crashLoopWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);

    await supervisor.start();

    // Trigger two crash loop escalations
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // fires
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    now = 1_000_000 + 60_000 + 1;
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce(); // fires again
    await new Promise((resolve) => process.nextTick(resolve));

    const collected: any[] = [];
    drainEscalationIntents(supervisorDir, (intent) => collected.push(intent));

    expect(collected.length).toBe(2);
    collected.forEach(intent => expect(intent.kind).toBe('sidecar-crash-loop'));

    // Verify file is now empty
    const fileContent = readFileSync(supervisorDir + '/pending-escalations.jsonl', 'utf-8');
    expect(fileContent.trim()).toBe('');

    // Second drain should be no-op
    const collected2: any[] = [];
    drainEscalationIntents(supervisorDir, (intent) => collected2.push(intent));
    expect(collected2.length).toBe(0);
  });

  test('end-to-end: crash loop fires escalation intent and drains to escalation card', async () => {
    supervisor = new ServerSupervisor({
      host: '127.0.0.1',
      port: 9104,
      version: '1.0.0',
      serverBinaryPath: '/fake/server',
      disableHealthWatchdog: true,
      healthWatchdogGraceMs: 0,
      healthWatchdogPollMs: 10,
      healthWatchdogThresholdMs: 10,
      forensicsFilePath: forensicsDir + '/forensics.log',
      crashLoopN: 3,
      crashLoopWindowMs: 60_000,
      project: '/fake/project',
      session: 'test-session',
      spawnImpl,
      fetchImpl,
      portInUseImpl,
      clockImpl,
    } as any);

    await supervisor.start();

    // Trigger crash loop (3 respawns = fire)
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));
    await supervisor.checkHealthOnce();
    await new Promise((resolve) => process.nextTick(resolve));

    // Drain escalation intents through the real production path
    const intents: any[] = [];
    drainEscalationIntents(supervisorDir, (intent) => {
      const parsed = parseEscalationIntent(intent);
      if (parsed) {
        intents.push(parsed);
        createEscalation(parsed);
      }
    });

    expect(intents.length).toBe(1);
    expect(intents[0].kind).toBe('sidecar-crash-loop');
    expect(intents[0].project).toBe('/fake/project');
    expect(intents[0].session).toBe('test-session');

    // Verify the escalation card was created
    const escalations = listOpenEscalations();
    expect(escalations.length).toBe(1);
    expect(escalations[0].kind).toBe('sidecar-crash-loop');
    expect(escalations[0].project).toBe('/fake/project');
    expect(escalations[0].session).toBe('test-session');
  });
});

describe('CrashLoopTripwire', () => {
  test('fires on nth respawn, not before or after in same window', () => {
    let now = 1_000_000;
    const tripwire = new CrashLoopTripwire(3, 60_000);

    // Calls 1-2 return false
    expect(tripwire.recordRespawn(now)).toBe(false);
    expect(tripwire.recordRespawn(now)).toBe(false);

    // Call 3 (at same frozen now) returns true
    expect(tripwire.recordRespawn(now)).toBe(true);

    // Call 4 (same frozen now) returns false
    expect(tripwire.recordRespawn(now)).toBe(false);
  });

  test('fires again in new window after threshold', () => {
    let now = 1_000_000;
    const tripwire = new CrashLoopTripwire(3, 60_000);

    // Window 1: respawns at same now
    expect(tripwire.recordRespawn(now)).toBe(false);
    expect(tripwire.recordRespawn(now)).toBe(false);
    expect(tripwire.recordRespawn(now)).toBe(true); // fires on 3rd

    // Advance past window
    now = 1_000_000 + 60_000 + 1;

    // Window 2: 3 fresh respawns
    expect(tripwire.recordRespawn(now)).toBe(false);
    expect(tripwire.recordRespawn(now)).toBe(false);
    expect(tripwire.recordRespawn(now)).toBe(true); // fires on 3rd in new window
  });
});
