import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordStatus, recordContextPercent, getStatus, getStatuses, recordCheckpointReady, clearCheckpointReady, isCheckpointReady, tryEmitWatchdogAction, resetWatchdogDebounce } from '../session-status-store';

const projects: string[] = [];
function tmpProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'sss-test-'));
  projects.push(p);
  return p;
}
afterAll(() => { for (const p of projects) rmSync(p, { recursive: true, force: true }); });

describe('recordContextPercent', () => {
  it('persists contextPercent + contextUpdatedAt, readable via getStatus', () => {
    const project = tmpProject();
    recordContextPercent(project, 'worker-1', 42);
    const row = getStatus(project, 'worker-1');
    expect(row?.contextPercent).toBe(42);
    expect(typeof row?.contextUpdatedAt).toBe('number');
    // seeds status='active' when no prior row exists
    expect(row?.status).toBe('active');
  });

  it('does NOT clobber an existing activity status', () => {
    const project = tmpProject();
    recordStatus(project, 'worker-2', 'waiting');
    recordContextPercent(project, 'worker-2', 80);
    const row = getStatus(project, 'worker-2');
    expect(row?.status).toBe('waiting'); // preserved
    expect(row?.contextPercent).toBe(80);
  });

  it('recordStatus does not wipe a previously recorded contextPercent', () => {
    const project = tmpProject();
    recordContextPercent(project, 'worker-3', 55);
    recordStatus(project, 'worker-3', 'active');
    expect(getStatus(project, 'worker-3')?.contextPercent).toBe(55);
  });

  it('updates contextPercent on subsequent reports', () => {
    const project = tmpProject();
    recordContextPercent(project, 'worker-4', 10);
    recordContextPercent(project, 'worker-4', 81);
    expect(getStatus(project, 'worker-4')?.contextPercent).toBe(81);
  });

  it('getStatuses includes contextPercent for the project', () => {
    const project = tmpProject();
    recordContextPercent(project, 'a', 30);
    recordContextPercent(project, 'b', 90);
    const byId = new Map(getStatuses(project).map((r) => [r.session, r.contextPercent]));
    expect(byId.get('a')).toBe(30);
    expect(byId.get('b')).toBe(90);
  });

  it('contextPercent is null for a status-only row', () => {
    const project = tmpProject();
    recordStatus(project, 'status-only', 'active');
    expect(getStatus(project, 'status-only')?.contextPercent ?? null).toBeNull();
  });
});

describe('checkpoint-ready gate (context-watchdog)', () => {
  it('not ready before any checkpoint', () => {
    const project = tmpProject();
    recordStatus(project, 'w', 'active');
    expect(isCheckpointReady(project, 'w')).toBe(false);
  });

  it('record → ready, sets status=checkpoint_ready + checkpointReadyAt', () => {
    const project = tmpProject();
    recordCheckpointReady(project, 'w');
    const row = getStatus(project, 'w');
    expect(row?.status).toBe('checkpoint_ready');
    expect(typeof row?.checkpointReadyAt).toBe('number');
    expect(isCheckpointReady(project, 'w')).toBe(true);
  });

  it('gate respects maxAgeMs (stale checkpoint is NOT ready)', () => {
    const project = tmpProject();
    recordCheckpointReady(project, 'w');
    // a negative window can never be satisfied → treated as stale
    expect(isCheckpointReady(project, 'w', -1)).toBe(false);
    expect(isCheckpointReady(project, 'w', 60_000)).toBe(true);
  });

  it('clearCheckpointReady consumes the marker (post-/clear)', () => {
    const project = tmpProject();
    recordCheckpointReady(project, 'w');
    clearCheckpointReady(project, 'w');
    expect(getStatus(project, 'w')?.checkpointReadyAt ?? null).toBeNull();
    expect(isCheckpointReady(project, 'w')).toBe(false);
  });

  it('a later activity status does NOT reopen a consumed gate', () => {
    const project = tmpProject();
    recordCheckpointReady(project, 'w');
    clearCheckpointReady(project, 'w');
    recordStatus(project, 'w', 'active'); // resume
    expect(isCheckpointReady(project, 'w')).toBe(false);
  });
});

describe('watchdog debounce', () => {
  const NOW = 2_000_000_000_000;
  it('first emit allowed, immediate repeat within cooldown suppressed', () => {
    const project = tmpProject();
    expect(tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW)).toBe(true);
    expect(tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW + 1000)).toBe(false);
  });

  it('re-allowed once the cooldown elapses', () => {
    const project = tmpProject();
    tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW);
    expect(tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW + 600_001)).toBe(true);
  });

  it('debounce is per (session, action)', () => {
    const project = tmpProject();
    tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW);
    expect(tryEmitWatchdogAction(project, 'other', 'checkpoint', 600_000, NOW)).toBe(true);
    expect(tryEmitWatchdogAction(project, 's', 'clear', 600_000, NOW)).toBe(true);
  });

  it('reset clears the debounce so a new cycle may emit immediately', () => {
    const project = tmpProject();
    tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW);
    resetWatchdogDebounce(project, 's');
    expect(tryEmitWatchdogAction(project, 's', 'checkpoint', 600_000, NOW + 1000)).toBe(true);
  });
});
