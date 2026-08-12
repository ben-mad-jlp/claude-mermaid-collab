/**
 * Gate spawn hardening (2026-08-12 load-82 incident): three properties, each of
 * which failed in production the day this was written.
 *
 * 1. QoS demotion on darwin: nice alone is advisory under the macOS scheduler —
 *    four nice-10 vitest suites starved the sidecar anyway. taskpolicy -c utility
 *    must wrap the whole argv on darwin, and must NOT appear elsewhere.
 * 2. Global concurrency: gate commands queue behind MERMAID_GATE_CONCURRENCY slots;
 *    unbounded fan-out (4 concurrent full suites) is what drove load to 82.
 * 3. Orphan-proof hard timeout: the perl warden kills its own PROCESS GROUP on
 *    alarm, so a gate cannot outlive its cap even when the sidecar is SIGKILLed —
 *    two orphaned gates had run 16h47m and 1d00h10m.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  gateSpawnArgv,
  defaultGateSpawn,
  GATE_WARDEN_PERL,
  DEFAULT_GATE_NICE,
  DEFAULT_GATE_TIMEOUT_SECS,
  _gateSemaphoreState,
} from '../leaf-gate';

const ENV_KEYS = ['MERMAID_GATE_NICE', 'MERMAID_GATE_TIMEOUT_SECS', 'MERMAID_GATE_CONCURRENCY'];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('gateSpawnArgv composition', () => {
  it('darwin wraps with taskpolicy utility, warden, and nice — in protection order', () => {
    const argv = gateSpawnArgv('echo hi', DEFAULT_GATE_NICE, { platform: 'darwin', timeoutSecs: 60 });
    expect(argv.slice(0, 3)).toEqual(['taskpolicy', '-c', 'utility']);
    expect(argv[3]).toBe('perl');
    expect(argv[4]).toBe('-e');
    expect(argv[5]).toBe(GATE_WARDEN_PERL);
    expect(argv[6]).toBe('60');
    expect(argv.slice(7, 10)).toEqual(['nice', '-n', String(DEFAULT_GATE_NICE)]);
    expect(argv.slice(10)).toEqual(['sh', '-c', 'echo hi']);
  });

  it('non-darwin gets the warden and nice but no taskpolicy', () => {
    const argv = gateSpawnArgv('echo hi', DEFAULT_GATE_NICE, { platform: 'linux', timeoutSecs: 60 });
    expect(argv[0]).toBe('perl');
    expect(argv).not.toContain('taskpolicy');
  });

  it('timeoutSecs 0 disables the warden; niceness 0 disables nice', () => {
    const argv = gateSpawnArgv('echo hi', 0, { platform: 'linux', timeoutSecs: 0 });
    expect(argv).toEqual(['sh', '-c', 'echo hi']);
  });

  it('the warden kills its own process GROUP, not just the shell', () => {
    // The group-kill is the whole point: sh dying alone orphans the test tree.
    expect(GATE_WARDEN_PERL).toContain('setpgrp');
    expect(GATE_WARDEN_PERL).toContain('-$$');
  });

  it('default timeout is 20 minutes', () => {
    expect(DEFAULT_GATE_TIMEOUT_SECS).toBe(1200);
  });
});

describe('defaultGateSpawn semaphore', () => {
  it('runs at most MERMAID_GATE_CONCURRENCY gates at once; the rest queue FIFO', async () => {
    process.env.MERMAID_GATE_CONCURRENCY = '2';
    process.env.MERMAID_GATE_TIMEOUT_SECS = '30';
    const runs = [1, 2, 3, 4].map(() => defaultGateSpawn('/tmp', 'sleep 0.4; echo done'));
    // Give the first wave a beat to start, then observe the cap.
    await new Promise((r) => setTimeout(r, 120));
    const mid = _gateSemaphoreState();
    expect(mid.inUse).toBeLessThanOrEqual(2);
    expect(mid.inUse + mid.queued).toBeGreaterThanOrEqual(3);
    const results = await Promise.all(runs);
    for (const r of results) {
      expect(r.ran).toBe(true);
      expect(r.code).toBe(0);
    }
    const after = _gateSemaphoreState();
    expect(after.inUse).toBe(0);
    expect(after.queued).toBe(0);
  });
});

describe('defaultGateSpawn hard timeout', () => {
  it('a gate exceeding the cap is group-killed and reads as INFRA (ran:false), with the marker', async () => {
    process.env.MERMAID_GATE_CONCURRENCY = '4';
    process.env.MERMAID_GATE_TIMEOUT_SECS = '1';
    const r = await defaultGateSpawn('/tmp', 'sleep 30; echo never');
    expect(r.ran).toBe(false);
    expect(r.output).toContain('gate hard-timeout');
  }, 15000);

  it('a fast gate under the cap passes exit status through untouched', async () => {
    process.env.MERMAID_GATE_CONCURRENCY = '4';
    process.env.MERMAID_GATE_TIMEOUT_SECS = '30';
    const ok = await defaultGateSpawn('/tmp', 'exit 0');
    expect(ok).toMatchObject({ ran: true, code: 0 });
    const fail = await defaultGateSpawn('/tmp', 'exit 3');
    expect(fail).toMatchObject({ ran: true, code: 3 });
  });
});
