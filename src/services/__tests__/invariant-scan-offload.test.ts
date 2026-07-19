import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, listTodos, listTodosChunked } from '../todo-store.ts';
import {
  assertClaimInvariants,
  assertClaimInvariantsAsync,
  findClaimInvariantViolations,
} from '../invariant-check.ts';
import { _setYieldToLoop } from '../loop-yield.ts';

/**
 * Phase 2 (mission c4eb4fcc) — the monolithic invariant scan is moved off the HTTP event
 * loop by CHUNKING the query-bound read (`listTodosChunked`: keyset pagination + a yield
 * between pages) on the SAME main-thread connection. These tests prove:
 *   (a) PARITY   — the chunked scan returns byte-identical violations to the inline scan
 *                  on a fixture DB seeded with KNOWN violations, at any page size.
 *   (b) FAIL-OPEN — a forced chunked-read error falls back to the inline scan (same
 *                  result), never breaking the assert pass.
 *   (c) YIELD    — the chunked read actually cedes the loop between pages.
 */

/** Seed a temp-project todos.db with a mix of clean rows + known violations. */
function seedFixture(rowCount = 5000): string {
  const proj = mkdtempSync(join(tmpdir(), 'inv-offload-'));
  const db = openDb(proj); // migration backfill runs HERE, before the seed below
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO todos
       (id, ownerSession, title, status, ord, dependsOn, createdAt, updatedAt, kind,
        acceptanceStatus, parentId, claimedBy, claimToken, claimedAt, claimLeaseMs)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < rowCount; i++) {
      insert.run(
        `clean-${String(i).padStart(6, '0')}`, 's1', `todo ${i}`,
        i % 5 === 0 ? 'done' : 'planned',
        i * 10 + 100000, now, now, 'leaf',
        i % 5 === 0 ? 'accepted' : null,
        null, null, null, null, null,
      );
    }
    // VIOLATION 1+2: a done row still holding a live claim → terminal-with-claim +
    // claim-implies-in-flight. (Inserted AFTER openDb's one-shot backfill, so it survives
    // on this connection — exactly the state the assert must surface.)
    insert.run(
      'done-claimed', 's1', 'stuck', 'done', 10, now, now, 'leaf',
      'accepted', null, 'w1', 'tok1', now, 60000,
    );
    // VIOLATION 3: a non-terminal epic whose only non-dropped child is done+accepted
    // → epic-rollup-missed.
    insert.run('epic1', 's1', 'epic', 'in_progress', 20, now, now, 'epic', null, null, null, null, null, null);
    insert.run('epic1-c1', 's1', 'child', 'done', 30, now, now, 'leaf', 'accepted', 'epic1', null, null, null, null);
  });
  tx();
  return proj;
}

afterEach(() => {
  _setYieldToLoop(null); // restore the real macrotask yield between tests
});

describe('invariant scan offload — chunked (Phase 2)', () => {
  test('PARITY: chunked read === inline listTodos, and same violations (page < N)', async () => {
    const proj = seedFixture(5000);

    const inlineRows = listTodos(proj, { includeCompleted: true });
    const chunkedRows = await listTodosChunked(proj, { includeCompleted: true }, { pageSize: 500 });

    // Byte-identical row set + order (unique ords → (ord) and (ord,id) agree).
    expect(chunkedRows).toEqual(inlineRows);

    const inlineViol = findClaimInvariantViolations(inlineRows);
    const chunkedViol = findClaimInvariantViolations(chunkedRows);
    expect(chunkedViol).toEqual(inlineViol);

    // Sanity: the fixture really carries all three planted violations.
    const kinds = chunkedViol.map((v) => v.kind).sort();
    expect(kinds).toContain('terminal-with-claim');
    expect(kinds).toContain('claim-implies-in-flight');
    expect(kinds).toContain('epic-rollup-missed');
  });

  test('PARITY: assertClaimInvariantsAsync (chunked) === assertClaimInvariants (inline)', async () => {
    const proj = seedFixture(3000);
    const sync = assertClaimInvariants(proj);
    const async_ = await assertClaimInvariantsAsync(proj);
    expect(async_).toEqual(sync);
    expect(async_.length).toBeGreaterThan(0);
  });

  test('PARITY holds across page sizes incl. exact multiples and page=1', async () => {
    const proj = seedFixture(103);
    const inline = listTodos(proj, { includeCompleted: true });
    for (const pageSize of [1, 2, 51, 103, 200, 10_000]) {
      const chunked = await listTodosChunked(proj, { includeCompleted: true }, { pageSize });
      expect(chunked).toEqual(inline);
    }
  });

  test('chunked read cedes the loop between pages (yieldFn called per page)', async () => {
    const proj = seedFixture(1000);
    let yields = 0;
    const rows = await listTodosChunked(proj, { includeCompleted: true }, {
      pageSize: 250,
      yieldFn: async () => { yields++; },
    });
    expect(rows.length).toBe(1003);
    // 1003 rows / 250 = pages at 250,500,750,1000 then a final 3-row page; a yield fires
    // after every FULL page (not the short last one) → 4 yields.
    expect(yields).toBeGreaterThanOrEqual(3);
  });

  test('FAIL-OPEN: a chunked-read error mid-scan falls back to the inline scan (same result)', async () => {
    // > default pageSize (2000) so the scan actually hits a page boundary → yieldToLoop
    // is invoked → our poisoned yield throws → assertClaimInvariantsAsync must catch and
    // re-scan inline, returning the byte-identical violations rather than breaking.
    const proj = seedFixture(3000);
    const expected = assertClaimInvariants(proj); // inline reference (real single-shot)

    _setYieldToLoop(async () => {
      throw new Error('forced yield failure (simulated event-loop cede error)');
    });

    const got = await assertClaimInvariantsAsync(proj); // must NOT throw
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(0);
  });

  test('steady-state: a clean fixture yields [] (no false alarms)', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'inv-clean-'));
    const db = openDb(proj);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO todos (id, ownerSession, title, status, ord, dependsOn, createdAt, updatedAt, kind, acceptanceStatus)
       VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    ).run('clean1', 's1', 't', 'planned', 10, now, now, 'leaf', null);

    expect(await assertClaimInvariantsAsync(proj)).toEqual([]);
  });
});
