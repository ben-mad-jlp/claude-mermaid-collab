import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatConductorPass,
  fetchConductorJournalWithNicknames,
  groupConductorPasses,
  type ConductorPassRow,
} from '../conductorActivity';
import { formatConductorPass as serverFormatConductorPass } from '@server/services/conductor-pass-format.ts';

function mkRow(over: Partial<ConductorPassRow> = {}): ConductorPassRow {
  return {
    id: 'p1',
    project: '/proj',
    missionId: 'm1',
    startedAt: 100,
    endedAt: 200,
    arm: 'node',
    criteriaActed: [],
    filed: null,
    declined: [],
    outcome: 'ok',
    ran: true,
    ...over,
  };
}

describe('ConductorPassRow.summary', () => {
  it('carries a node-authored summary through the row type', () => {
    const row = mkRow({ summary: 'Declined to re-plan: the epic is built but unlanded.' });
    expect(row.summary).toBe('Declined to re-plan: the epic is built but unlanded.');
  });

  it('groups split when two otherwise-identical passes carry different summaries', () => {
    const rows = [
      mkRow({ id: 'p1', startedAt: 300, summary: 'Held: base gate is red.' }),
      mkRow({ id: 'p2', startedAt: 200, summary: 'Held: nothing was ready to serve.' }),
      mkRow({ id: 'p3', startedAt: 100, summary: 'Held: nothing was ready to serve.' }),
    ];
    const groups = groupConductorPasses(rows, 1_000);
    expect(groups).toHaveLength(2);
    expect(groups[0].count).toBe(1);
    expect(groups[1].count).toBe(2);
  });

  it('summary-less rows still collapse exactly as before', () => {
    const rows = [mkRow({ id: 'p1', startedAt: 300 }), mkRow({ id: 'p2', startedAt: 200 })];
    expect(groupConductorPasses(rows, 1_000)).toHaveLength(1);
  });
});

describe('fetchConductorJournalWithNicknames pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends limit and offset in the query and returns the server total', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [mkRow()], nicknames: { a: 'b' }, total: 137 }),
    });
    global.fetch = fetchMock as any;

    const result = await fetchConductorJournalWithNicknames('/proj', { limit: 25, offset: 50 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(result.total).toBe(137);
    expect(result.nicknames).toEqual({ a: 'b' });
  });

  it('omits offset from the query when it is not supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [], nicknames: {}, total: 0 }),
    });
    global.fetch = fetchMock as any;

    await fetchConductorJournalWithNicknames('/proj');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('offset=');
  });

  it('falls back to the received row count when the response omits total', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [mkRow({ id: 'a' }), mkRow({ id: 'b' })] }),
    }) as any;

    expect((await fetchConductorJournalWithNicknames('/proj')).total).toBe(2);
  });

  it('degrades to zero rows and zero total on a failed response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
    expect(await fetchConductorJournalWithNicknames('/proj')).toEqual({ rows: [], nicknames: {}, total: 0 });
  });
});

describe('formatConductorPass', () => {
  it('typed-filed row includes filed clause and chip', () => {
    const row = mkRow({
      filed: [{ kind: 'epic', id: 'e1', title: 'My Epic' }],
    });
    const result = formatConductorPass(row);
    expect(result.sentence).toContain('filed epic My Epic');
    expect(result.chips).toContainEqual({ kind: 'epic', id: 'e1', label: 'My Epic' });
  });

  it('legacy filed record', () => {
    const row = mkRow({
      filed: [{ foo: 'bar' }],
    });
    const result = formatConductorPass(row);
    expect(result.sentence).toContain('filed items (legacy record)');
  });

  it('unfinished row reads as in-flight while under the node budget', () => {
    const row = mkRow({ endedAt: null });
    // The journal row is written at pass START, so endedAt===null also means "running".
    expect(formatConductorPass(row, row.startedAt + 60_000).sentence).toContain('in flight (1m)');
    expect(formatConductorPass(row, row.startedAt + 60_000).sentence).not.toContain('killed');
  });

  it('unfinished row reads as killed once past the node budget', () => {
    const row = mkRow({ endedAt: null });
    expect(formatConductorPass(row, row.startedAt + 1_200_000).sentence).toContain('killed (ran out of time)');
  });

  it('declined-with-entity row pushes a chip', () => {
    const row = mkRow({
      declined: [{ what: 'thing', why: 'reason', entityType: 'leaf', entityId: 'l1' }],
    });
    const result = formatConductorPass(row);
    expect(result.chips).toContainEqual({ kind: 'leaf', id: 'l1', label: 'l1' });
    expect(result.sentence).toContain('declined thing (reason)');
  });

  it('renders arm: node in the sentence', () => {
    const row = mkRow({ arm: 'node' });
    const result = formatConductorPass(row);
    expect(result.sentence).toContain('arm: node');
  });

  it('renders arm: none literally in the sentence', () => {
    const row = mkRow({ arm: 'none' });
    const result = formatConductorPass(row);
    expect(result.sentence).toContain('arm: none');
  });

  it('omits the arm clause when arm is null', () => {
    const row = mkRow({ arm: null });
    const result = formatConductorPass(row);
    expect(result.sentence).not.toContain('arm:');
  });

  it('matches the backend reference implementation over fixture rows', () => {
    const rows: ConductorPassRow[] = [
      mkRow({ filed: [{ kind: 'epic', id: 'e1', title: 'My Epic' }] }),
      mkRow({ filed: [{ foo: 'bar' }] }),
      mkRow({ endedAt: null }),
      mkRow({ declined: [{ what: 'thing', why: 'reason', entityType: 'leaf', entityId: 'l1' }] }),
      mkRow({ arm: 'node' }),
      mkRow({ arm: 'none' }),
      mkRow({ arm: null }),
    ];
    // Fixed clock on BOTH sides: the unfinished-row sentence is age-derived, so letting
    // each default to its own Date.now() compares two instants and flakes on a boundary.
    const now = 100 + 5 * 60_000;
    for (const row of rows) {
      const uiResult = formatConductorPass(row, now);
      const serverResult = serverFormatConductorPass(row as any, now);
      expect(uiResult).toEqual(serverResult);
    }
  });
});
