import { describe, it, expect } from 'vitest';
import { formatConductorPass, type ConductorPassRow } from '../conductorActivity';
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

  it('killed row', () => {
    const row = mkRow({ endedAt: null });
    const result = formatConductorPass(row);
    expect(result.sentence).toContain('killed (ran out of time)');
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
    for (const row of rows) {
      const uiResult = formatConductorPass(row);
      const serverResult = serverFormatConductorPass(row as any);
      expect(uiResult).toEqual(serverResult);
    }
  });
});
