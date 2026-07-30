import { describe, test, expect } from 'bun:test';
import { formatConductorPass } from '../conductor-pass-format';
import type { ConductorPassJournalRow } from '../conductor-pass-journal';

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
    };

    const result = formatConductorPass(row);

    expect(result.sentence).toBe(
      'Mission abc12345. acted on crit1 (served) via epic epic123. declined crit2 (not ready). filed epic Add foo.',
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
    };

    const result = formatConductorPass(row);
    expect(result.sentence).toBe('No mission. unfinished (killed).');
    expect(result.chips.length).toBe(0);
  });
});
