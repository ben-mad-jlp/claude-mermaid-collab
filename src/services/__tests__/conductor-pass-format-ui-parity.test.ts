import { describe, expect, test } from 'bun:test';
import { formatConductorPass as backendFormat, groupConductorPasses as backendGroup } from '../conductor-pass-format';
import { formatConductorPass as uiFormat, groupConductorPasses as uiGroup } from '../../../ui/src/lib/conductorActivity';
import type { ConductorPassJournalRow } from '../conductor-pass-journal';
import { CONDUCTOR_NODE_TIMEOUT_MS } from '../harness-caps';

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
    summary: null,
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

// A FIXED clock, passed to both sides. The unfinished-row sentence is age-derived, so
// letting each side default to its own Date.now() would compare two different instants
// and flake whenever the pair straddles a second/minute boundary.
const NOW = 1000 + 3 * 60_000; // 3 minutes into the fixture's startedAt: 1000

describe('backend/UI conductor-pass formatter parity', () => {
  test('backend and UI formatConductorPass produce identical sentences for every fixture', () => {
    for (const row of FIXTURES) {
      const backend = backendFormat(row, NOW);
      const ui = uiFormat(row as any, NOW);
      expect(ui.sentence).toBe(backend.sentence);
      expect(ui.chips).toEqual(backend.chips);
    }
  });

  test('the two CONDUCTOR_NODE_TIMEOUT_MS copies agree — the in-flight/killed boundary', () => {
    // The UI duplicates the constant (it cannot import the bun:sqlite-bearing chain), so
    // a drift would silently move the boundary on one side only. Probe it from outside:
    // one ms under the backend's budget must read in-flight on BOTH, and exactly at it
    // must read killed on BOTH.
    const started = 0;
    const justUnder = mkRow({ startedAt: started, endedAt: null, arm: null, missionId: null });
    const under = CONDUCTOR_NODE_TIMEOUT_MS - 1;
    expect(uiFormat(justUnder as any, under).sentence).toBe(backendFormat(justUnder, under).sentence);
    expect(backendFormat(justUnder, under).sentence).toContain('in flight');

    const at = CONDUCTOR_NODE_TIMEOUT_MS;
    expect(uiFormat(justUnder as any, at).sentence).toBe(backendFormat(justUnder, at).sentence);
    expect(backendFormat(justUnder, at).sentence).toContain('killed (ran out of time)');
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
