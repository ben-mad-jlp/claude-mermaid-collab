/**
 * Pseudo DB Unification Canary
 *
 * Regression test for the "two implementations drift" failure mode: after Wave 5,
 * every pseudo-* read surface must hit the same unified V6 db/indexer pipeline.
 * If a future PR routes a consumer to a different db (e.g. a parallel legacy
 * `getPseudoDb` or a fresh Database(':memory:')), the query surfaces below will
 * return empty/null results and this canary will fail loudly.
 *
 * Also specifically guards the NULL-callee bug: every unresolved row must have
 * resolution_quality in ('ambiguous','unresolved'). If a row has NULL callee
 * with resolution_quality='exact' (or similar), the resolver itself is broken.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initPseudoDbV6, type PseudoDbV6Handle } from '../pseudo-db.js';
import { writeProseFile, type ProseFileV3 } from '../pseudo-prose-file.js';
import { escapePath } from '../pseudo-path-escape.js';
import * as pseudoQuery from '../pseudo-query.js';

// Minimal seed project: 3 TS files with exports, imports, cross-file calls,
// a class with a method, and one prose overlay file.
function seedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'pseudo-unify-'));
  mkdirSync(join(root, 'src'), { recursive: true });

  // a.ts: declares foo + Widget class with compute().
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

  // b.ts: imports foo from a.ts and calls it from bar() — exercises
  // method_calls + cross-file resolution.
  writeFileSync(
    join(root, 'src', 'b.ts'),
    `import { foo } from './a';

export function bar(x: number): number {
  return foo(x) + 1;
}
`,
  );

  // c.ts: a third file with a local call (exercises same-file resolution).
  writeFileSync(
    join(root, 'src', 'c.ts'),
    `export function helper(): number {
  return 42;
}

export function useHelper(): number {
  return helper() + 1;
}
`,
  );

  return root;
}

// Write a prose overlay file for src/a.ts so overlay_matches / has_prose can
// be exercised. We pick name + params that match Widget.compute so step2 of
// the overlay matcher claims it even without a body_fingerprint.
function writeProseOverlay(project: string): Promise<void> {
  const relSource = 'src/a.ts';
  const escaped = escapePath(relSource);
  const proseFilePath = join(project, '.collab', 'pseudo', 'prose', escaped + '.json');

  const prose: ProseFileV3 = {
    schema_version: 3,
    file: relSource,
    title: 'Module A',
    purpose: 'Demo module for unification canary',
    module_context: 'canary',
    methods: [
      {
        id: 'prose-widget-compute-0001',
        name: 'compute',
        enclosing_class: 'Widget',
        normalized_params: 'a,b',
        body_fingerprint: '',
        prose_origin: 'manual',
        steps: [
          { order: 0, content: 'multiply a by b' },
          { order: 1, content: 'return the product' },
        ],
        tags: { deprecated: false },
      },
    ],
  };

  return writeProseFile(proseFilePath, prose);
}

describe('pseudo-unification canary', () => {
  let project: string;
  let handle: PseudoDbV6Handle;

  beforeAll(async () => {
    project = seedProject();
    await writeProseOverlay(project);
    // attachWatcher/attachDrift off: test is short-lived, no need for file
    // watching or periodic drift scans.
    handle = initPseudoDbV6(project, { attachWatcher: false, attachDrift: false });
    await handle.ready;
  });

  afterAll(async () => {
    if (handle) await handle.dispose();
    if (project) rmSync(project, { recursive: true, force: true });
  });

  // --- raw DB invariants ----------------------------------------------------

  it('files table is non-empty', () => {
    const row = handle.db
      .prepare(`SELECT COUNT(*) AS c FROM files`)
      .get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  it('methods table is non-empty', () => {
    const row = handle.db
      .prepare(`SELECT COUNT(*) AS c FROM methods`)
      .get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  it('method_calls table has rows with callee_method_id resolved', () => {
    const row = handle.db
      .prepare(
        `SELECT COUNT(*) AS c FROM method_calls WHERE callee_method_id IS NOT NULL`,
      )
      .get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  // Canary for the NULL-callee bug: every NULL callee must be resolver-marked
  // as 'ambiguous' or 'unresolved'. Any other value with NULL callee means the
  // resolver is broken (it claimed to resolve but left callee_method_id NULL).
  it('method_calls has zero NULL callee_method_id with unusual resolution_quality', () => {
    const row = handle.db
      .prepare(
        `SELECT COUNT(*) AS c FROM method_calls
         WHERE callee_method_id IS NULL
           AND resolution_quality NOT IN ('ambiguous','unresolved')`,
      )
      .get() as { c: number };
    expect(row.c).toBe(0);
  });

  // --- query surface (pseudo-query.ts) --------------------------------------

  it('pseudoQuery.listFiles returns > 0', () => {
    const files = pseudoQuery.listFiles(handle.db);
    expect(files.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getFile(<known path>) is non-null', () => {
    const files = pseudoQuery.listFiles(handle.db);
    expect(files.length).toBeGreaterThan(0);
    const aFile = files.find((f) => f.filePath.endsWith('a.ts'));
    expect(aFile).toBeDefined();
    const file = pseudoQuery.getFile(handle.db, aFile!.filePath);
    expect(file).not.toBeNull();
    expect(file!.methods.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.search(<query>) returns > 0', () => {
    const results = pseudoQuery.search(handle.db, 'foo');
    expect(results.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getStats reports file_count and method_count > 0', () => {
    const stats = pseudoQuery.getStats(handle.db);
    expect(stats.fileCount).toBeGreaterThan(0);
    expect(stats.methodCount).toBeGreaterThan(0);
  });

  it('pseudoQuery.getCallGraph has edges', () => {
    const graph = pseudoQuery.getCallGraph(handle.db);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getSourceLink(<known name>) returns at least one candidate', () => {
    const candidates = pseudoQuery.getSourceLink(handle.db, 'foo');
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getFunctionsForSource(<known file>) returns functions', () => {
    const files = pseudoQuery.listFiles(handle.db);
    const aFile = files.find((f) => f.filePath.endsWith('a.ts'));
    expect(aFile).toBeDefined();
    const functions = pseudoQuery.getFunctionsForSource(handle.db, aFile!.filePath);
    expect(functions.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getExports returns methods where is_exported=1', () => {
    const exports = pseudoQuery.getExports(handle.db);
    expect(exports.length).toBeGreaterThan(0);
    for (const e of exports) {
      expect(e.isExported).toBe(true);
    }
  });

  it('pseudoQuery.getOrphanFunctions returns zero or more rows (must not throw)', () => {
    // Orphans is allowed to be empty — the assertion is that it runs without
    // throwing and returns an array.
    const orphans = pseudoQuery.getOrphanFunctions(handle.db);
    expect(Array.isArray(orphans)).toBe(true);
  });

  it('pseudoQuery.getFilesByDirectory(<dir>) returns > 0', () => {
    const dir = join(project, 'src');
    const files = pseudoQuery.getFilesByDirectory(handle.db, dir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('pseudoQuery.getCoverage returns CoverageReport (indexedFiles > 0)', () => {
    const coverage = pseudoQuery.getCoverage(handle.db, project);
    expect(coverage.totalFiles).toBeGreaterThan(0);
    expect(coverage.coveredFiles).toBeGreaterThan(0);
  });
});
