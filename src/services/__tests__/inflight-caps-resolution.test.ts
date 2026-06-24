import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the orchestrator_config DB BEFORE the modules open it.
const dir = mkdtempSync(join(tmpdir(), 'inflight-caps-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;
// Pin the global per-project default deterministically (config.json has no key in CI).
process.env.MERMAID_MAX_INFLIGHT_PROJECT = '2';

const { setProjectInflightCap } = await import('../orchestrator-config');
const { maxInflightPerProject } = await import('../inflight-limiter');

beforeAll(() => {});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
  delete process.env.MERMAID_MAX_INFLIGHT_PROJECT;
});

describe('maxInflightPerProject — per-project override resolution', () => {
  it('falls back to the global default when no per-project override is set', () => {
    expect(maxInflightPerProject('/proj/no-override')).toBe(2);
  });

  it('uses the per-project override when set (the UI control persists this)', () => {
    setProjectInflightCap('/proj/with-override', 6);
    expect(maxInflightPerProject('/proj/with-override')).toBe(6);
  });

  it('a different project is unaffected (per-project granularity)', () => {
    setProjectInflightCap('/proj/p1', 8);
    expect(maxInflightPerProject('/proj/p1')).toBe(8);
    expect(maxInflightPerProject('/proj/p2')).toBe(2); // still the default
  });
});
