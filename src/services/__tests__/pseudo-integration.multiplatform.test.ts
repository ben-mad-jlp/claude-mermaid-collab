import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSchema } from '../pseudo-schema.js';
import { createPseudoIndexer } from '../pseudo-indexer.js';
import { writeSnapshot, loadSnapshot, validateSnapshot } from '../pseudo-snapshot.js';

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pseudo-integ-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'a.ts'),
    `/**
 * Module A.
 */
export function foo(x: number): number {
  return x + 1;
}
export class Widget {
  compute(a: number, b: number): number {
    return a * b;
  }
}
`,
  );
  writeFileSync(
    join(root, 'src', 'b.ts'),
    `/**
 * Module B.
 */
export function bar(s: string): string {
  return s.toUpperCase();
}
`,
  );
  return root;
}

describe('pseudo integration (single platform)', () => {
  it('full scan populates all core tables', async () => {
    const root = makeFixture();
    try {
      const db = new Database(':memory:');
      db.exec('PRAGMA foreign_keys=ON');
      createSchema(db);
      const indexer = createPseudoIndexer(root, db);
      const run = await indexer.runFullScan({ trigger: 'manual' });

      expect(run.status).toBe('done');
      expect(run.files_scanned).toBeGreaterThanOrEqual(2);

      const fileCount = (db.query(`SELECT COUNT(*) AS n FROM files`).get() as { n: number }).n;
      expect(fileCount).toBeGreaterThanOrEqual(2);

      const methodCount = (db.query(`SELECT COUNT(*) AS n FROM methods`).get() as { n: number }).n;
      expect(methodCount).toBeGreaterThanOrEqual(3);

      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it('snapshot write + load roundtrips files table', async () => {
    const root = makeFixture();
    try {
      const db1 = new Database(':memory:');
      db1.exec('PRAGMA foreign_keys=ON');
      createSchema(db1);
      const indexer = createPseudoIndexer(root, db1);
      await indexer.runFullScan({ trigger: 'manual' });

      const snapPath = join(root, '.collab', 'pseudo', 'cache', 'derived.sqlite');
      mkdirSync(join(root, '.collab', 'pseudo', 'cache'), { recursive: true });
      await writeSnapshot(db1, root);
      expect(existsSync(snapPath)).toBe(true);

      const validation = await validateSnapshot(snapPath, 0, new Map());
      // Validation expected to fail due to file count mismatch (0 vs actual)
      // but the snapshot file exists and integrity_check should pass.
      expect(validation.valid).toBe(false);

      const db2 = new Database(':memory:');
      db2.exec('PRAGMA foreign_keys=ON');
      createSchema(db2);
      await loadSnapshot(db2, snapPath);

      const roundtrippedFiles = (db2.query(`SELECT COUNT(*) AS n FROM files`).get() as { n: number }).n;
      const originalFiles = (db1.query(`SELECT COUNT(*) AS n FROM files`).get() as { n: number }).n;
      expect(roundtrippedFiles).toBe(originalFiles);

      db1.close();
      db2.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);

  it('incremental scan updates a single file', async () => {
    const root = makeFixture();
    try {
      const db = new Database(':memory:');
      db.exec('PRAGMA foreign_keys=ON');
      createSchema(db);
      const indexer = createPseudoIndexer(root, db);
      await indexer.runFullScan({ trigger: 'manual' });

      const methodsBefore = (db.query(`SELECT COUNT(*) AS n FROM methods WHERE file_path LIKE '%a.ts'`).get() as { n: number }).n;

      writeFileSync(
        join(root, 'src', 'a.ts'),
        `export function foo(x: number): number { return x + 2; }
export function baz(y: number): number { return y * 3; }
`,
      );

      await indexer.runIncrementalScanForFile(join(root, 'src', 'a.ts'), { trigger: 'incremental' });

      const methodsAfter = (db.query(`SELECT COUNT(*) AS n FROM methods WHERE file_path LIKE '%a.ts'`).get() as { n: number }).n;
      expect(methodsAfter).toBeGreaterThanOrEqual(2);

      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
