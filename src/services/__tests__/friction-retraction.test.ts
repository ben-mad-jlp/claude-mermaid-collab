/**
 * Friction retraction (handoff Finding 3 fallout).
 *
 * friction_notes was append-only, so a note whose ANALYSIS WAS WRONG stayed queryable and
 * indistinguishable from a correct one — counted by friction_trends as recurrence signal, and
 * read as prior art by anyone grepping for it. Paid for by note 95c5c237, which argued at length
 * that no public verb could retire a superseded leaf and asked for a `drop_todo` duplicating
 * `reset_todo`; its only available correction was ANOTHER note.
 *
 * MUTATION CONTRACT: retraction must be invisible BY DEFAULT and visible on request. Make
 * listFriction ignore `includeRetracted` (always show) and Test B reds; make it always hide and
 * Test C reds. Remove the unknown-id throw and Test E reds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordFriction, listFriction, retractFriction, _closeProject,
} from '../friction-store';
import { frictionTrends } from '../friction-trends';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'friction-retract-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

async function seed(reason: string, detail = 'd'): Promise<string> {
  const n = await recordFriction(project, { layer: 'orchestration', retryReason: reason, detail });
  return n.id;
}

describe('friction retraction', () => {
  it('Test A: a fresh note is not retracted', async () => {
    await seed('some-reason');
    const [n] = listFriction(project);
    expect(n!.retractedAt).toBeNull();
    expect(n!.retractedReason).toBeNull();
    expect(n!.supersededBy).toBeNull();
  });

  it('Test B: a retracted note is EXCLUDED from listFriction by default', async () => {
    const id = await seed('no-public-verb-to-retire-a-poisoned-leaf');
    expect(listFriction(project)).toHaveLength(1);

    retractFriction(project, { id, reason: 'reset_todo already accepts the dropped status' });

    expect(listFriction(project)).toHaveLength(0);
  });

  it('Test C: includeRetracted brings it back, carrying the reason', async () => {
    const id = await seed('wrong-analysis');
    retractFriction(project, { id, reason: 'duplicates an existing verb', supersededBy: 'note-123' });

    const all = listFriction(project, { includeRetracted: true });
    expect(all).toHaveLength(1);
    expect(all[0]!.retractedAt).not.toBeNull();
    expect(all[0]!.retractedReason).toBe('duplicates an existing verb');
    expect(all[0]!.supersededBy).toBe('note-123');
  });

  it('Test D: retracted notes stop counting as recurrence signal in frictionTrends', async () => {
    for (let i = 0; i < 3; i++) await seed('repeating-reason', `d${i}`);
    const ids = listFriction(project).map((n) => n.id);

    expect(frictionTrends(project).total).toBe(3);

    // Two of the three were wrong; the trend must fall to the one that stands.
    retractFriction(project, { id: ids[0]!, reason: 'misdiagnosed' });
    retractFriction(project, { id: ids[1]!, reason: 'misdiagnosed' });

    const after = frictionTrends(project);
    expect(after.total).toBe(1);
    // This is the point: a wrong note must not inflate "what keeps going wrong".
    const recurring = after.recurring.find((r) => r.retryReason === 'repeating-reason');
    expect(recurring).toBeUndefined();
  });

  it('Test E: retracting an UNKNOWN id throws — a zero-row write must not report success', async () => {
    await seed('present');
    expect(() => retractFriction(project, { id: 'no-such-id', reason: 'x' })).toThrow(/no friction note/);
    // and nothing was collaterally retracted
    expect(listFriction(project)).toHaveLength(1);
  });

  it('Test F: a reason is REQUIRED — an unreviewable retraction is refused', async () => {
    const id = await seed('present');
    expect(() => retractFriction(project, { id, reason: '  ' })).toThrow(/reason is required/);
    expect(listFriction(project)).toHaveLength(1);
  });

  it('Test G: re-retracting is idempotent and does not overwrite the original reason', async () => {
    const id = await seed('present');
    const first = retractFriction(project, { id, reason: 'the original reason' });
    const second = retractFriction(project, { id, reason: 'a different later reason' });

    expect(second.retractedReason).toBe('the original reason');
    expect(second.retractedAt).toBe(first.retractedAt);
  });

  it('Test H: retraction does not disturb other notes', async () => {
    const a = await seed('reason-a');
    await seed('reason-b');
    retractFriction(project, { id: a, reason: 'wrong' });

    const left = listFriction(project);
    expect(left).toHaveLength(1);
    expect(left[0]!.retryReason).toBe('reason-b');
    expect(left[0]!.retractedAt).toBeNull();
  });
});
