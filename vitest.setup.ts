import { vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// GLOBAL TEST ISOLATION (stops the live app's Projects list being polluted by tests).
// Redirect ALL ~/.mermaid-collab state — projects.json + sessions.json (MERMAID_DATA_DIR)
// and the supervisor/ledger SQLite stores (MERMAID_SUPERVISOR_DIR) — to a throwaway temp
// dir BEFORE any src module reads its DATA_DIR const. setupFiles run before the test
// file's imports, so the registries pick up the temp dir. Only set when unset so a test
// that needs its own dir still wins.
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-test-data-'));
process.env.MERMAID_DATA_DIR ??= TEST_DATA_DIR;
process.env.MERMAID_SUPERVISOR_DIR ??= TEST_DATA_DIR;
// config.json / tech-packs.json honor their own *file*-path overrides; point them
// into the same throwaway dir so a test mutating either can't write to ~/.mermaid-collab.
process.env.MERMAID_CONFIG_PATH ??= join(TEST_DATA_DIR, 'config.json');
process.env.MERMAID_TECH_PACKS_PATH ??= join(TEST_DATA_DIR, 'tech-packs.json');

// Mock external packages that might not be available
vi.mock('mermaid', () => ({
  default: {},
}));

// Mock bun:sqlite with better-sqlite3 wrapper
vi.mock('bun:sqlite', () => {
  const BetterSqlite3 = require('better-sqlite3');

  // Create a wrapper class that adapts better-sqlite3 to match bun:sqlite API
  class DatabaseWrapper {
    private db: any;

    constructor(filepath: string) {
      this.db = new BetterSqlite3(filepath);
    }

    query(sql: string) {
      const stmt = this.db.prepare(sql);
      return {
        get: (...params: any[]) => stmt.get(...params),
        all: (...params: any[]) => stmt.all(...params),
        run: (...params: any[]) => stmt.run(...params),
      };
    }

    prepare(sql: string) {
      return this.db.prepare(sql);
    }

    transaction(fn: (...args: any[]) => any) {
      return this.db.transaction(fn);
    }

    run(sql: string, ...params: any[]) {
      return this.db.prepare(sql).run(...params);
    }

    exec(sql: string) {
      return this.db.exec(sql);
    }

    close() {
      return this.db.close();
    }
  }

  return { default: DatabaseWrapper };
});
