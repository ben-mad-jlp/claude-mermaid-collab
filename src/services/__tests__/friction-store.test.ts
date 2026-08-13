// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordFriction, listFriction, countFriction, _closeProject, getWatchState, setWatchState } from '../friction-store';
import Database from 'bun:sqlite';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'friction-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('friction-store', () => {
  it('records a note and returns the stored shape', async () => {
    const note = await recordFriction(project, {
      todoId: 't1', session: 'general-1', attempt: 2,
      layer: 'domain', retryReason: 'cad-api-rederived', detail: 'no @mcp.tool for fitness',
    });
    expect(typeof note.id).toBe('string');
    expect(note.todoId).toBe('t1');
    expect(note.session).toBe('general-1');
    expect(note.attempt).toBe(2);
    expect(note.layer).toBe('domain');
    expect(note.retryReason).toBe('cad-api-rederived');
    expect(note.detail).toBe('no @mcp.tool for fitness');
    expect(typeof note.createdAt).toBe('string');
  });

  it('defaults attempt to 1 and detail/session to null', async () => {
    const note = await recordFriction(project, { todoId: 't2', layer: 'orchestration', retryReason: 'gate-format' });
    expect(note.attempt).toBe(1);
    expect(note.detail).toBeNull();
    expect(note.session).toBeNull();
  });

  it('rejects an invalid layer and missing required fields', async () => {
    // @ts-expect-error — invalid layer at the type level too
    await expect(recordFriction(project, { todoId: 't', layer: 'bogus', retryReason: 'x' })).rejects.toThrow('layer must be one of');
    await expect(recordFriction(project, { todoId: 't', layer: 'domain', retryReason: '' })).rejects.toThrow('retryReason is required');
  });

  it('records with no todoId (operational note) — stores null and round-trips', async () => {
    const note = await recordFriction(project, { layer: 'operational', retryReason: 'stale-shadow-server', detail: 'plugin hook started old binary' });
    expect(note.todoId).toBeNull();
    expect(note.layer).toBe('operational');
    expect(note.retryReason).toBe('stale-shadow-server');
    // round-trip via list
    const all = listFriction(project);
    expect(all[0].todoId).toBeNull();
  });

  it('accepts operational layer and filters by it', async () => {
    await recordFriction(project, { layer: 'operational', retryReason: 'nudge-not-delivered' });
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    const operational = listFriction(project, { layer: 'operational' });
    expect(operational.length).toBe(1);
    expect(operational[0].retryReason).toBe('nudge-not-delivered');
  });

  it('answers "which todos hit DOMAIN-layer friction and why" via the layer filter', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'cad-api-rederived' });
    await recordFriction(project, { todoId: 't2', layer: 'orchestration', retryReason: 'wrong-test-cmd' });
    await recordFriction(project, { todoId: 't3', layer: 'domain', retryReason: 'missing-domain-model' });

    const domain = listFriction(project, { layer: 'domain' });
    expect(domain.map((n) => n.todoId).sort()).toEqual(['t1', 't3']);
    expect(domain.map((n) => n.retryReason).sort()).toEqual(['cad-api-rederived', 'missing-domain-model']);

    const orchestration = listFriction(project, { layer: 'orchestration' });
    expect(orchestration.map((n) => n.todoId)).toEqual(['t2']);
  });

  it('filters by todoId and by session; unfiltered returns all newest-first', async () => {
    await recordFriction(project, { todoId: 't1', session: 's1', layer: 'domain', retryReason: 'a' });
    await recordFriction(project, { todoId: 't1', session: 's2', layer: 'orchestration', retryReason: 'b' });
    await recordFriction(project, { todoId: 't2', session: 's1', layer: 'domain', retryReason: 'c' });

    expect(listFriction(project, { todoId: 't1' }).length).toBe(2);
    expect(listFriction(project, { session: 's1' }).map((n) => n.retryReason).sort()).toEqual(['a', 'c']);
    expect(listFriction(project).length).toBe(3);
    // newest-first: 'c' (last inserted) leads
    expect(listFriction(project)[0].retryReason).toBe('c');
  });

  it('persists across a reopen (survives a closed handle)', async () => {
    await recordFriction(project, { todoId: 't1', layer: 'domain', retryReason: 'persisted' });
    _closeProject(project); // drop the cached handle → next call reopens the DB file
    const notes = listFriction(project, { todoId: 't1' });
    expect(notes.length).toBe(1);
    expect(notes[0].retryReason).toBe('persisted');
  });
});

