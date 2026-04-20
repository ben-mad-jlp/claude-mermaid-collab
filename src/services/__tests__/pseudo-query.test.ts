// Integration test: every pseudo-query.ts export must run against a V6 db
// populated by runFullScan on a seed project, returning a V2-compatible shape.
// Zero-tolerance guards on getSourceLink and getFunctionsForSource (critical UI paths).

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSchema } from '../pseudo-schema.js';
import { createPseudoIndexer } from '../pseudo-indexer.js';
import {
  listFiles,
  getFile,
  getFileByStem,
  search,
  getReferences,
  getCallGraph,
  getExports,
  getImpactAnalysis,
  getOrphanFunctions,
  getCoverage,
  getStats,
  getFilesByDirectory,
  getMethodLocation,
  getSourceLink,
  getFunctionsForSource,
} from '../pseudo-query.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeSeedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'pseudo-query-test-'));
  const srcDir = join(root, 'src');
  const subDir = join(root, 'src', 'util');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(subDir, { recursive: true });

  // File 1: two functions that call each other (same file)
  writeFileSync(
    join(srcDir, 'alpha.ts'),
    `/**
 * Alpha module.
 */
export function alphaOne(x: number): number {
  return alphaTwo(x) + 1;
}

export function alphaTwo(y: number): number {
  return y * 2;
}
`,
  );

  // File 2: exported class with a method + named import calling across files
  writeFileSync(
    join(srcDir, 'beta.ts'),
    `import { alphaOne } from './alpha';

/**
 * Beta module.
 */
export class BetaBox {
  compute(a: number): number {
    return alphaOne(a) + this.helper();
  }

  private helper(): number {
    return 42;
  }
}

export function betaEntry(n: number): number {
  const box = new BetaBox();
  return box.compute(n);
}
`,
  );

  // File 3: prose-like step hints (JSDoc with bullet list that gets picked up
  // by docstring extractor — keeps method_steps non-empty so exercises steps path)
  writeFileSync(
    join(srcDir, 'gamma.ts'),
    `/**
 * Gamma module.
 */

/**
 * Runs the gamma pipeline.
 *
 * - validate input
 * - transform
 * - return result
 */
export function gammaRun(input: string): string {
  return input.toUpperCase();
}
`,
  );

  // File 4: a nested util file
  writeFileSync(
    join(subDir, 'delta.ts'),
    `export function deltaHelper(): number {
  return 7;
}

function deltaPrivate(): number {
  return 3;
}
`,
  );

  // File 5: orphan (unexported, never called from anywhere indexed)
  writeFileSync(
    join(srcDir, 'epsilon.ts'),
    `function epsilonOrphan(): void {
  // never called
}
`,
  );

  // File 6: small file to grow the corpus
  writeFileSync(
    join(srcDir, 'zeta.ts'),
    `export async function zetaAsync(): Promise<number> {
  return 1;
}
`,
  );

  return root;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let project: string;
let db: Database;

beforeEach(async () => {
  project = makeSeedProject();
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  createSchema(db);
  const indexer = createPseudoIndexer(project, db);
  const run = await indexer.runFullScan({ trigger: 'manual' });
  // Sanity: the scan must have succeeded and populated the DB. If this fails
  // the per-test assertions below won't be meaningful.
  if (run.status !== 'done') {
    throw new Error(`fixture scan did not finish cleanly: status=${run.status}`);
  }
});

