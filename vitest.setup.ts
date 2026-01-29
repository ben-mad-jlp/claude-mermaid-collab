import { vi } from 'vitest';

// Mock external packages that might not be available
vi.mock('mermaid-wireframe', () => ({
  default: {},
}));

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