describe('friction-store watch-state KV', () => {
  it('returns null for an unset key', () => {
    expect(getWatchState(project, 'watch:unset')).toBeNull();
  });

  it('round-trips a set value', async () => {
    await setWatchState(project, 'watch:unlanded-threshold', 'over');
    expect(getWatchState(project, 'watch:unlanded-threshold')).toBe('over');
  });

  it('upserts (second set overwrites, no duplicate row)', async () => {
    const key = 'watch:stale-wt:/tmp/wt-a';
    await setWatchState(project, key, 'branch-gone');
    await setWatchState(project, key, 'stale');
    expect(getWatchState(project, key)).toBe('stale');
  });

  it('keeps distinct keys independent', async () => {
    await setWatchState(project, 'watch:a', 'x');
    await setWatchState(project, 'watch:b', 'y');
    expect(getWatchState(project, 'watch:a')).toBe('x');
    expect(getWatchState(project, 'watch:b')).toBe('y');
  });

  it('persists across a reopened handle', async () => {
    await setWatchState(project, 'watch:persist', 'over');
    _closeProject(project); // drop cached handle → reopen DB file
    expect(getWatchState(project, 'watch:persist')).toBe('over');
  });
});

describe('friction-store pagination and filtering', () => {
  // Seed ~30 notes with mixed layers, retryReasons, and explicit createdAt values.
  // Each note has a createdAt offset to allow deterministic since/limit testing.
  async function seedMixedNotes() {
    // First call recordFriction to initialize the schema and migrations
    await recordFriction(project, { layer: 'domain', retryReason: 'seed-init' });
    _closeProject(project); // Close and reopen to get a fresh handle for direct SQL

    // Open the DB directly and insert notes with controlled createdAt timestamps
    const dbPath = join(project, '.collab', 'friction.db');
    const db = new Database(dbPath);
    const baseTime = new Date('2025-01-01T00:00:00Z').toISOString();

    const reasons = ['reason-a', 'reason-b', 'reason-c'];
    const layers: Array<'orchestration' | 'domain' | 'operational'> = ['orchestration', 'domain', 'operational'];

    // Insert 30 notes with predictable structure: 10 per reason, cycling through layers
    for (let i = 0; i < 30; i++) {
      const reason = reasons[i % 3];
      const layer = layers[i % 3];
      const createdAt = new Date(new Date(baseTime).getTime() + i * 1000).toISOString(); // 1s apart
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, createdAt, retractedAt, retractedReason, supersededBy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
      ).run(id, `todo-${i}`, `session-${i % 5}`, 1, layer, reason, `detail-${i}`, createdAt);
    }
    db.close();
  }

  it('limit truncates to exactly N newest-first', async () => {
    await seedMixedNotes();
    const all = listFriction(project);
    expect(all.length).toBe(31); // 30 seeded + 1 from init

    const limited = listFriction(project, { limit: 5 });
    expect(limited.length).toBe(5);
    // Newest-first: seed-init has current timestamp, so it's newest; then detail-29, detail-28, ...
    expect(limited[0].retryReason).toBe('seed-init');
    expect(limited[1].detail).toBe('detail-29');
    expect(limited[5]).toBeUndefined();
  });

  it('offset+limit pages the full set without overlap or gap', async () => {
    await seedMixedNotes();
    const pageSize = 10;
    const allPages = [];
    for (let p = 0; p < 4; p++) {
      const page = listFriction(project, { limit: pageSize, offset: p * pageSize });
      allPages.push(...page);
    }

    // Should cover at least 30 seeded + 1 init
    expect(allPages.length).toBeGreaterThanOrEqual(31);

    // Check no duplicates by id
    const ids = new Set(allPages.map((n) => n.id));
    expect(ids.size).toBe(allPages.length);

    // Verify ordering: first page should be newest-first (seed-init is newest)
    const firstPage = listFriction(project, { limit: pageSize });
    expect(firstPage[0].retryReason).toBe('seed-init');
  });

  it('since excludes rows older than the inclusive boundary', async () => {
    await seedMixedNotes();
    const baseTime = new Date('2025-01-01T00:00:00Z').toISOString();
    const boundary = new Date(new Date(baseTime).getTime() + 15 * 1000).toISOString(); // After row 14

    const sinceBoundary = listFriction(project, { since: boundary });
    // Rows 15-29 (seeded) + init row should match (init has later timestamp)
    // Verify that no row has createdAt < boundary
    for (const note of sinceBoundary) {
      if (note.retryReason !== 'seed-init') {
        expect(note.createdAt >= boundary).toBe(true);
      }
    }
  });

  it('retryReason filters exactly', async () => {
    await seedMixedNotes();
    const reasonA = listFriction(project, { retryReason: 'reason-a' });
    const reasonB = listFriction(project, { retryReason: 'reason-b' });
    const reasonC = listFriction(project, { retryReason: 'reason-c' });

    // Each reason appears ~10 times in the seeded 30 rows (indices 0, 3, 6, ...)
    expect(reasonA.filter((n) => n.retryReason === 'reason-a').length).toBe(10);
    expect(reasonB.filter((n) => n.retryReason === 'reason-b').length).toBe(10);
    expect(reasonC.filter((n) => n.retryReason === 'reason-c').length).toBe(10);

    // All returned rows match the filter
    for (const note of reasonA) {
      expect(note.retryReason).toBe('reason-a');
    }
  });

  it('limit/since/retryReason compose with layer', async () => {
    await seedMixedNotes();
    const baseTime = new Date('2025-01-01T00:00:00Z').toISOString();
    const boundary = new Date(new Date(baseTime).getTime() + 10 * 1000).toISOString();

    const composed = listFriction(project, {
      layer: 'domain',
      retryReason: 'reason-a',
      since: boundary,
      limit: 5,
    });

    // All results should match all predicates
    for (const note of composed) {
      expect(note.layer).toBe('domain');
      expect(note.retryReason).toBe('reason-a');
      expect(note.createdAt >= boundary).toBe(true);
    }
    expect(composed.length).toBeLessThanOrEqual(5);
  });

  it('countFriction returns the unlimited matching total while listFriction with the same filter plus limit returns fewer', async () => {
    await seedMixedNotes();
    const filter = { layer: 'orchestration' as const };

    const count = countFriction(project, filter);
    const limited = listFriction(project, { ...filter, limit: 5 });

    expect(count).toBeGreaterThan(limited.length);
    expect(limited.length).toBe(5);
  });

  it('listFriction with no limit still returns every matching row', async () => {
    await seedMixedNotes();
    const all = listFriction(project);
    expect(all.length).toBeGreaterThan(20); // Should have all ~31 rows

    // Verify that countFriction matches (no unbounded default limit applied)
    const count = countFriction(project, {});
    expect(all.length).toBe(count);
  });

  it('offset without limit emits LIMIT -1 OFFSET ? and returns remaining rows', async () => {
    await seedMixedNotes();
    const all = listFriction(project);
    const withoutOffset = all.length;

    const offsetOnly = listFriction(project, { offset: 10 });
    expect(offsetOnly.length).toBe(withoutOffset - 10);

    // Verify ordering is preserved (newest-first) — ISO strings compare lexicographically
    expect(offsetOnly[0].createdAt >= all[10].createdAt).toBe(true);
  });

  it('retryReason and layer filter compose correctly', async () => {
    await seedMixedNotes();
    const domainA = listFriction(project, { layer: 'domain', retryReason: 'reason-a' });

    for (const note of domainA) {
      expect(note.layer).toBe('domain');
      expect(note.retryReason).toBe('reason-a');
    }

    const countDA = countFriction(project, { layer: 'domain', retryReason: 'reason-a' });
    expect(domainA.filter((n) => !n.retractedAt).length).toBe(countDA);
  });
});
