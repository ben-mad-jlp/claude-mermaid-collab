import { test, expect } from 'bun:test';
import { resolveNudgeTarget, CONDUCTOR_SESSION } from '../nudge-target';
import type { SessionStatusRow } from '../session-status-store';

const NOW = 1_000_000_000_000;

function mockSessionStatusRow(session: string, role: string, updatedAt: number): SessionStatusRow {
  return {
    project: '/p',
    session,
    status: 'waiting',
    updatedAt,
    contextPercent: null,
    contextUpdatedAt: null,
    checkpointReadyAt: null,
  };
}

test('resolveNudgeTarget picks the most-recently-updated conductor-role session', () => {
  const statuses: SessionStatusRow[] = [
    mockSessionStatusRow('worker-1', 'worker', NOW - 5000),
    mockSessionStatusRow('conductor-old', 'conductor', NOW - 10000),
    mockSessionStatusRow('conductor-new', 'conductor', NOW - 1000),
    mockSessionStatusRow('design-1', 'design', NOW - 2000),
  ];
  const result = resolveNudgeTarget('/p', {
    getStatuses: () => statuses,
  });
  expect(result).toBe('conductor-new');
});

test('resolveNudgeTarget falls back to CONDUCTOR_SESSION when no status rows exist', () => {
  const result = resolveNudgeTarget('/p', {
    getStatuses: () => [],
  });
  expect(result).toBe(CONDUCTOR_SESSION);
});

test('resolveNudgeTarget falls back to CONDUCTOR_SESSION when no conductor-role sessions exist', () => {
  const statuses: SessionStatusRow[] = [
    mockSessionStatusRow('worker-1', 'worker', NOW - 5000),
    mockSessionStatusRow('design-1', 'design', NOW - 2000),
  ];
  const result = resolveNudgeTarget('/p', {
    getStatuses: () => statuses,
  });
  expect(result).toBe(CONDUCTOR_SESSION);
});

test('resolveNudgeTarget fails open (returns CONDUCTOR_SESSION) on store error', () => {
  const result = resolveNudgeTarget('/p', {
    getStatuses: () => {
      throw new Error('store error');
    },
  });
  expect(result).toBe(CONDUCTOR_SESSION);
});