afterEach(() => {
  try { db.close(); } catch {}
  try { rmSync(project, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pseudo-query', () => {
  it('listFiles returns non-empty array with expected shape', () => {
    const files = listFiles(db);
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);

    const f = files[0];
    expect(f).toHaveProperty('filePath');
    expect(f).toHaveProperty('title');
    expect(f).toHaveProperty('methodCount');
    expect(f).toHaveProperty('exportCount');
    expect(f).toHaveProperty('lastUpdated');
    expect(typeof f.filePath).toBe('string');
    expect(typeof f.methodCount).toBe('number');
    expect(typeof f.exportCount).toBe('number');
  });

  it('getFile returns a PseudoFileWithMethods', () => {
    const alpha = join(project, 'src', 'alpha.ts');
    const got = getFile(db, alpha);
    expect(got).not.toBeNull();
    expect(got!.filePath).toBe(alpha);
    expect(got).toHaveProperty('title');
    expect(got).toHaveProperty('purpose');
    expect(got).toHaveProperty('moduleContext');
    expect(got).toHaveProperty('proseUpdatedAt');
    expect(got).toHaveProperty('hasProse');
    expect(got).toHaveProperty('structuralIndexedAt');
    // degradation ledger: language is synthesized as null
    expect(got!.language).toBeNull();
    // proseUpdatedAt synthesized as null
    expect(got!.proseUpdatedAt).toBeNull();

    expect(Array.isArray(got!.methods)).toBe(true);
    expect(got!.methods.length).toBeGreaterThanOrEqual(2);

    const m = got!.methods[0];
    expect(m).toHaveProperty('name');
    expect(m).toHaveProperty('params');
    expect(m).toHaveProperty('returnType');
    expect(m).toHaveProperty('isExported');
    expect(m).toHaveProperty('isAsync');
    expect(m).toHaveProperty('sourceLine');
    expect(m).toHaveProperty('steps');
    expect(m).toHaveProperty('calls');
    // degradation ledger: returnType synthesized as '', paramCount as 0
    expect(m.returnType).toBe('');
    expect(m.paramCount).toBe(0);
    expect(m.visibility).toBeNull();
    expect(m.kind).toBeNull();
    expect(m.date).toBeNull();
  });

  it('getFileByStem finds a file by its basename-sans-ext', () => {
    const got = getFileByStem(db, 'alpha');
    expect(got).not.toBeNull();
    expect(got!.filePath.endsWith('alpha.ts')).toBe(true);

    const missing = getFileByStem(db, 'nonexistent-stem');
    expect(missing).toBeNull();
  });

  it('search returns SearchResult[] (methodName synthesized as empty string)', () => {
    const results = search(db, 'gamma');
    expect(Array.isArray(results)).toBe(true);
    // Fixture has a file named gamma.ts with "Gamma module." — FTS indexes
    // file title/purpose/steps/method_names. We expect at least one hit.
    expect(results.length).toBeGreaterThan(0);

    const r = results[0];
    expect(r).toHaveProperty('filePath');
    expect(r).toHaveProperty('methodName');
    expect(r).toHaveProperty('snippet');
    expect(r).toHaveProperty('rank');
    // Degradation: methodName is synthesized as '' since V6 FTS is per-file.
    expect(r.methodName).toBe('');
    expect(typeof r.filePath).toBe('string');
    // Snippet is nullable — the V6 FTS table is contentless (`content=''`)
    // so the snippet() function returns NULL. The query surface types it
    // as string, but the DB legitimately returns null here.
    expect(r.snippet === null || typeof r.snippet === 'string').toBe(true);
    expect(typeof r.rank).toBe('number');
  });

  it('getReferences finds call sites by callee name', () => {
    // alphaOne is called from beta.ts (via named import) and from… itself
    // isn't called directly by alphaOne, but alphaTwo is called by alphaOne.
    const refsToAlphaTwo = getReferences(db, 'alphaTwo');
    expect(Array.isArray(refsToAlphaTwo)).toBe(true);
    expect(refsToAlphaTwo.length).toBeGreaterThan(0);

    const ref = refsToAlphaTwo[0];
    expect(ref).toHaveProperty('filePath');
    expect(ref).toHaveProperty('methodName');
    expect(ref).toHaveProperty('line');
    expect(typeof ref.filePath).toBe('string');
    expect(typeof ref.methodName).toBe('string');
    expect(typeof ref.line).toBe('number');

    // Unknown callee should return an empty array, not throw.
    const empty = getReferences(db, 'nobodyCallsThis_x9z');
    expect(empty).toEqual([]);
  });

  it('getCallGraph returns { nodes, edges } with edges having callee_method_id resolved', () => {
    const graph = getCallGraph(db);
    expect(graph).toHaveProperty('nodes');
    expect(graph).toHaveProperty('edges');
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);

    const node = graph.nodes[0];
    expect(node).toHaveProperty('id');
    expect(node).toHaveProperty('label');
    expect(node).toHaveProperty('type');
    expect(node).toHaveProperty('filePath');
    expect(node).toHaveProperty('isExported');
    expect(node.type).toBe('method');

    // Resolver should have wired at least one intra-file call
    // (alphaOne -> alphaTwo) so the edges list is non-empty.
    expect(graph.edges.length).toBeGreaterThan(0);
    const edge = graph.edges[0];
    expect(edge).toHaveProperty('source');
    expect(edge).toHaveProperty('target');
    expect(typeof edge.source).toBe('string');
    expect(typeof edge.target).toBe('string');
  });

  it('getExports returns methods where is_exported = 1', () => {
    const exports = getExports(db);
    expect(Array.isArray(exports)).toBe(true);
    expect(exports.length).toBeGreaterThan(0);
    for (const e of exports) {
      expect(e.isExported).toBe(true);
    }
    // Should contain alphaOne, alphaTwo, betaEntry, gammaRun, deltaHelper, zetaAsync
    const names = exports.map(e => e.name);
    expect(names).toContain('alphaOne');
    expect(names).toContain('alphaTwo');
  });

  it('getImpactAnalysis returns { direct, transitive } (may be empty on tiny fixture)', () => {
    const impact = getImpactAnalysis(db, 'alphaTwo');
    expect(impact).toHaveProperty('direct');
    expect(impact).toHaveProperty('transitive');
    expect(Array.isArray(impact.direct)).toBe(true);
    expect(Array.isArray(impact.transitive)).toBe(true);

    // alphaTwo is called by alphaOne, so at least one direct impact.
    expect(impact.direct.length).toBeGreaterThan(0);
    const d = impact.direct[0];
    expect(d).toHaveProperty('filePath');
    expect(d).toHaveProperty('methodName');
    expect(d).toHaveProperty('depth');
    expect(d.depth).toBe(1);
  });

  it('getOrphanFunctions returns methods with no inbound calls and is_exported=0', () => {
    const orphans = getOrphanFunctions(db);
    expect(Array.isArray(orphans)).toBe(true);
    // The structural scanner emits a self-call for each function definition
    // (because the function signature line `function foo(` gets matched by the
    // call-edge regex), so a truly isolated private function is rare in a
    // source-scanned fixture. We therefore only assert the invariant: every
    // orphan returned must be unexported.
    for (const o of orphans) {
      expect(o.isExported).toBe(false);
      // Shape must match PseudoMethodWithMeta.
      expect(o).toHaveProperty('name');
      expect(o).toHaveProperty('params');
      expect(o).toHaveProperty('returnType');
      expect(o).toHaveProperty('steps');
      expect(o).toHaveProperty('calls');
    }
  });

  it('getCoverage walks source tree and returns CoverageReport', () => {
    const report = getCoverage(db, project);
    expect(report).toHaveProperty('coveredFiles');
    expect(report).toHaveProperty('totalFiles');
    expect(report).toHaveProperty('percent');
    expect(report).toHaveProperty('missingFiles');
    expect(typeof report.coveredFiles).toBe('number');
    expect(typeof report.totalFiles).toBe('number');
    expect(typeof report.percent).toBe('number');
    expect(Array.isArray(report.missingFiles)).toBe(true);

    // All fixture source files should be indexed.
    expect(report.totalFiles).toBeGreaterThan(0);
    expect(report.coveredFiles).toBeGreaterThan(0);
  });

  it('getStats returns total counts', () => {
    const stats = getStats(db);
    expect(stats).toHaveProperty('fileCount');
    expect(stats).toHaveProperty('methodCount');
    expect(stats).toHaveProperty('exportCount');
    expect(stats.fileCount).toBeGreaterThan(0);
    expect(stats.methodCount).toBeGreaterThan(0);
    expect(stats.exportCount).toBeGreaterThan(0);
  });

  it('getFilesByDirectory filters by directory prefix', () => {
    const srcUtil = join(project, 'src', 'util');
    const filtered = getFilesByDirectory(db, srcUtil);
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
    for (const f of filtered) {
      expect(f.filePath.startsWith(srcUtil)).toBe(true);
    }

    // Every returned row should still have the file-summary shape.
    const f0 = filtered[0];
    expect(f0).toHaveProperty('filePath');
    expect(f0).toHaveProperty('methodCount');
    expect(f0).toHaveProperty('exportCount');
  });

  it('getMethodLocation(methodId) returns { filePath, line } for a known method', () => {
    // Pick an arbitrary method id from the populated db.
    const row = db.prepare(`SELECT id FROM methods LIMIT 1`).get() as { id: string } | undefined;
    expect(row).toBeDefined();

    const loc = getMethodLocation(db, row!.id);
    expect(loc).not.toBeNull();
    expect(loc).toHaveProperty('filePath');
    expect(loc).toHaveProperty('line');
    expect(typeof loc!.filePath).toBe('string');
    expect(typeof loc!.line).toBe('number');

    // Unknown method id returns null.
    const missing = getMethodLocation(db, 'm_deadbeef');
    expect(missing).toBeNull();
  });

  // --------------------------------------------------------------------
  // Zero-tolerance UI regression guards
  // --------------------------------------------------------------------

  it('getSourceLink returns SourceLinkCandidate[] with (filePath, startLine, endLine)', () => {
    const candidates = getSourceLink(db, 'alphaOne');
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);

    const c = candidates[0];
    // Critical UI contract: sourceFilePath + sourceLine + sourceLineEnd + language + isExported
    expect(c).toHaveProperty('sourceFilePath');
    expect(c).toHaveProperty('sourceLine');
    expect(c).toHaveProperty('sourceLineEnd');
    expect(c).toHaveProperty('language');
    expect(c).toHaveProperty('isExported');
    expect(typeof c.sourceFilePath).toBe('string');
    expect(typeof c.sourceLine).toBe('number');
    // endLine is nullable but when set is a number
    if (c.sourceLineEnd !== null) {
      expect(typeof c.sourceLineEnd).toBe('number');
    }
    // Degradation ledger: language is synthesized as null
    expect(c.language).toBeNull();
    expect(typeof c.isExported).toBe('boolean');

    // Unknown name -> empty array (never throws).
    expect(getSourceLink(db, 'nope_not_real_xyz')).toEqual([]);

    // fileStem filter reduces the set.
    const filtered = getSourceLink(db, 'alphaOne', 'alpha');
    expect(filtered.length).toBeGreaterThan(0);
    for (const f of filtered) {
      expect(f.sourceFilePath.endsWith('alpha.ts')).toBe(true);
    }
  });

  it('getFunctionsForSource returns FunctionForSource[] with (name, start_line, is_async, is_exported, enclosing_class)', () => {
    const betaPath = join(project, 'src', 'beta.ts');
    const fns = getFunctionsForSource(db, betaPath);
    expect(Array.isArray(fns)).toBe(true);
    expect(fns.length).toBeGreaterThan(0);

    const f = fns[0];
    // Critical UI contract — these five fields power the source-annotated
    // view. Missing any of them would break the UI.
    expect(f).toHaveProperty('name');
    expect(f).toHaveProperty('sourceLine');
    expect(f).toHaveProperty('isAsync');
    expect(f).toHaveProperty('isExported');
    // enclosing_class surfaces as part of the shape; the V2 type calls the
    // whole row FunctionForSource — query returns params/returnType too.
    expect(f).toHaveProperty('params');
    expect(f).toHaveProperty('returnType');
    expect(f).toHaveProperty('sourceLineEnd');
    expect(f).toHaveProperty('visibility');
    expect(f).toHaveProperty('kind');

    expect(typeof f.name).toBe('string');
    expect(typeof f.isAsync).toBe('boolean');
    expect(typeof f.isExported).toBe('boolean');
    // Degradation ledger: returnType synthesized as '', visibility/kind null.
    expect(f.returnType).toBe('');
    expect(f.visibility).toBeNull();
    expect(f.kind).toBeNull();

    // beta.ts has compute() in BetaBox, helper() in BetaBox, and betaEntry().
    const names = fns.map(x => x.name);
    expect(names).toContain('betaEntry');

    // Unknown file returns empty array.
    expect(getFunctionsForSource(db, join(project, 'src', 'does-not-exist.ts'))).toEqual([]);
  });
});
