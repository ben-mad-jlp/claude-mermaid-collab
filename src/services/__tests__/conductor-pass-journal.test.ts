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
  listConductorPassesPage,
  countConductorPasses,
  countConsecutiveFailedPasses,
  filedRefsOf,
  _closeConductorJournalDb,
  type ConductorFiledRef,
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

  test('a typed row (filed refs, servedEpicId, declined entity refs) round-trips through listConductorPasses', () => {
    const id = openPassRow('/p', 'm1', 1000);
    expect(id).not.toBeNull();

    const ok = finalizePassRow(id as string, {
      endedAt: 2000,
      serveFp: 'sfp1',
      passFp: 'pfp1',
      selfFp: 'selffp1',
      arm: 'node',
      criteriaActed: [{ criterionId: 'c1', action: 'served', servedEpicId: 'e1' }],
      filed: [{ kind: 'epic', id: 'e1', title: 'Epic One' } satisfies ConductorFiledRef],
      declined: [{ what: 'redecompose', why: 'not ready', entityType: 'leaf', entityId: 'l1' }],
      outcome: 'node-succeeded',
      ran: true,
    });
    expect(ok).toBe(true);

    const rows = listConductorPasses('/p', { missionId: 'm1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      criteriaActed: [{ criterionId: 'c1', action: 'served', servedEpicId: 'e1' }],
      filed: [{ kind: 'epic', id: 'e1', title: 'Epic One' }],
      declined: [{ what: 'redecompose', why: 'not ready', entityType: 'leaf', entityId: 'l1' }],
    });
    expect(filedRefsOf(rows[0])).toEqual([{ kind: 'epic', id: 'e1', title: 'Epic One' }]);
  });

  test('a legacy row (count-object filed, criteriaActed without servedEpicId) is read back without throwing and filedRefsOf returns []', () => {
    const id = openPassRow('/p', 'm1', 1000);
    expect(id).not.toBeNull();

    const ok = finalizePassRow(id as string, {
      endedAt: 2000,
      serveFp: 'sfp1',
      criteriaActed: [{ criterionId: 'c1', action: 'served' }],
      filed: { escalationsRaised: 1, infraResets: 0 } as any,
      outcome: 'node-succeeded',
      ran: true,
    });
    expect(ok).toBe(true);

    const rows = listConductorPasses('/p', { missionId: 'm1' });
    expect(rows).toHaveLength(1);
    expect(rows[0].criteriaActed[0].servedEpicId).toBeUndefined();
    expect(filedRefsOf(rows[0])).toEqual([]);
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

  describe('pagination', () => {
    // 5 rows on m1 (startedAt 1000..5000) + 2 on m2, so newest-first for m1 is 5000,4000,...
    function seedPages(): void {
      for (const startedAt of [1000, 2000, 3000, 4000, 5000]) {
        const id = openPassRow('/p', 'm1', startedAt) as string;
        finalizePassRow(id, { endedAt: startedAt + 1, outcome: 'conducted', ran: true });
      }
      for (const startedAt of [1500, 2500]) {
        const id = openPassRow('/p', 'm2', startedAt) as string;
        finalizePassRow(id, { endedAt: startedAt + 1, outcome: 'conducted', ran: true });
      }
    }

    test('offset skips the newest rows without a limit', () => {
      seedPages();
      const rows = listConductorPasses('/p', { missionId: 'm1', offset: 2 });
      expect(rows.map((r) => r.startedAt)).toEqual([3000, 2000, 1000]);
    });

    test('limit + offset compose into non-overlapping pages that cover every row exactly once', () => {
      seedPages();
      const page1 = listConductorPasses('/p', { missionId: 'm1', limit: 2, offset: 0 });
      const page2 = listConductorPasses('/p', { missionId: 'm1', limit: 2, offset: 2 });
      const page3 = listConductorPasses('/p', { missionId: 'm1', limit: 2, offset: 4 });
      expect(page1.map((r) => r.startedAt)).toEqual([5000, 4000]);
      expect(page2.map((r) => r.startedAt)).toEqual([3000, 2000]);
      expect(page3.map((r) => r.startedAt)).toEqual([1000]);
      expect([...page1, ...page2, ...page3].map((r) => r.id)).toHaveLength(
        new Set([...page1, ...page2, ...page3].map((r) => r.id)).size,
      );
    });

    test('an offset past the end returns [] rather than throwing or wrapping', () => {
      seedPages();
      expect(listConductorPasses('/p', { missionId: 'm1', limit: 2, offset: 99 })).toEqual([]);
    });

    test('omitting offset is identical to the pre-pagination behaviour (existing callers unchanged)', () => {
      seedPages();
      const noOpts = listConductorPasses('/p', { missionId: 'm1' });
      const zeroOffset = listConductorPasses('/p', { missionId: 'm1', offset: 0 });
      expect(noOpts.map((r) => r.id)).toEqual(zeroOffset.map((r) => r.id));
      expect(listConductorPasses('/p', { missionId: 'm1', limit: 3 }).map((r) => r.startedAt)).toEqual([
        5000, 4000, 3000,
      ]);
    });

    test('countConductorPasses counts the FILTER, ignoring limit and offset', () => {
      seedPages();
      expect(countConductorPasses('/p')).toBe(7);
      expect(countConductorPasses('/p', { missionId: 'm1' })).toBe(5);
      expect(countConductorPasses('/p', { missionId: 'm2' })).toBe(2);
      expect(countConductorPasses('/p', { missionId: 'nope' })).toBe(0);
    });

    test('listConductorPassesPage returns the page rows plus the unpaged total for the filter', () => {
      seedPages();
      const page = listConductorPassesPage('/p', { missionId: 'm1', limit: 2, offset: 2 });
      expect(page.rows.map((r) => r.startedAt)).toEqual([3000, 2000]);
      expect(page.total).toBe(5);
    });
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
    expect(countConductorPasses('/p')).toBe(0);
    expect(listConductorPassesPage('/p', { limit: 2, offset: 2 })).toEqual({ rows: [], total: 0 });
    expect(countConsecutiveFailedPasses('/p', 'm1', 'sfp1')).toBe(0);

    rmSync(blockerDir, { recursive: true, force: true });
  });
});
