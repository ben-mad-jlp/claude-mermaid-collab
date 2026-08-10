/**
 * Migration must be safe on a machine nobody is watching.
 *
 * Databases do not travel with the repo, so every machine that pulls runs these migrations
 * against its own old data, unattended. The three properties that make that survivable — ordered
 * and idempotent, all-or-nothing per migration, and a flat refusal to open a database newer than
 * the code — are pinned here. The third matters most in a multi-machine setup: an older build
 * writing old-shaped rows into a newer database corrupts it silently and is only discovered on a
 * later read.
 */
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  applyMigrations, currentSchemaVersion, schemaHistory, SchemaTooNewError, type Migration,
} from '../schema-migrate';

const OPTS = { storeName: 'test-store', now: () => 1_700_000_000_000 };

function mem(): Database { return new Database(':memory:'); }

const M1: Migration = {
  version: 1, name: 'create-widget',
  up: (db) => db.exec('CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)'),
};
const M2: Migration = {
  version: 2, name: 'add-widget-colour',
  up: (db) => db.exec('ALTER TABLE widget ADD COLUMN colour TEXT'),
};

describe('applyMigrations', () => {
  it('applies in order from an empty database and records each one', () => {
    const db = mem();
    const r = applyMigrations(db, [M1, M2], OPTS);
    expect(r.from).toBe(0);
    expect(r.to).toBe(2);
    expect(r.applied.map((a) => a.name)).toEqual(['create-widget', 'add-widget-colour']);
    expect(schemaHistory(db).map((h) => h.version)).toEqual([1, 2]);
  });

  it('is idempotent — a second call applies nothing', () => {
    const db = mem();
    applyMigrations(db, [M1, M2], OPTS);
    const again = applyMigrations(db, [M1, M2], OPTS);
    expect(again.applied).toEqual([]);
    expect(again.from).toBe(2);
    expect(again.to).toBe(2);
  });

  it('applies only the NEW migration when the code gains one', () => {
    const db = mem();
    applyMigrations(db, [M1], OPTS);
    const r = applyMigrations(db, [M1, M2], OPTS);
    expect(r.applied.map((a) => a.version)).toEqual([2]); // M1 not re-run
  });

  it('REFUSES a database newer than the code', () => {
    const db = mem();
    applyMigrations(db, [M1, M2], OPTS);
    // Simulate this machine running an older build that only knows about v1.
    expect(() => applyMigrations(db, [M1], OPTS)).toThrow(SchemaTooNewError);
    try { applyMigrations(db, [M1], OPTS); } catch (e) {
      expect((e as Error).message).toContain('schema version 2');
      expect((e as Error).message).toContain('only understands 1');
    }
  });

  it('leaves the database at N-1 when a migration throws — never in between', () => {
    const db = mem();
    const bad: Migration = {
      version: 2, name: 'half-applied',
      up: (d) => {
        d.exec('CREATE TABLE partial (id INTEGER)'); // succeeds
        throw new Error('boom');                     // then fails
      },
    };
    applyMigrations(db, [M1], OPTS);
    expect(() => applyMigrations(db, [M1, bad], OPTS)).toThrow('boom');

    // Version did not advance...
    expect(currentSchemaVersion(db)).toBe(1);
    // ...and the partial work was rolled back with it. A crash mid-upgrade (this daemon is
    // SIGKILLed regularly) must not leave a database that looks migrated but is not.
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain('partial');
  });

  it('a later migration still applies after an earlier failure is fixed', () => {
    const db = mem();
    applyMigrations(db, [M1], OPTS);
    try { applyMigrations(db, [M1, { version: 2, name: 'bad', up: () => { throw new Error('x'); } }], OPTS); }
    catch { /* expected */ }
    const r = applyMigrations(db, [M1, M2], OPTS); // fixed v2 ships
    expect(r.applied.map((a) => a.version)).toEqual([2]);
    expect(currentSchemaVersion(db)).toBe(2);
  });

  it('records who applied it, so a bad upgrade is attributable', () => {
    const db = mem();
    applyMigrations(db, [M1], { ...OPTS, appliedBy: 'build-6.21.14' });
    const row = db.query('SELECT appliedBy, appliedAt FROM schema_meta WHERE version=1').get() as
      { appliedBy: string; appliedAt: number };
    expect(row.appliedBy).toBe('build-6.21.14');
    expect(row.appliedAt).toBe(1_700_000_000_000);
  });
});

describe('migration list validation (programming errors surface at startup)', () => {
  it('rejects duplicate versions', () => {
    expect(() => applyMigrations(mem(), [M1, { ...M2, version: 1 }], OPTS))
      .toThrow(/duplicate migration version 1/);
  });

  it('rejects out-of-order versions', () => {
    // Renumbering a shipped migration is how one machine silently skips it.
    expect(() => applyMigrations(mem(), [M2, M1], OPTS)).toThrow(/out of order/);
  });

  it('rejects a non-positive version', () => {
    expect(() => applyMigrations(mem(), [{ ...M1, version: 0 }], OPTS)).toThrow(/non-positive/);
  });

  it('an empty list is a no-op, not an error', () => {
    const db = mem();
    expect(applyMigrations(db, [], OPTS)).toEqual({ from: 0, to: 0, applied: [] });
  });
});
