import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSchema } from '../pseudo-schema.js';
import { createPseudoIndexer } from '../pseudo-indexer.js';

/**
 * End-to-end tests for the wave-1 `pseudo-resolver` module.
 *
 * These tests wire up real synthetic source files on disk, run `runFullScan`
 * (which invokes `resolveCallEdges` internally), and then inspect the
 * `method_calls` table directly.
 *
 * The "canary" test in particular is designed to catch the NULL-callee bug:
 * if every method_calls row has `callee_method_id IS NULL` even when a
 * resolvable target exists, this test fails immediately.
 */

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Harness {
  project: string;
  db: Database;
  cleanup: () => void;
}

let harness: Harness | null = null;

function makeHarness(): Harness {
  const project = mkdtempSync(join(tmpdir(), 'pseudo-resolver-'));
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  createSchema(db);
  return {
    project,
    db,
    cleanup: () => {
      try { db.close(); } catch { /* ignore */ }
      try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function writeSource(project: string, relPath: string, body: string): string {
  const abs = join(project, relPath);
  const dir = abs.slice(0, abs.lastIndexOf('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

async function runScan(h: Harness): Promise<void> {
  const indexer = createPseudoIndexer(h.project, h.db);
  const run = await indexer.runFullScan({ trigger: 'manual' });
  if (run.status !== 'done') {
    throw new Error(`scan status was ${run.status}: ${run.error_msg}`);
  }
}

interface CallRow {
  callee_name: string;
  callee_name_hint: string | null;
  callee_method_id: string | null;
  resolution_quality: string;
  caller_name: string | null;
  caller_file: string | null;
  callee_file: string | null;
  callee_class: string | null;
}

function selectCalls(db: Database, calleeName: string): CallRow[] {
  return db.query(
    `SELECT mc.callee_name,
            mc.callee_name_hint,
            mc.callee_method_id,
            mc.resolution_quality,
            caller.name AS caller_name,
            caller.file_path AS caller_file,
            callee.file_path AS callee_file,
            callee.enclosing_class AS callee_class
       FROM method_calls mc
       JOIN methods caller ON caller.id = mc.caller_method_id
       LEFT JOIN methods callee ON callee.id = mc.callee_method_id
      WHERE mc.callee_name = ?`,
  ).all(calleeName) as CallRow[];
}

// ---------------------------------------------------------------------------

describe('pseudo-resolver', () => {
  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it('resolves unique-name (Round 1: exact)', async () => {
    const h = harness!;
    writeSource(h.project, 'a/foo.ts',
      `import { bar } from '../b/helpers';
export function foo() {
  bar();
}
`);
    writeSource(h.project, 'b/helpers.ts',
      `export function bar() {
  return 42;
}
`);

    await runScan(h);

    const calls = selectCalls(h.db, 'bar');
    const fromFoo = calls.find(c => c.caller_name === 'foo');
    expect(fromFoo).toBeDefined();
    expect(fromFoo!.callee_method_id).not.toBeNull();
    expect(fromFoo!.resolution_quality).toBe('exact');
    expect(fromFoo!.callee_file).toContain('helpers.ts');
  });

  it('resolves same-file (Round 2: same_file)', async () => {
    const h = harness!;
    // Two files share an exported/defined function named `helper`, so Round 1
    // (exact) sees two candidates and bails out. Round 2 should pick the
    // same-file `helper` for caller.
    writeSource(h.project, 'a/caller.ts',
      `function caller() {
  helper();
}
function helper() {
  return 1;
}
`);
    writeSource(h.project, 'b/other.ts',
      `export function helper() {
  return 2;
}
`);

    await runScan(h);

    const calls = selectCalls(h.db, 'helper');
    const fromCaller = calls.find(c => c.caller_name === 'caller');
    expect(fromCaller).toBeDefined();
    expect(fromCaller!.callee_method_id).not.toBeNull();
    expect(fromCaller!.resolution_quality).toBe('same_file');
    expect(fromCaller!.callee_file).toBe(fromCaller!.caller_file);
  });

  it('resolves class-match (Round 3: class)', async () => {
    const h = harness!;
    // Two classes both define `doThing`. Caller uses `DbService.doThing()`,
    // so `callee_name_hint === 'DbService'` steers Round 3 to the right class.
    writeSource(h.project, 'services/db.ts',
      `export class DbService {
  doThing() {
    return 'db';
  }
}
`);
    writeSource(h.project, 'services/other.ts',
      `export class OtherService {
  doThing() {
    return 'other';
  }
}
`);
    writeSource(h.project, 'app/caller.ts',
      `export function caller() {
  DbService.doThing();
}
`);

    await runScan(h);

    const calls = selectCalls(h.db, 'doThing');
    const fromCaller = calls.find(c => c.caller_name === 'caller');
    expect(fromCaller).toBeDefined();
    expect(fromCaller!.callee_name_hint).toBe('DbService');
    expect(fromCaller!.callee_method_id).not.toBeNull();
    expect(fromCaller!.resolution_quality).toBe('class');
    expect(fromCaller!.callee_class).toBe('DbService');
    expect(fromCaller!.callee_file).toContain('db.ts');
  });

  it('resolves same-directory export (Round 4: same_dir)', async () => {
    const h = harness!;
    // Two util.ts files in different directories both export `shared`.
    // A caller in dirA/caller.ts calls `shared()` with no receiver hint, so:
    //   Round 1 (exact): ambiguous — skipped.
    //   Round 2 (same_file): `shared` is not in caller.ts.
    //   Round 3 (class): no receiver hint.
    //   Round 4 (same_dir): picks the dirA/util.ts version.
    writeSource(h.project, 'dirA/util.ts',
      `export function shared() {
  return 'A';
}
`);
    writeSource(h.project, 'dirB/util.ts',
      `export function shared() {
  return 'B';
}
`);
    writeSource(h.project, 'dirA/caller.ts',
      `export function invoke() {
  shared();
}
`);

    await runScan(h);

    const calls = selectCalls(h.db, 'shared');
    const fromInvoke = calls.find(c => c.caller_name === 'invoke');
    expect(fromInvoke).toBeDefined();
    expect(fromInvoke!.callee_method_id).not.toBeNull();
    // Must pick dirA's shared, and quality must be same_dir or import
    // (the import-round variant would also count as correct if file_imports
    // happens to contain 'util' — but in a fresh fixture it should not).
    expect(['same_dir', 'import']).toContain(fromInvoke!.resolution_quality);
    expect(fromInvoke!.callee_file).toContain('dirA/util.ts');
  });

  it('marks leftovers as ambiguous or unresolved (Round 6)', async () => {
    const h = harness!;
    writeSource(h.project, 'app/caller.ts',
      `export function doIt() {
  nonExistentThing();
}
`);

    await runScan(h);

    const calls = selectCalls(h.db, 'nonExistentThing');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const leftover = calls[0];
    expect(leftover.callee_method_id).toBeNull();
    expect(leftover.resolution_quality).toBe('unresolved');
  });

  it('canary: zero resolved edges must lack callee_method_id', async () => {
    const h = harness!;
    // Seed 10+ files with a healthy mix: unique names (Round 1), intra-file
    // helpers (Round 2), class methods (Round 3), and real calls between them.
    for (let i = 0; i < 6; i++) {
      writeSource(h.project, `pkg/mod${i}.ts`,
        `export function uniqueName${i}(): number {
  return ${i};
}

export class Svc${i} {
  compute(): number {
    localHelper${i}();
    return ${i};
  }
}

function localHelper${i}(): void {
  // internal
}
`);
    }
    writeSource(h.project, 'pkg/consumer.ts',
      `export function consumer() {
  uniqueName0();
  uniqueName1();
  uniqueName2();
  Svc3.compute();
  Svc4.compute();
}
`);

    await runScan(h);

    // Canary #1: every row with callee_method_id NULL must have
    // resolution_quality in {'ambiguous','unresolved'}. A NULL with
    // resolution_quality set to any of the "resolved" values indicates the
    // resolver claimed success without binding the target — the exact bug
    // this test guards against.
    const badRow = h.db.query(
      `SELECT COUNT(*) AS n
         FROM method_calls
        WHERE callee_method_id IS NULL
          AND resolution_quality NOT IN ('ambiguous','unresolved')`,
    ).get() as { n: number };
    expect(badRow.n).toBe(0);

    // Canary #2: at least one edge must actually be resolved. If everything
    // is unresolved/ambiguous we have the opposite bug — the resolver no-ops.
    const resolved = h.db.query(
      `SELECT COUNT(*) AS n
         FROM method_calls
        WHERE callee_method_id IS NOT NULL`,
    ).get() as { n: number };
    expect(resolved.n).toBeGreaterThan(0);

    // Canary #3: every resolved edge must have a plausible quality string.
    const badQuality = h.db.query(
      `SELECT COUNT(*) AS n
         FROM method_calls
        WHERE callee_method_id IS NOT NULL
          AND resolution_quality NOT IN ('exact','same_file','class','same_dir','import')`,
    ).get() as { n: number };
    expect(badQuality.n).toBe(0);
  });

  it('incremental re-scan re-resolves inbound edges on rename', async () => {
    const h = harness!;
    // Define `oldName` in providers.ts, called from caller.ts.
    const providersPath = writeSource(h.project, 'pkg/providers.ts',
      `export function oldName(): number {
  return 1;
}
`);
    writeSource(h.project, 'pkg/caller.ts',
      `import { oldName } from './providers';
export function callIt() {
  oldName();
}
`);

    await runScan(h);

    // Sanity: before rename, caller->oldName resolves.
    const before = selectCalls(h.db, 'oldName');
    const beforeEdge = before.find(c => c.caller_name === 'callIt');
    expect(beforeEdge).toBeDefined();
    expect(beforeEdge!.callee_method_id).not.toBeNull();

    // Rename: change `oldName` to `brandNewName` in providers.ts and re-scan
    // just that file. The caller still says `oldName()`, so that edge should
    // now be unresolved (no matching method anywhere).
    writeFileSync(providersPath,
      `export function brandNewName(): number {
  return 1;
}
`);

    const indexer = createPseudoIndexer(h.project, h.db);
    await indexer.runIncrementalScanForFile(providersPath, { trigger: 'incremental' });

    // After the rename+incremental, a global resolver pass must run to
    // re-evaluate edges pointing at the old name. If the incremental path
    // only re-resolves edges in the rescanned file, the stale caller edge
    // will still appear "resolved" pointing at a now-dead method id — also
    // a bug this canary catches.
    const after = selectCalls(h.db, 'oldName');
    const afterEdge = after.find(c => c.caller_name === 'callIt');
    expect(afterEdge).toBeDefined();
    // The edge pointing at the now-renamed function should either be
    // unresolved, or — if the design chooses to re-resolve inbound edges —
    // still have a valid callee (but we don't require that stricter guarantee
    // here). We DO require: no dangling NULL with a "resolved" quality.
    if (afterEdge!.callee_method_id === null) {
      expect(['ambiguous', 'unresolved']).toContain(afterEdge!.resolution_quality);
    } else {
      expect(['exact', 'same_file', 'class', 'same_dir', 'import'])
        .toContain(afterEdge!.resolution_quality);
    }

    // Cross-check the general invariant survives incremental scans too.
    const stale = h.db.query(
      `SELECT COUNT(*) AS n
         FROM method_calls
        WHERE callee_method_id IS NULL
          AND resolution_quality NOT IN ('ambiguous','unresolved')`,
    ).get() as { n: number };
    expect(stale.n).toBe(0);
  });
});
