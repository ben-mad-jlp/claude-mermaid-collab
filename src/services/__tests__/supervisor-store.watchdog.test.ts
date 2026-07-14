import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it.
const dir = mkdtempSync(join(tmpdir(), 'sup-store-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import { addWatchedProject, getWatchdogThreshold, setWatchdogThreshold, listWatchedProjects, recordSupervisorAudit, listSupervisorAudit, setSupervisorPause, isSupervisorPaused, listSupervisorPauses, GLOBAL_PAUSE_SCOPE, createEscalation, listOpenEscalations, resolveEscalationsForTodo, _closeDb, setProjectDigestEnabled, getProjectDigestEnabled } from '../supervisor-store';

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
    addWatchedProject('/proj/b');
    setWatchdogThreshold('/proj/b', 70);
    expect(getWatchdogThreshold('/proj/b')).toBe(70);
  });

  it('setWatchdogThreshold is UPDATE-only (does not create watched_project row if absent)', () => {
    setWatchdogThreshold('/proj/c', 65);
    expect(getWatchdogThreshold('/proj/c')).toBeNull();
    expect(listWatchedProjects().some((p) => p.project === '/proj/c')).toBe(false);
  });

  it('clearing with null reverts to default', () => {
    addWatchedProject('/proj/d');
    setWatchdogThreshold('/proj/d', 90);
    setWatchdogThreshold('/proj/d', null);
    expect(getWatchdogThreshold('/proj/d')).toBeNull();
  });

  it('listWatchedProjects exposes watchdogThresholdPercent', () => {
    addWatchedProject('/proj/e');
    setWatchdogThreshold('/proj/e', 55);
    const row = listWatchedProjects().find((p) => p.project === '/proj/e');
    expect(row?.watchdogThresholdPercent).toBe(55);
  });
});

