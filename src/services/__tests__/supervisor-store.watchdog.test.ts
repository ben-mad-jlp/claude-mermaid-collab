import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { addWatchedProject, getWatchdogThreshold, setWatchdogThreshold, listWatchedProjects, _closeDb } from '../supervisor-store';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(dir, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

describe('per-project watchdog threshold', () => {
  it('defaults to null (use built-in default) for a freshly watched project', () => {
    addWatchedProject('/proj/a');
    expect(getWatchdogThreshold('/proj/a')).toBeNull();
  });

  it('null for an unknown project', () => {
    expect(getWatchdogThreshold('/proj/unknown')).toBeNull();
  });

  it('set then get round-trips', () => {
    setWatchdogThreshold('/proj/b', 70);
    expect(getWatchdogThreshold('/proj/b')).toBe(70);
  });

  it('setWatchdogThreshold upserts (creates the watched_project row if absent)', () => {
    setWatchdogThreshold('/proj/c', 65);
    expect(getWatchdogThreshold('/proj/c')).toBe(65);
    expect(listWatchedProjects().some((p) => p.project === '/proj/c')).toBe(true);
  });

  it('clearing with null reverts to default', () => {
    setWatchdogThreshold('/proj/d', 90);
    setWatchdogThreshold('/proj/d', null);
    expect(getWatchdogThreshold('/proj/d')).toBeNull();
  });

  it('listWatchedProjects exposes watchdogThresholdPercent', () => {
    setWatchdogThreshold('/proj/e', 55);
    const row = listWatchedProjects().find((p) => p.project === '/proj/e');
    expect(row?.watchdogThresholdPercent).toBe(55);
  });
});
