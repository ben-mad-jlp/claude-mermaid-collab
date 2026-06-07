import { describe, it, expect } from 'vitest';
import type { Escalation } from '@/stores/supervisorStore';
import {
  selectOpenEscalations,
  selectOpenEscalationsByProject,
  selectFleetOpenCount,
} from '../escalationSelectors';

const esc = (project: string, status: string, id: string): Escalation =>
  ({
    id,
    project,
    session: `${project}-sess`,
    kind: 'decision',
    questionText: 'q',
    status,
    createdAt: 1,
  }) as Escalation;

const FIXTURE: Escalation[] = [
  esc('projA', 'open', 'a1'),
  esc('projA', 'open', 'a2'),
  esc('projA', 'resolved', 'a3'),
  esc('projB', 'open', 'b1'),
  esc('projC', 'resolved', 'c1'),
];

describe('selectOpenEscalationsByProject', () => {
  it('counts only OPEN escalations, grouped by project', () => {
    expect(selectOpenEscalationsByProject(FIXTURE)).toEqual({ projA: 2, projB: 1 });
  });

  it('omits projects with no open escalations', () => {
    expect(selectOpenEscalationsByProject(FIXTURE).projC).toBeUndefined();
  });

  it('returns {} for an empty list', () => {
    expect(selectOpenEscalationsByProject([])).toEqual({});
  });
});

describe('selectFleetOpenCount', () => {
  it('is the sum of the per-project counts', () => {
    const counts = selectOpenEscalationsByProject(FIXTURE);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(selectFleetOpenCount(FIXTURE)).toBe(sum);
    expect(selectFleetOpenCount(FIXTURE)).toBe(3);
  });
});

// The load-bearing parity invariant of the multi-project Bridge: the per-project
// detail count (selectOpenEscalations — feeds NeedsYouZone + the FleetGraph danger
// ring) MUST equal the rail/roll-up count for that project. One counting path.
describe('parity: selectOpenEscalations(p).length === byProject[p]', () => {
  it('holds for every project in the fixture (and 0 when absent)', () => {
    const counts = selectOpenEscalationsByProject(FIXTURE);
    for (const p of ['projA', 'projB', 'projC', 'projMissing']) {
      expect(selectOpenEscalations(FIXTURE, p).length).toBe(counts[p] ?? 0);
    }
  });
});
