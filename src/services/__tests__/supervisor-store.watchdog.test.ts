import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { addWatchedProject, getWatchdogThreshold, setWatchdogThreshold, listWatchedProjects, recordSupervisorAudit, listSupervisorAudit, setSupervisorPause, isSupervisorPaused, listSupervisorPauses, GLOBAL_PAUSE_SCOPE, _closeDb } from '../supervisor-store';

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

describe('supervisor audit log', () => {
  it('records and returns an entry', () => {
    const e = recordSupervisorAudit({ kind: 'nudge', project: '/a', session: 's1', detail: 'go' });
    expect(e.id).toBeTruthy();
    expect(e.kind).toBe('nudge');
    const got = listSupervisorAudit({ project: '/a' });
    expect(got.some((x) => x.id === e.id && x.detail === 'go')).toBe(true);
  });

  it('returns most-recent-first', () => {
    recordSupervisorAudit({ kind: 'clear', project: '/b', session: 's', ts: 1000 });
    recordSupervisorAudit({ kind: 'escalate', project: '/b', session: 's', ts: 2000 });
    const got = listSupervisorAudit({ project: '/b' });
    expect(got[0].ts).toBeGreaterThanOrEqual(got[1].ts);
    expect(got[0].kind).toBe('escalate');
  });

  it('filters by kind', () => {
    recordSupervisorAudit({ kind: 'nudge', project: '/c', session: 's' });
    recordSupervisorAudit({ kind: 'checkpoint', project: '/c', session: 's' });
    const only = listSupervisorAudit({ project: '/c', kind: 'checkpoint' });
    expect(only.every((x) => x.kind === 'checkpoint')).toBe(true);
    expect(only.length).toBe(1);
  });

  it('respects the limit', () => {
    for (let i = 0; i < 5; i++) recordSupervisorAudit({ kind: 'nudge', project: '/d', session: 's', ts: i });
    expect(listSupervisorAudit({ project: '/d', limit: 3 }).length).toBe(3);
  });
});

describe('supervisor pause / override', () => {
  it('not paused by default', () => {
    expect(isSupervisorPaused('/pp')).toBe(false);
  });
  it('project pause affects only that project', () => {
    setSupervisorPause('/pp', true);
    expect(isSupervisorPaused('/pp')).toBe(true);
    expect(isSupervisorPaused('/other')).toBe(false);
    setSupervisorPause('/pp', false);
    expect(isSupervisorPaused('/pp')).toBe(false);
  });
  it('global pause affects every project', () => {
    setSupervisorPause(GLOBAL_PAUSE_SCOPE, true);
    expect(isSupervisorPaused('/anything')).toBe(true);
    expect(isSupervisorPaused()).toBe(true);
    setSupervisorPause(GLOBAL_PAUSE_SCOPE, false);
    expect(isSupervisorPaused('/anything')).toBe(false);
  });
  it('listSupervisorPauses reflects active pauses', () => {
    setSupervisorPause('/x', true);
    expect(listSupervisorPauses().some((p) => p.scope === '/x')).toBe(true);
    setSupervisorPause('/x', false);
    expect(listSupervisorPauses().some((p) => p.scope === '/x')).toBe(false);
  });
});