describe('per-project setters are UPDATE-only (never watch)', () => {
  it('setter on unwatched project creates no row, setter on watched project updates', () => {
    // Seed watched project A
    addWatchedProject('/scope/A');

    // Call setProjectDigestEnabled on unwatched B → no row created
    setProjectDigestEnabled('/scope/B', true);
    expect(listWatchedProjects().some((p) => p.project === '/scope/B')).toBe(false);

    // A's row is still present and unchanged
    expect(listWatchedProjects().some((p) => p.project === '/scope/A')).toBe(true);
    expect(getProjectDigestEnabled('/scope/A')).toBe(false);

    // Call setProjectDigestEnabled on A → updates the row
    setProjectDigestEnabled('/scope/A', true);
    expect(getProjectDigestEnabled('/scope/A')).toBe(true);

    // B still doesn't exist
    expect(listWatchedProjects().some((p) => p.project === '/scope/B')).toBe(false);
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

describe('createEscalation dedup signal (TOCTOU fix)', () => {
  it('first create isNew=true; identical create isNew=false (same row)', () => {
    const a = createEscalation({ project: '/e', session: 's', kind: 'blocker', questionText: 'stuck?' });
    expect(a.isNew).toBe(true);
    const b = createEscalation({ project: '/e', session: 's', kind: 'blocker', questionText: 'stuck?' });
    expect(b.isNew).toBe(false);
    expect(b.escalation.id).toBe(a.escalation.id);
    expect(listOpenEscalations().filter((e) => e.project === '/e').length).toBe(1);
  });
  it('different questionText → new', () => {
    createEscalation({ project: '/e2', session: 's', kind: 'blocker', questionText: 'q1' });
    expect(createEscalation({ project: '/e2', session: 's', kind: 'blocker', questionText: 'q2' }).isNew).toBe(true);
  });
  it('persists and returns the todoId link', () => {
    const { escalation } = createEscalation({ project: '/etd', session: 's', kind: 'blocker', questionText: 'q', todoId: 'todo-1' });
    expect(escalation.todoId).toBe('todo-1');
    expect(listOpenEscalations().find((e) => e.id === escalation.id)?.todoId).toBe('todo-1');
  });
  it('todoId defaults to null when omitted', () => {
    const { escalation } = createEscalation({ project: '/etd2', session: 's', kind: 'blocker', questionText: 'q' });
    expect(escalation.todoId).toBeNull();
  });
});

describe('createEscalation structured payload (options + recommended)', () => {
  const OPTIONS = [
    { id: 'a', label: 'Option A', detail: 'do A' },
    { id: 'b', label: 'Option B' },
  ];
  it('round-trips options[] and recommended through create + list', () => {
    const { escalation } = createEscalation({ project: '/so1', session: 's', kind: 'decision', questionText: 'A or B?', options: OPTIONS, recommended: 'a' });
    expect(escalation.options).toEqual(OPTIONS);
    expect(escalation.recommended).toBe('a');
    const listed = listOpenEscalations().find((e) => e.id === escalation.id);
    expect(listed?.options).toEqual(OPTIONS);
    expect(listed?.recommended).toBe('a');
  });
  it('backward compatible: a plain escalation has options=null, recommended=null', () => {
    const { escalation } = createEscalation({ project: '/so2', session: 's', kind: 'question', questionText: 'plain?' });
    expect(escalation.options).toBeNull();
    expect(escalation.recommended).toBeNull();
    expect(listOpenEscalations().find((e) => e.id === escalation.id)?.options).toBeNull();
  });
  it('drops a recommended that does not match any option id', () => {
    const { escalation } = createEscalation({ project: '/so3', session: 's', kind: 'decision', questionText: 'q', options: OPTIONS, recommended: 'zzz' });
    expect(escalation.recommended).toBeNull();
    expect(escalation.options).toEqual(OPTIONS);
  });
  it('an empty options[] is treated as no options', () => {
    const { escalation } = createEscalation({ project: '/so4', session: 's', kind: 'decision', questionText: 'q', options: [], recommended: 'a' });
    expect(escalation.options).toBeNull();
    expect(escalation.recommended).toBeNull();
  });
});

describe('resolveEscalationsForTodo (auto-resolve on todo completion)', () => {
  it('resolves open escalations matched by exact todoId', () => {
    const { escalation } = createEscalation({ project: '/r1', session: 'worker-abc', kind: 'blocker', questionText: 'exhausted', todoId: 'T1' });
    const resolved = resolveEscalationsForTodo('/r1', 'T1');
    expect(resolved.map((e) => e.id)).toContain(escalation.id);
    expect(listOpenEscalations().some((e) => e.id === escalation.id)).toBe(false);
  });
  it('resolves escalations matched by session even without a todoId link', () => {
    const { escalation } = createEscalation({ project: '/r2', session: 'worker-12345678', kind: 'blocker', questionText: 'self-escalation' });
    const resolved = resolveEscalationsForTodo('/r2', '12345678-0000-0000-0000-000000000000', ['worker-12345678']);
    expect(resolved.map((e) => e.id)).toContain(escalation.id);
    expect(listOpenEscalations().some((e) => e.id === escalation.id)).toBe(false);
  });
  it('leaves unrelated open escalations untouched and returns [] when nothing matches', () => {
    const { escalation: keep } = createEscalation({ project: '/r3', session: 'worker-other', kind: 'blocker', questionText: 'unrelated', todoId: 'OTHER' });
    const resolved = resolveEscalationsForTodo('/r3', 'NOPE', ['worker-nomatch']);
    expect(resolved).toEqual([]);
    expect(listOpenEscalations().some((e) => e.id === keep.id)).toBe(true);
  });
  it('is scoped to the project (does not resolve same todoId in another project)', () => {
    const { escalation } = createEscalation({ project: '/r4a', session: 's', kind: 'blocker', questionText: 'q', todoId: 'SHARED' });
    resolveEscalationsForTodo('/r4b', 'SHARED');
    expect(listOpenEscalations().some((e) => e.id === escalation.id)).toBe(true);
  });
});
