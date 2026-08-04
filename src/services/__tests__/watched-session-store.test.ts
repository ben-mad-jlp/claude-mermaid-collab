import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

describe('watched-session-store migrations', () => {
  it('creates watched_session with no source column and no supervised_session table', () => {
    // Fresh store: set env to an isolated temp directory, then import/call store functions.
    const testDir = mkdtempSync(join(tmpdir(), 'mc-watched-session-fresh-'));
    process.env.MERMAID_SUPERVISOR_DIR = testDir;

    // Import (or re-import) the store module — openDb() will use testDir.
    // Since openDb() caches the DB connection, we must use a fresh env per test.
    // This test resets the env and re-requires the module.
    delete require.cache[require.resolve('../supervisor-store')];
    const { addWatchedSession } = require('../supervisor-store');

    // Call addWatchedSession to trigger openDb() with the fresh DB.
    addWatchedSession('test-project', 'test-session');

    // Verify the schema by querying the store's own DB file directly.
    const dbPath = join(testDir, 'supervisor.db');
    const verifyDb = new Database(dbPath);

    // Verify watched_session table exists with the correct columns.
    const tableInfo = verifyDb.query('PRAGMA table_info(watched_session)').all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((c) => c.name);
    expect(columnNames).toContain('project');
    expect(columnNames).toContain('session');
    expect(columnNames).toContain('addedAt');
    expect(columnNames).toContain('serverId');
    expect(columnNames).not.toContain('source');

    // Verify supervised_session table does NOT exist.
    const oldTableExists = verifyDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='supervised_session'")
      .get();
    expect(oldTableExists).toBeFalsy();
    verifyDb.close();
  });

  it('migrates existing supervised_session rows into watched_session on open', () => {
    // Legacy migration: prepare a legacy DB with the old schema, then open it via the store.
    const testDir = mkdtempSync(join(tmpdir(), 'mc-watched-session-legacy-'));

    // Create the legacy DB file in a temp location.
    const legacyDbPath = join(testDir, 'supervisor-old.db');
    const legacyDb = new Database(legacyDbPath);

    // Create the OLD supervised_session schema (with source and launchProject).
    legacyDb.exec(`
      CREATE TABLE supervised_session (
        project TEXT NOT NULL,
        session TEXT NOT NULL,
        source TEXT NOT NULL,
        addedAt INTEGER NOT NULL,
        serverId TEXT NOT NULL DEFAULT '',
        launchProject TEXT,
        PRIMARY KEY (project, session)
      )
    `);

    // Insert 2 test rows with source='manual'.
    const now = Date.now();
    legacyDb.prepare('INSERT INTO supervised_session (project, session, source, addedAt, serverId) VALUES (?,?,?,?,?)')
      .run('proj1', 'sess1', 'manual', now, '');
    legacyDb.prepare('INSERT INTO supervised_session (project, session, source, addedAt, serverId) VALUES (?,?,?,?,?)')
      .run('proj2', 'sess2', 'manual', now + 1000, 'server1');

    legacyDb.close();

    // Move the legacy DB to the location where the store will open it.
    const storeDbPath = join(testDir, 'supervisor.db');
    renameSync(legacyDbPath, storeDbPath);

    // Now set env and import/call the store — openDb() will open the legacy DB and run the migration.
    process.env.MERMAID_SUPERVISOR_DIR = testDir;
    delete require.cache[require.resolve('../supervisor-store')];
    const { listWatchedSessions } = require('../supervisor-store');

    // Call listWatchedSessions() — this triggers openDb() which runs the migration.
    const sessions = listWatchedSessions();

    // Verify both rows were migrated with project/session/addedAt/serverId preserved.
    expect(sessions.length).toBe(2);
    expect(sessions[0]).toEqual({
      project: 'proj1',
      session: 'sess1',
      addedAt: now,
      serverId: ''
    });
    expect(sessions[1]).toEqual({
      project: 'proj2',
      session: 'sess2',
      addedAt: now + 1000,
      serverId: 'server1'
    });

    // Verify the old table no longer exists by checking the DB directly.
    const verifyDb = new Database(storeDbPath);
    const oldTableExists = verifyDb
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='supervised_session'")
      .get();
    expect(oldTableExists).toBeFalsy();
    verifyDb.close();
  });
});
