import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import Database from 'bun:sqlite';
import { promises as fs } from 'node:fs';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { migrateAllRegisteredProjects } from '../todo-store.ts';
import { ProjectRegistry } from '../project-registry.ts';

describe('kind-migration-eager: eager migration of registered projects', () => {
  let tmpDir: string;
  let goodPath: string;
  let badPath: string;
  let noDBPath: string;
  let registryPath: string;
  let registry: ProjectRegistry;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'kindmig-'));
    goodPath = join(tmpDir, 'good');
    badPath = join(tmpDir, 'bad');
    noDBPath = join(tmpDir, 'nodb');

    // Create project directories
    await fs.mkdir(join(goodPath, '.collab'), { recursive: true });
    await fs.mkdir(join(badPath, '.collab'), { recursive: true });
    await fs.mkdir(join(noDBPath, '.collab'), { recursive: true });

    // good/.collab/todos.db: create an OLD-schema table with no `kind` column
    const goodDb = new Database(join(goodPath, '.collab', 'todos.db'));
    goodDb.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        ownerSession TEXT NOT NULL,
        assigneeSession TEXT,
        assigneeKind TEXT NOT NULL DEFAULT 'agent',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER,
        dueDate TEXT,
        parentId TEXT,
        dependsOn TEXT NOT NULL DEFAULT '[]',
        ord REAL NOT NULL,
        link TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        asanaGid TEXT,
        sessionName TEXT,
        executedBySession TEXT,
        blueprintId TEXT,
        type TEXT,
        targetProject TEXT,
        acceptanceStatus TEXT,
        claimedBy TEXT,
        claimToken TEXT,
        claimedAt TEXT,
        claimLeaseMs INTEGER,
        retryCount INTEGER NOT NULL DEFAULT 0,
        completedBy TEXT,
        objectRef TEXT,
        decisionRef TEXT,
        claimProbe TEXT,
        inheritedBlueprintFrom TEXT,
        inheritedFiles TEXT
      )
    `);
    goodDb.prepare(`
      INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('inbox-id', 'owner-session', '[EPIC] Inbox', 'todo', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    goodDb.close();

    // bad/.collab/todos.db: corrupt file that will throw on open
    writeFileSync(join(badPath, '.collab', 'todos.db'), 'this is not a database');

    // noDB path has no todos.db file

    // Create registry with bad project listed FIRST (newer lastAccess)
    // to test that failure doesn't abort iteration
    const registryData = {
      projects: [
        { path: badPath, name: 'bad', lastAccess: '2026-07-11T00:00:00Z' },
        { path: goodPath, name: 'good', lastAccess: '2026-07-10T00:00:00Z' },
        { path: noDBPath, name: 'nodb', lastAccess: '2026-07-09T00:00:00Z' },
      ],
    };
    registryPath = join(tmpDir, 'projects.json');
    await fs.writeFile(registryPath, JSON.stringify(registryData, null, 2));
    registry = new ProjectRegistry(registryPath);
  });

  afterAll(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates a project with old-schema todos.db and strips title prefix', async () => {
    const results = await migrateAllRegisteredProjects(registry);

    // Verify good project succeeded
    const goodResult = results.find((r) => r.project === goodPath);
    expect(goodResult).toBeDefined();
    expect(goodResult?.ok).toBe(true);
    expect(goodResult?.error).toBeUndefined();

    // Verify kind column was added and backfilled
    const db = new Database(join(goodPath, '.collab', 'todos.db'));
    const cols = db.query(`PRAGMA table_info(todos)`).all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'kind')).toBe(true);

    // Verify the row's kind was set to 'epic' and title was stripped
    const row = db.query(`SELECT kind, title FROM todos WHERE id = 'inbox-id'`).get() as {
      kind: string;
      title: string;
    };
    expect(row.kind).toBe('epic');
    expect(row.title).toBe('Inbox');

    db.close();
  });

  it('fault-isolates failures: bad DB does not abort iteration', async () => {
    const results = await migrateAllRegisteredProjects(registry);

    // Bad project should fail
    const badResult = results.find((r) => r.project === badPath);
    expect(badResult).toBeDefined();
    expect(badResult?.ok).toBe(false);
    expect(badResult?.error).toBeDefined();
    expect(badResult!.error!.length).toBeGreaterThan(0);

    // Good project should still have succeeded
    const goodResult = results.find((r) => r.project === goodPath);
    expect(goodResult?.ok).toBe(true);
  });

  it('skips projects with no todos.db and never creates one', async () => {
    const results = await migrateAllRegisteredProjects(registry);

    // Projects with no DB should not appear in results (migrateProjectKinds returns false)
    const nodbResults = results.filter((r) => r.project === noDBPath);
    expect(nodbResults.length).toBe(0);

    // Verify no DB was created
    expect(existsSync(join(noDBPath, '.collab', 'todos.db'))).toBe(false);
  });
});
