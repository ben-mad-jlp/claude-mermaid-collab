import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSchema } from '../pseudo-schema.js';
import { createPseudoIndexer } from '../pseudo-indexer.js';

function makeFixtureProject(fileCount: number): string {
  const root = mkdtempSync(join(tmpdir(), 'pseudo-stress-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    const content = `
/**
 * ${i}th module — generated fixture.
 */
export function fn${i}(x: number): number {
  return x + ${i};
}
export class Widget${i} {
  compute(a: number, b: number): number {
    return a * b + ${i};
  }
}
`;
    writeFileSync(join(root, 'src', `mod${i}.ts`), content);
  }
  return root;
}

describe('pseudo stress (small synthetic)', () => {
  it('full scan of a 25-file fixture completes under 5 seconds', async () => {
    const root = makeFixtureProject(25);
    try {
      const db = new Database(':memory:');
      db.exec('PRAGMA foreign_keys=ON');
      createSchema(db);
      const indexer = createPseudoIndexer(root, db);

      const started = Date.now();
      const run = await indexer.runFullScan({ trigger: 'manual' });
      const elapsed = Date.now() - started;

      expect(run.status).toBe('done');
      expect(run.files_scanned).toBeGreaterThanOrEqual(25);
      expect(elapsed).toBeLessThan(5000);

      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10000);
});
