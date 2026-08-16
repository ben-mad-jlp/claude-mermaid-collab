import { describe, test, expect } from 'bun:test';
import { formatConductorPass, groupConductorPasses } from '../conductor-pass-format';
import type { ConductorPassJournalRow } from '../conductor-pass-journal';
import { CONDUCTOR_NODE_TIMEOUT_MS } from '../harness-caps';

function mkGroupRow(overrides: Partial<ConductorPassJournalRow> & { id: string; startedAt: number }): ConductorPassJournalRow {
  return {
    project: '/proj',
    missionId: 'mission-group',
    endedAt: 2000,
    serveFp: null,
    passFp: null,
    selfFp: null,
    arm: 'node',
    criteriaActed: [],
    filed: null,
    declined: [],
    outcome: 'ok',
    ran: true,
    failCounted: null,
    carried: null,
    summary: null,
    ...overrides,
  };
}

describe('formatConductorPass', () => {
  test('formats a fully typed modern row into the exact sentence with epic and leaf chips', () => {
    const row: ConductorPassJournalRow = {
      id: 'p1',
      project: '/proj',
      missionId: 'abc12345',
      startedAt: 1000,
      endedAt: 2000,
      serveFp: null,
      passFp: null,
      selfFp: null,
      arm: null,
      criteriaActed: [{ criterionId: 'crit1', action: 'served', servedEpicId: 'epic123' }],
      filed: [{ kind: 'epic', id: 'epicXYZ', title: 'Add foo' }],
      declined: [{ what: 'crit2', why: 'not ready', entityType: 'leaf', entityId: 'leaf99' }],
      outcome: null,
      ran: null,
      failCounted: null,
      carried: null,
      summary: null,
    };

    const result = formatConductorPass(row);

    expect(result.sentence).toBe(
      'Mission abc12345. served 1 criterion via epic epic123. declined crit2 (not ready). filed epic Add foo.',
    );
    expect(result.chips).toEqual([
      { kind: 'epic', id: 'epic123', label: 'epic123' },
      { kind: 'leaf', id: 'leaf99', label: 'leaf99' },
      { kind: 'epic', id: 'epicXYZ', label: 'Add foo' },
    ]);
  });

  const legacyRow: ConductorPassJournalRow = {
    id: 'p2',
    project: '/proj',
    missionId: 'def67890',
    startedAt: 1000,
    endedAt: 2000,
    serveFp: null,
    passFp: null,
    selfFp: null,
    arm: null,
    criteriaActed: [{ criterionId: 'crit3', action: 'served' }],
    filed: { filedCount: 3 } as unknown as ConductorPassJournalRow['filed'],
    declined: [],
    outcome: null,
    ran: null,
    failCounted: null,
    carried: null,
    summary: null,
  };

  test('renders a legacy filed count object as plain non-clickable text', () => {
    const result = formatConductorPass(legacyRow);
    expect(result.sentence).toBe('Mission def67890. acted on crit3 (served). filed items (legacy record).');
  });

  test('emits no chips for the legacy filed row', () => {
    const result = formatConductorPass(legacyRow);
    expect(result.chips.length).toBe(0);
  });

  test('renders a killed row (endedAt: null) as unfinished without throwing', () => {
    const row: ConductorPassJournalRow = {
      id: 'p3',
      project: '/proj',
      missionId: null,
      startedAt: 1000,
      endedAt: null,
      serveFp: null,
      passFp: null,
      selfFp: null,
      arm: null,
      criteriaActed: [],
      filed: null,
      declined: [],
      outcome: null,
      ran: null,
      failCounted: null,
      carried: null,
      summary: null,
    };

    // An unfinished row is only a corpse once it is PAST the node budget. Under it, the
    // pass is still running and must say so — reporting a live pass as killed is the bug
    // this covers (2026-08-05: a healthy 3-minute pass announced as having run out of time).
    const inFlight = formatConductorPass(row, row.startedAt + 3 * 60_000);
    expect(inFlight.sentence).toBe('No mission. in flight (3m).');
    expect(inFlight.chips.length).toBe(0);

    const subMinute = formatConductorPass(row, row.startedAt + 42_000);
    expect(subMinute.sentence).toBe('No mission. in flight (42s).');

    const killed = formatConductorPass(row, row.startedAt + CONDUCTOR_NODE_TIMEOUT_MS);
    expect(killed.sentence).toBe('No mission. killed (ran out of time).');
    expect(killed.chips.length).toBe(0);
  });

  test('dedupes 7 identical-epic criteria into one grouped clause naming the nickname once', () => {
    const criteriaActed = Array.from({ length: 7 }, (_, i) => ({
      criterionId: `crit${i}`,
      action: 'served',
      servedEpicId: 'epic-shared-uuid-0000',
      servedEpicNickname: 'brave-otter',
    }));
    const row: ConductorPassJournalRow = {
      id: 'p6',
      project: '/proj',
      missionId: 'abc12345',
      startedAt: 1000,
      endedAt: 2000,
      serveFp: null,
      passFp: null,
      selfFp: null,
      arm: null,
      criteriaActed,
      filed: null,
      declined: [],
      outcome: null,
      ran: null,
      failCounted: null,
      carried: null,
      summary: null,
    };

    const result = formatConductorPass(row);
    expect((result.sentence.match(/brave-otter/g) ?? []).length).toBe(1);
    expect(result.sentence).toContain('7 criteria');
    expect(result.sentence.split('epic-shared-uuid-0000').length - 1).toBe(0);
  });

  test('renders arm: node for a row with arm set to node', () => {
    const row: ConductorPassJournalRow = {
      id: 'p4',
      project: '/proj',
      missionId: null,
      startedAt: 1000,
      endedAt: 2000,
      serveFp: null,
      passFp: null,
      selfFp: null,
      arm: 'node',
      criteriaActed: [],
      filed: null,
      declined: [],
      outcome: null,
      ran: null,
      failCounted: null,
      carried: null,
      summary: null,
    };

    const result = formatConductorPass(row);
    expect(result.sentence).toContain('arm: node');
  });

  test('renders arm: none literally for a row with arm set to the none sentinel', () => {
    const row: ConductorPassJournalRow = {
      id: 'p5',
      project: '/proj',
      missionId: null,
      startedAt: 1000,
      endedAt: 2000,
      serveFp: null,
      passFp: null,
      selfFp: null,
      arm: 'none',
      criteriaActed: [],
      filed: null,
      declined: [],
      outcome: null,
      ran: null,
      failCounted: null,
      carried: null,
      summary: null,
    };

    const result = formatConductorPass(row);
    expect(result.sentence).toContain('arm: none');
  });
});

describe('groupConductorPasses', () => {
  test('groupConductorPasses collapses 27 identical debounced passes into one group', () => {
    const fixture: ConductorPassJournalRow[] = Array.from({ length: 27 }, (_, i) =>
      mkGroupRow({ id: `p${i}`, startedAt: 1000 + i * 10 }),
    );

    const result = groupConductorPasses(fixture);

    expect(result.length).toBe(1);
    expect(result[0].count).toBe(27);
    expect(result[0].firstStartedAt).toBe(fixture[0].startedAt);
    expect(result[0].lastStartedAt).toBe(fixture[26].startedAt);
  });

  test('groupConductorPasses splits on a differing outcome mid-run into three groups', () => {
    const fixture: ConductorPassJournalRow[] = Array.from({ length: 27 }, (_, i) =>
      mkGroupRow({ id: `p${i}`, startedAt: 1000 + i * 10 }),
    );
    const outlier = mkGroupRow({ id: 'p-outlier', startedAt: 1135, outcome: 'different-outcome' });
    fixture.splice(13, 0, outlier);

    const result = groupConductorPasses(fixture);

    expect(result.length).toBe(3);
    expect(result.reduce((sum, g) => sum + g.count, 0)).toBe(28);
  });
});
