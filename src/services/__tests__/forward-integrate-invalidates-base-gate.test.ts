/**
 * A base-gate verdict describes ONE base tree. Move the base and the verdict is about a tree
 * that no longer exists — so it must not survive the move.
 *
 * MEASURED 2026-08-11: two tests on trunk manufactured a red on every epic base. They were
 * fixed on master within minutes, but eight epics stayed parked for hours: their `epic_base_gate`
 * rows still held the pre-fix verdict, so leaves kept reading `epic-base-red` for a failure that
 * no longer existed. Nothing in the system cleared the row — parking was one-way, and only a
 * human noticing broke the loop.
 *
 * The park has always ASSUMED it self-heals on a base move. `_forwardIntegrateEpicInner` is the
 * writer that makes that true: on advance it drops the row so the next claim re-measures.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { recordEpicBaseGate, getEpicBaseGate, invalidateEpicBaseGate } from '../worker-ledger';

const EPIC = `fi-invalidate-${process.pid}`;
const OTHER = `fi-invalidate-other-${process.pid}`;
const PROJECT = '/tmp/fi-invalidate-proj';

function seedRed(epicId: string, baseSha: string) {
  recordEpicBaseGate({
    epicId,
    project: PROJECT,
    baseSha,
    status: 'fail',
    command: 'bun run scripts/test-backend.ts',
    output: 'Expected: 25\nReceived: 20',
  });
}

beforeEach(() => {
  for (const id of [EPIC, OTHER]) { try { invalidateEpicBaseGate(id); } catch { /* first run */ } }
});

describe('a base-gate verdict does not outlive its base', () => {
  it('a recorded red is readable until something clears it', () => {
    seedRed(EPIC, 'oldbase1');
    const row = getEpicBaseGate(EPIC, 'oldbase1');
    expect(row?.status).toBe('fail');
    expect(row?.baseSha).toBe('oldbase1');
  });

  it('invalidation removes the row so the next claim RE-MEASURES', () => {
    seedRed(EPIC, 'oldbase1');

    expect(invalidateEpicBaseGate(EPIC).deleted).toBe(true);
    // Absent, not flipped to pass: a cleared gate means "unknown, go measure". Inventing a green
    // would wave a genuinely broken base straight through.
    expect(getEpicBaseGate(EPIC, 'oldbase1')).toBeNull();
  });

  it('is safe on an epic with no row — the merge still succeeded', () => {
    // The integration path calls this unconditionally on advance; an epic gated for the first
    // time after its merge has nothing to clear, and that must not read as a failure.
    expect(() => invalidateEpicBaseGate(EPIC)).not.toThrow();
    expect(invalidateEpicBaseGate(EPIC).deleted).toBe(false);
  });

  it('clears only the named epic, never the whole table', () => {
    seedRed(EPIC, 'oldbase1');
    seedRed(OTHER, 'otherbase');

    invalidateEpicBaseGate(EPIC);

    // A blanket clear would re-run every epic's full suite at once — the unbounded base-gate
    // fan-out that saturates the box.
    expect(getEpicBaseGate(OTHER, 'otherbase')?.status).toBe('fail');
  });
});
