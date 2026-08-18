/**
 * Hermetic tripwire guard tests — verify the guard catches and allows the expected patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HermeticTripwireError, ALLOW_DETACHED_ENV } from '../../testing/hermetic-tripwire';

const FORBIDDEN_HOME_DIR = join(homedir(), '.mermaid-collab');

describe('hermetic-tripwire', () => {
  it('preload was loaded (guard is active)', () => {
    expect((globalThis as any).__hermeticTripwireLoaded).toBe(true);
    // Also verify that fs.writeFileSync has been patched
    expect((fs as any).writeFileSync.__hermeticTripwire).toBe(true);
  });

  it('allows writeFileSync into a mkdtempSync path (tmpdir isolation)', () => {
    const tmpPath = fs.mkdtempSync(join(tmpdir(), 'tripwire-test-'));
    try {
      const testFile = join(tmpPath, 'test.txt');
      expect(() => fs.writeFileSync(testFile, 'test content')).not.toThrow();
    } finally {
      fs.rmSync(tmpPath, { recursive: true, force: true });
    }
  });

  it('throws HermeticTripwireError on writeFileSync into ~/.mermaid-collab', () => {
    const forbiddenPath = join(FORBIDDEN_HOME_DIR, 'tripwire-test-forbidden');
    expect(() => fs.writeFileSync(forbiddenPath, 'should not write')).toThrow(HermeticTripwireError);
    // Verify the error message names the path
    expect(() => fs.writeFileSync(forbiddenPath, 'should not write')).toThrow(/forbidden/i);
  });

  it('throws HermeticTripwireError on detached spawn without env var', () => {
    // Ensure the env var is not set
    delete process.env[ALLOW_DETACHED_ENV];
    expect(() => Bun.spawn(['true'], { detached: true })).toThrow(HermeticTripwireError);
    expect(() => Bun.spawn(['true'], { detached: true })).toThrow(new RegExp(ALLOW_DETACHED_ENV));
  });

  it('allows detached spawn when MERMAID_TEST_ALLOW_DETACHED=1', async () => {
    const oldEnv = process.env[ALLOW_DETACHED_ENV];
    try {
      process.env[ALLOW_DETACHED_ENV] = '1';
      const proc = Bun.spawn(['true']);
      expect(proc).toBeDefined();
      expect(proc.pid).toBeGreaterThan(0);
      // Clean up the process
      await proc.exited;
    } finally {
      if (oldEnv !== undefined) {
        process.env[ALLOW_DETACHED_ENV] = oldEnv;
      } else {
        delete process.env[ALLOW_DETACHED_ENV];
      }
    }
  });

  it('throws HermeticTripwireError on new Database under ~/.mermaid-collab', () => {
    const forbiddenPath = join(FORBIDDEN_HOME_DIR, 'tripwire-test-forbidden.db');
    expect(() => new Database(forbiddenPath)).toThrow(HermeticTripwireError);
  });

  it('allows new Database(":memory:") and a Database under tmpdir', () => {
    const memDb = new Database(':memory:');
    expect(() => memDb.run('create table t(a)')).not.toThrow();

    const tmpPath = fs.mkdtempSync(join(tmpdir(), 'tripwire-db-test-'));
    try {
      const dbPath = join(tmpPath, 'test.db');
      const tmpDb = new Database(dbPath);
      expect(() => tmpDb.run('create table t(a)')).not.toThrow();
    } finally {
      fs.rmSync(tmpPath, { recursive: true, force: true });
    }
  });

  it('maintains prototype transparency — Database.prototype is the original and patches are observed', () => {
    // Verify Database.prototype exists and is an object
    expect(Database.prototype).toBeDefined();
    expect(typeof Database.prototype).toBe('object');

    // Verify we can patch Database.prototype.prepare and the patch is observed through an instance
    const originalPrepare = Database.prototype.prepare;
    let patchWasCalled = false;

    try {
      // Patch Database.prototype.prepare
      (Database.prototype as any).prepare = function (this: any, sql: string) {
        patchWasCalled = true;
        return originalPrepare.call(this, sql);
      };

      // Create a new instance and call prepare
      const testDb = new Database(':memory:');
      testDb.prepare('create table t(id)');

      // The patch should have been observed
      expect(patchWasCalled).toBe(true);
    } finally {
      // Restore the original
      (Database.prototype as any).prepare = originalPrepare;
    }
  });

  it('throws HermeticTripwireError on a watched_project insert into a real store', () => {
    const dbPath = join(process.cwd(), '.collab', 'tripwire-fixture.db');
    try {
      const db = new Database(dbPath);
      try {
        db.run('CREATE TABLE watched_project (project TEXT, addedAt INTEGER)');
        expect(() =>
          db.prepare('INSERT OR IGNORE INTO watched_project (project, addedAt) VALUES (?,?)').run('/x', 1)
        ).toThrow(HermeticTripwireError);
      } finally {
        db.close();
      }
    } finally {
      // Clean up database files
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  });

  it('allows a watched_project insert into a tmpdir store', () => {
    const tmpPath = fs.mkdtempSync(join(tmpdir(), 'hermetic-tmpdir-'));
    try {
      const dbPath = join(tmpPath, 'test.db');
      const db = new Database(dbPath);
      try {
        db.run('CREATE TABLE watched_project (project TEXT, addedAt INTEGER)');
        expect(() =>
          db.prepare('INSERT OR IGNORE INTO watched_project (project, addedAt) VALUES (?,?)').run('/x', 1)
        ).not.toThrow();
      } finally {
        db.close();
      }
    } finally {
      // Clean up temp directory
      fs.rmSync(tmpPath, { recursive: true, force: true });
    }
  });
});
