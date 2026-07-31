import { describe, expect, test } from 'bun:test';
import { formatConductorPass as backendFormat, groupConductorPasses as backendGroup } from '../conductor-pass-format';
import { formatConductorPass as uiFormat, groupConductorPasses as uiGroup } from '../../../ui/src/lib/conductorActivity';
import type { ConductorPassJournalRow } from '../conductor-pass-journal';

function mkRow(overrides: Partial<ConductorPassJournalRow>): ConductorPassJournalRow {
  return {
    id: 'row-1',
    project: '/proj',
    missionId: 'mission-1',
    startedAt: 1000,
    endedAt: 2000,
    serveFp: null,
    passFp: null,
    selfFp: null,
    arm: 'node',
    criteriaActed: [],
    filed: [],
    declined: [],
    outcome: null,
    ran: true,
    failCounted: null,
    carried: null,
    ...overrides,
  };
}

const FIXTURES: ConductorPassJournalRow[] = [
  mkRow({
    criteriaActed: [
      { criterionId: 'crit-1', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: null },
      { criterionId: 'crit-2', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: 'nice-name' },
      { criterionId: 'crit-3', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: null },
      { criterionId: 'crit-4', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: 'other-name' },
      { criterionId: 'crit-5', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: null },
      { criterionId: 'crit-6', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: null },
      { criterionId: 'crit-7', action: 'served', servedEpicId: 'epic-aaaaaaaa', servedEpicNickname: null },
    ],
  }),
  mkRow({ endedAt: null }),
  mkRow({
    criteriaActed: [
      { criterionId: 'crit-solo', action: 'declined-serve' },
      { criterionId: 'crit-1', action: 'served', servedEpicId: 'epic-bbbbbbbb', servedEpicNickname: 'epic-b-name' },
      { criterionId: 'crit-2', action: 'served', servedEpicId: 'epic-bbbbbbbb', servedEpicNickname: null },
    ],
    declined: [{ what: 'thing', why: 'reason', entityType: 'leaf', entityId: 'leaf-1' }],
    filed: [{ kind: 'epic', id: 'epic-ccc', title: 'Some epic' }],
  }),
];

describe('backend/UI conductor-pass formatter parity', () => {
  test('backend and UI formatConductorPass produce identical sentences for every fixture', () => {
    for (const row of FIXTURES) {
      const backend = backendFormat(row);
      const ui = uiFormat(row as any);
      expect(ui.sentence).toBe(backend.sentence);
      expect(ui.chips).toEqual(backend.chips);
    }
  });

  test('backend and UI groupConductorPasses produce identical groups for the collapse/split fixtures', () => {
    const identicalFixture: ConductorPassJournalRow[] = Array.from({ length: 27 }, (_, i) =>
      mkRow({ id: `g${i}`, startedAt: 1000 + i * 10, missionId: 'group-mission', arm: 'node', outcome: 'ok' }),
    );
    const splitFixture: ConductorPassJournalRow[] = [...identicalFixture];
    splitFixture.splice(
      13,
      0,
      mkRow({ id: 'g-outlier', startedAt: 1135, missionId: 'group-mission', arm: 'node', outcome: 'different-outcome' }),
    );

    for (const fixture of [FIXTURES, identicalFixture, splitFixture]) {
      const backend = backendGroup(fixture);
      const ui = uiGroup(fixture as any);
      expect(ui).toEqual(backend as any);
    }
  });
});
