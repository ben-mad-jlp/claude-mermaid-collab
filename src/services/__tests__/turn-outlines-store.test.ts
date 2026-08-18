import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  putTurnOutline,
  listTurnOutlines,
  countTurnOutlines,
  TURN_OUTLINE_RING_CAP,
  __resetForTest,
} from '../turn-outlines-store.ts';

const P1 = '/proj/a';
const P2 = '/proj/b';

beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-outlines-'));
  __resetForTest();
});

describe('turn outlines ring buffer', () => {
  it('putTurnOutline round-trips a nested outline tree through listTurnOutlines', () => {
    const outline = {
      nodes: [{ id: 'n1', label: 'Node 1' }, { id: 'n2', label: 'Node 2' }],
      edges: [{ from: 'n1', to: 'n2', label: 'connects' }],
      metadata: { timestamp: 1234567890, version: 2 },
    };

    putTurnOutline({ project: P1, session: 's1', turn: 't1', outline });
    const rows = listTurnOutlines(P1, 's1');
    expect(rows).toHaveLength(1);
    expect(rows[0].outline).toEqual(outline);
    expect(rows[0].turn).toBe('t1');
  });

  it('posting TURN_OUTLINE_RING_CAP + 5 outlines leaves exactly TURN_OUTLINE_RING_CAP rows, newest retained', () => {
    const baseTs = 1000;
    // Insert t0 through t24 (25 total = TURN_OUTLINE_RING_CAP + 5)
    for (let i = 0; i < TURN_OUTLINE_RING_CAP + 5; i++) {
      putTurnOutline({
        project: P1,
        session: 's1',
        turn: `t${i}`,
        outline: { index: i },
        ts: baseTs + i, // ascending timestamps
      });
    }

    // Should have exactly TURN_OUTLINE_RING_CAP rows
    expect(countTurnOutlines(P1, 's1')).toBe(TURN_OUTLINE_RING_CAP);

    // Newest should be t24
    const rows = listTurnOutlines(P1, 's1');
    expect(rows[0].turn).toBe('t24');

    // The 5 oldest (t0-t4) should be absent
    const turnIds = rows.map((r) => r.turn);
    for (let i = 0; i < 5; i++) {
      expect(turnIds).not.toContain(`t${i}`);
    }

    // The newest TURN_OUTLINE_RING_CAP (t5-t24) should all be present
    for (let i = 5; i < TURN_OUTLINE_RING_CAP + 5; i++) {
      expect(turnIds).toContain(`t${i}`);
    }
  });

  it('ring eviction is scoped to one (project, session) and never drops another session\'s rows', () => {
    const baseTs = 1000;

    // Fill session A (P1/s1) with TURN_OUTLINE_RING_CAP + 5 rows, evicting the oldest 5
    for (let i = 0; i < TURN_OUTLINE_RING_CAP + 5; i++) {
      putTurnOutline({
        project: P1,
        session: 's1',
        turn: `a${i}`,
        outline: { session: 'A', index: i },
        ts: baseTs + i,
      });
    }

    // Add some rows to session B (P1/s2) — fewer than the cap
    for (let i = 0; i < 5; i++) {
      putTurnOutline({
        project: P1,
        session: 's2',
        turn: `b${i}`,
        outline: { session: 'B', index: i },
        ts: baseTs + i,
      });
    }

    // Add rows to the same session name but different project (P2/s1)
    for (let i = 0; i < 3; i++) {
      putTurnOutline({
        project: P2,
        session: 's1',
        turn: `c${i}`,
        outline: { project: 'P2', index: i },
        ts: baseTs + i,
      });
    }

    // Session A should have exactly TURN_OUTLINE_RING_CAP rows (oldest 5 evicted)
    expect(countTurnOutlines(P1, 's1')).toBe(TURN_OUTLINE_RING_CAP);

    // Session B should still have all 5 rows (never touched by A's eviction)
    expect(countTurnOutlines(P1, 's2')).toBe(5);
    const bRows = listTurnOutlines(P1, 's2');
    for (let i = 0; i < 5; i++) {
      expect(bRows.map((r) => r.turn)).toContain(`b${i}`);
    }

    // P2/s1 should have all 3 rows (never touched by P1/s1's eviction)
    expect(countTurnOutlines(P2, 's1')).toBe(3);
    const p2Rows = listTurnOutlines(P2, 's1');
    for (let i = 0; i < 3; i++) {
      expect(p2Rows.map((r) => r.turn)).toContain(`c${i}`);
    }

    // Verify P1/s1 lost the 5 oldest
    const aRows = listTurnOutlines(P1, 's1');
    const aTurnIds = aRows.map((r) => r.turn);
    for (let i = 0; i < 5; i++) {
      expect(aTurnIds).not.toContain(`a${i}`);
    }
  });
});
