import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { listFrictionTool, DEFAULT_LIMIT } from '../tools/friction.js';
import { recordFriction, countFriction, _closeProject } from '../../services/friction-store.js';

/** Byte bound on the SERIALIZED no-args response. This guards AGENT-CONTEXT blowup —
 *  the live failure was a ~1.4 MB unpaginated list_friction response an agent could not
 *  hold in context — not row count. 100 rows at ~1 KB serialized leaves headroom;
 *  an unpaginated 1,900-row response is ~10x this bound. */
const MAX_DEFAULT_RESPONSE_BYTES = 200_000;

const TOTAL_ROWS = 1_900;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'list-friction-size-bound-'));
});

afterEach(() => {
  _closeProject(tmpDir);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('list_friction default response size bound', () => {
  it('no-args list_friction over a 1,900-note store stays under the response size bound and reports truncation', async () => {
    // One store-path write first: this creates .collab/friction.db and runs the DDL +
    // migrations — the test must never hand-create the schema.
    await recordFriction(tmpDir, {
      layer: 'operational',
      retryReason: 'seed-0',
      detail: 'seed note through the real write path',
    });

    // Bulk-seed the rest through ONE raw transaction (1,899 awaited recordFriction calls
    // would serialise behind the per-project write lock). Rows are representative, not
    // empty: varied layer/retryReason, ~300-char per-row detail, increasing createdAt so
    // the ORDER BY has real work. retractedAt stays NULL — retracted rows are invisible
    // to both list and count by default.
    const layers = ['orchestration', 'domain', 'operational'];
    const reasons = ['gate-format', 'wrong-test-cmd', 'base-red', 'stale-worktree'];
    const raw = new Database(join(tmpDir, '.collab', 'friction.db'));
    const insert = raw.prepare(
      `INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, signature, createdAt)
       VALUES (?, NULL, ?, 1, ?, ?, ?, NULL, ?)`,
    );
    const seedAll = raw.transaction(() => {
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      for (let i = 1; i < TOTAL_ROWS; i++) {
        insert.run(
          crypto.randomUUID(),
          `seed-session-${i % 7}`,
          layers[i % layers.length],
          reasons[i % reasons.length],
          `${i} a realistic retry narrative that pads the row toward live size ` + 'x'.repeat(300),
          new Date(base + i * 1000).toISOString(),
        );
      }
    });
    seedAll();
    raw.close();

    // Anti-vacuity control: the store really holds the rows (countFriction ignores
    // limit/offset, so a failed seed cannot sneak past the size bound trivially).
    expect(countFriction(tmpDir, {})).toBeGreaterThanOrEqual(TOTAL_ROWS);

    const result = listFrictionTool({ project: tmpDir });

    // Size bound on what an agent actually receives.
    const serialized = JSON.stringify(result, null, 2);
    expect(serialized.length).toBeLessThan(MAX_DEFAULT_RESPONSE_BYTES);

    // Truncated AND says so — by the named constant, so a silently-changed default is
    // caught by name rather than frozen as a literal.
    expect(result.count).toBe(DEFAULT_LIMIT);
    expect(result.limit).toBe(DEFAULT_LIMIT);
    expect(result.offset).toBe(0);
    expect(result.total).toBeGreaterThanOrEqual(TOTAL_ROWS);
    expect(result.hasMore).toBe(true);
  });
});
