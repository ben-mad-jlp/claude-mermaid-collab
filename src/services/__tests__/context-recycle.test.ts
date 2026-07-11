import { test, expect } from 'bun:test';
import {
  planRecycleStep,
  advisoryText,
  runContextRecyclePass,
  RECYCLE_COLLAB_SETTLE_MS,
  RECYCLE_RECOVER_TIMEOUT_MS,
} from '../context-recycle';
import type { WatchdogCandidate } from '../context-watchdog';
import type { SessionStatusRow } from '../session-status-store';

const NOW = 1_000_000_000_000;
const checkpoint = (session = 's'): WatchdogCandidate => ({ session, action: 'checkpoint', contextPercent: 85, reason: 'x' });
const clear = (session = 's'): WatchdogCandidate => ({ session, action: 'clear', contextPercent: 85, reason: 'x' });
const row = (over: Partial<SessionStatusRow> = {}): SessionStatusRow => ({
  project: 'p', session: 's', status: 'waiting', updatedAt: NOW,
  contextPercent: 85, contextUpdatedAt: NOW, checkpointReadyAt: null,
  recycleState: null, recycleUpdatedAt: null, ...over,
});

// --- pure planner ---

test('mode off is always inert', () => {
  expect(planRecycleStep(row(), 'off', checkpoint(), NOW)).toBe('none');
  expect(planRecycleStep(row({ recycleState: 'recovering' }), 'off', null, NOW)).toBe('none');
});

test('no watchdog action → none', () => {
  expect(planRecycleStep(row(), 'force', null, NOW)).toBe('none');
  expect(planRecycleStep(row(), 'notify', null, NOW)).toBe('none');
});

test('checkpoint action: force injects the checkpoint, notify only advises', () => {
  expect(planRecycleStep(row(), 'force', checkpoint(), NOW)).toBe('inject-checkpoint');
  expect(planRecycleStep(row(), 'notify', checkpoint(), NOW)).toBe('inject-advisory');
});

test('clear action drives the wipe in either active mode', () => {
  expect(planRecycleStep(row(), 'force', clear(), NOW)).toBe('clear');
  expect(planRecycleStep(row(), 'notify', clear(), NOW)).toBe('clear');
});

test('recovering: waits out the settle window, then recovers', () => {
  const justCleared = row({ recycleState: 'recovering', recycleUpdatedAt: NOW - (RECYCLE_COLLAB_SETTLE_MS - 1) });
  expect(planRecycleStep(justCleared, 'force', clear(), NOW)).toBe('none');
  const settled = row({ recycleState: 'recovering', recycleUpdatedAt: NOW - (RECYCLE_COLLAB_SETTLE_MS + 1) });
  expect(planRecycleStep(settled, 'force', clear(), NOW)).toBe('recover');
});

test('recovering longer than the timeout escalates', () => {
  const stale = row({ recycleState: 'recovering', recycleUpdatedAt: NOW - (RECYCLE_RECOVER_TIMEOUT_MS + 1) });
  expect(planRecycleStep(stale, 'force', null, NOW)).toBe('recover-timeout');
});

test('advisoryText surfaces the percent, or "high" when unknown', () => {
  expect(advisoryText({ contextPercent: 82 }, 1000)).toContain('82%');
  expect(advisoryText({ contextPercent: null }, 1000)).toContain('high');
});

test('advisoryText is stamped with [HH:MM TZ]', () => {
  expect(advisoryText({ contextPercent: 82 }, 1000)).toMatch(/^\[\d{2}:\d{2} [A-Z]{2,4}\] /);
});

// --- runner: dep-injected, no-DB-write paths ---

test('off mode short-circuits before any injection', async () => {
  const calls: string[] = [];
  await runContextRecyclePass('p', {
    getMode: () => 'off',
    getStatuses: () => [row()],
    nudge: async (_p, _s, t) => { calls.push(t); return 'sent'; },
  });
  expect(calls).toEqual([]);
});

test('a paused project injects nothing', async () => {
  const calls: string[] = [];
  await runContextRecyclePass('p', {
    getMode: () => 'force',
    isPaused: () => true,
    getStatuses: () => [row()],
    nudge: async (_p, _s, t) => { calls.push(t); return 'sent'; },
  });
  expect(calls).toEqual([]);
});

test('a settled recovering session is re-issued /collab', async () => {
  const calls: string[] = [];
  await runContextRecyclePass('p', {
    now: NOW,
    getMode: () => 'force',
    isPaused: () => false,
    getThreshold: () => null,
    // contextPercent null so the selector emits nothing; the recovering branch drives it.
    getStatuses: () => [row({ session: 'loop', contextPercent: null, contextUpdatedAt: null, recycleState: 'recovering', recycleUpdatedAt: NOW - (RECYCLE_COLLAB_SETTLE_MS + 1000) })],
    nudge: async (_p, _s, t) => { calls.push(t); return 'busy'; }, // busy → no DB write, retried next tick
  });
  expect(calls).toEqual(['/collab loop']);
});
