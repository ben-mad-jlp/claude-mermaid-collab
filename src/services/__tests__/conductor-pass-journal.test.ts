// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openPassRow,
  finalizePassRow,
  appendPassProgress,
  listConductorPasses,
  countConsecutiveFailedPasses,
  _closeConductorJournalDb,
} from '../conductor-pass-journal';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conductor-pass-journal-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeConductorJournalDb();
});
afterEach(() => {
  _closeConductorJournalDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('conductor-pass-journal', () => {
  test('a finalized row round-trips every field through listConductorPasses', () => {
    const id = openPassRow('/p', 'm1', 1000);
    expect(id).not.toBeNull();

    const ok = finalizePassRow(id as string, {
      endedAt: 2000,
      serveFp: 'sfp1',
      passFp: 'pfp1',
      selfFp: 'selffp1',
      arm: 'node',
      criteriaActed: [{ criterionId: 'c1', action: 'served' }],
      filed: { epicId: 'e1' },
      declined: [{ what: 'redecompose', why: 'not ready' }],
      outcome: 'node-succeeded',
      ran: true,
    });
    expect(ok).toBe(true);

    const rows = listConductorPasses('/p', { missionId: 'm1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      project: '/p',
      missionId: 'm1',
      startedAt: 1000,
      endedAt: 2000,
      serveFp: 'sfp1',
      passFp: 'pfp1',
      selfFp: 'selffp1',
      arm: 'node',
      criteriaActed: [{ criterionId: 'c1', action: 'served' }],
      filed: { epicId: 'e1' },
      declined: [{ what: 'redecompose', why: 'not ready' }],
      outcome: 'node-succeeded',
      ran: true,
    });
  });

  test('a row opened and never finalized reads back with outcome null and its partial fields intact', () => {
    const id = openPassRow('/p', 'm1', 1000);
    expect(id).not.toBeNull();

    const ok = appendPassProgress(id as string, { serveFp: 'sfp1', arm: 'infra' });
    expect(ok).toBe(true);

    const rows = listConductorPasses('/p', { missionId: 'm1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      endedAt: null,
      outcome: null,
      ran: null,
      serveFp: 'sfp1',
      arm: 'infra',
      criteriaActed: [],
      declined: [],
      filed: null,
    });
  });

  test('countConsecutiveFailedPasses returns the contiguous fail run and resets on a productive row or serveFp change', () => {
    // Oldest -> newest: 1000 (fail sfp1), 2000 (fail sfp1), 3000 (fail sfp1) => run of 3
    for (const startedAt of [1000, 2000, 3000]) {
      const id = openPassRow('/p', 'm1', startedAt) as string;
      finalizePassRow(id, { endedAt: startedAt + 500, serveFp: 'sfp1', outcome: 'node-failed', ran: true });
    }
    expect(countConsecutiveFailedPasses('/p', 'm1', 'sfp1')).toBe(3);

    // A productive row on top stops the run at 0 for sfp1
    const productiveId = openPassRow('/p', 'm1', 4000) as string;
    finalizePassRow(productiveId, { endedAt: 4500, serveFp: 'sfp1', outcome: 'node-succeeded', ran: true });
    expect(countConsecutiveFailedPasses('/p', 'm1', 'sfp1')).toBe(0);

    // A serveFp change on the newest row also resets the count for the old fp
    const changedId = openPassRow('/p', 'm2', 1000) as string;
    finalizePassRow(changedId, { endedAt: 1500, serveFp: 'sfp2', outcome: 'node-failed', ran: true });
    const olderId = openPassRow('/p', 'm2', 500) as string;
    finalizePassRow(olderId, { endedAt: 900, serveFp: 'sfp1', outcome: 'node-failed', ran: true });
    expect(countConsecutiveFailedPasses('/p', 'm2', 'sfp1')).toBe(0);
    expect(countConsecutiveFailedPasses('/p', 'm2', 'sfp2')).toBe(1);
  });

  test('fail-open: every exported function returns its degraded value when the db handle cannot open', () => {
    // Point MERMAID_SUPERVISOR_DIR at a path that cannot be created as a directory
    // (a file at that location blocks mkdirSync).
    const blockerDir = mkdtempSync(join(tmpdir(), 'conductor-pass-journal-blocker-'));
    const blockedPath = join(blockerDir, 'blocked-file');
    require('node:fs').writeFileSync(blockedPath, 'not a directory');
    process.env.MERMAID_SUPERVISOR_DIR = blockedPath;
    _closeConductorJournalDb();

    expect(openPassRow('/p', 'm1', 1000)).toBeNull();
    expect(finalizePassRow('nonexistent-id', { outcome: 'node-failed' })).toBe(false);
    expect(appendPassProgress('nonexistent-id', { arm: 'node' })).toBe(false);
    expect(listConductorPasses('/p')).toEqual([]);
    expect(countConsecutiveFailedPasses('/p', 'm1', 'sfp1')).toBe(0);

    rmSync(blockerDir, { recursive: true, force: true });
  });
});
