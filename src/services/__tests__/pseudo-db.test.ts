import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'bun:sqlite';
import {
  getPseudoDb,
  type ScanResult,
  type ProseData,
  type StructuralMethod,
  type ProseMethod,
} from '../pseudo-db';

/**
 * Tests for PseudoDbService (schema v2) — two-level indexing API.
 *
 * Level 1: upsertStructural(filePath, language, scan)
 * Level 2: upsertProse(filePath, data)
 *
 * file_path is the absolute source code file path. No .pseudo files.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_ROOT = join(homedir(), '.test-collab-pseudo-db');

let currentProject: string;
let testCounter = 0;

beforeEach(() => {
  testCounter++;
  currentProject = join(TEST_ROOT, `t${testCounter}-${Date.now()}`);
  if (existsSync(currentProject)) {
    rmSync(currentProject, { recursive: true, force: true });
  }
  mkdirSync(currentProject, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeScanResult(opts: {
  language?: string;
  lineCount?: number;
  sourceHash?: string;
  methods?: Array<Partial<StructuralMethod>>;
}): ScanResult {
  return {
    language: opts.language ?? 'typescript',
    lineCount: opts.lineCount ?? 10,
    sourceHash: opts.sourceHash ?? 'abc123def456',
    methods: (opts.methods ?? []).map((m, i) => {
      const params = m.params ?? '';
      return {
        name: m.name ?? `fn${i}`,
        params,
        paramCount: m.paramCount ?? (params.trim() ? params.split(',').length : 0),
        returnType: m.returnType ?? '',
        sourceLine: m.sourceLine ?? i + 1,
        sourceLineEnd: m.sourceLineEnd ?? null,
        visibility: m.visibility ?? null,
        isAsync: m.isAsync ?? false,
        kind: m.kind ?? 'function',
        isExported: m.isExported ?? false,
        owningSymbol: m.owningSymbol ?? null,
      };
    }),
  };
}

function makeProseData(opts: {
  title?: string;
  purpose?: string;
  moduleContext?: string;
  methods?: Array<Partial<ProseMethod> & { name: string }>;
}): ProseData {
  return {
    title: opts.title ?? '',
    purpose: opts.purpose ?? '',
    moduleContext: opts.moduleContext ?? '',
    methods: (opts.methods ?? []).map(m => ({
      name: m.name,
      params: m.params,
      steps: m.steps ?? [],
      calls: m.calls ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

describe('PseudoDbService schema migration', () => {
  it('creates fresh schema_version row at v2 on first init', () => {
    getPseudoDb(currentProject);

    const dbPath = join(currentProject, '.collab', 'pseudo', 'pseudo.db');
    expect(existsSync(dbPath)).toBe(true);

    const raw = new Database(dbPath);
    const row = raw.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any;
    raw.close();

    expect(row).toBeTruthy();
    expect(row.version).toBe(2);
  });

  it('is idempotent across re-init (same project path)', () => {
    expect(() => {
      getPseudoDb(currentProject);
      getPseudoDb(currentProject);
    }).not.toThrow();

    const stats = getPseudoDb(currentProject).getStats();
    expect(stats.fileCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// upsertStructural + upsertProse round-trip via getFile
// ---------------------------------------------------------------------------

describe('upsertStructural + upsertProse round-trip via getFile', () => {
  it('round-trips a simple file with prose', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'foo.ts');

    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'doFoo', params: 'x: number', returnType: 'string', isExported: true, sourceLine: 5 }],
    }));
    db.upsertProse(filePath, makeProseData({
      title: 'Foo',
      purpose: 'Does foo things',
      moduleContext: 'module stuff',
      methods: [{
        name: 'doFoo',
        params: 'x: number',
        steps: [{ content: 'return "bar"', depth: 0 }],
      }],
    }));

    const got = db.getFile(filePath);
    expect(got).not.toBeNull();
    expect(got!.filePath).toBe(filePath);
    expect(got!.title).toBe('Foo');
    expect(got!.purpose).toBe('Does foo things');
    expect(got!.moduleContext).toBe('module stuff');
    expect(got!.methods).toHaveLength(1);
    expect(got!.methods[0].name).toBe('doFoo');
    expect(got!.methods[0].params).toBe('x: number');
    expect(got!.methods[0].returnType).toBe('string');
    expect(got!.methods[0].isExported).toBe(true);
    expect(got!.methods[0].sourceLine).toBe(5);
    expect(got!.methods[0].steps).toEqual([{ content: 'return "bar"', depth: 0 }]);
  });

  it('returns null for unknown file', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getFile(join(currentProject, 'nope.ts'))).toBeNull();
  });

  it('handles overloaded methods (same name, different params)', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'overload.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'foo', params: 'x: number', sourceLine: 1 },
        { name: 'foo', params: 'x: string, y: number', sourceLine: 5 },
      ],
    }));

    const got = db.getFile(filePath);
    expect(got!.methods).toHaveLength(2);
    expect(got!.methods.map(m => m.params)).toContain('x: number');
    expect(got!.methods.map(m => m.params)).toContain('x: string, y: number');
  });

  it('persists all structural metadata fields', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'meta.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{
        name: 'myMethod',
        visibility: 'public',
        isAsync: true,
        kind: 'method',
        sourceLine: 42,
        sourceLineEnd: 58,
        owningSymbol: 'MyClass',
      }],
    }));

    const got = db.getFile(filePath);
    expect(got!.methods[0].visibility).toBe('public');
    expect(got!.methods[0].isAsync).toBe(true);
    expect(got!.methods[0].kind).toBe('method');
    expect(got!.methods[0].sourceLine).toBe(42);
    expect(got!.methods[0].sourceLineEnd).toBe(58);
    expect(got!.methods[0].owningSymbol).toBe('MyClass');
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe('getStats', () => {
  it('returns zero counts for empty db', () => {
    const db = getPseudoDb(currentProject);
    const stats = db.getStats();
    expect(stats).toEqual({ fileCount: 0, methodCount: 0, exportCount: 0 });
  });

  it('counts files, methods, exports', () => {
    const db = getPseudoDb(currentProject);
    db.upsertStructural(join(currentProject, 'a.ts'), 'typescript', makeScanResult({
      methods: [
        { name: 'foo', isExported: true, sourceLine: 1 },
        { name: 'bar', isExported: false, sourceLine: 2 },
      ],
    }));
    db.upsertStructural(join(currentProject, 'b.ts'), 'typescript', makeScanResult({
      methods: [
        { name: 'baz', isExported: false, sourceLine: 1 },
      ],
    }));

    const stats = db.getStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.methodCount).toBe(3);
    expect(stats.exportCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getCallGraph
// ---------------------------------------------------------------------------

describe('getCallGraph', () => {
  it('resolves call edges via callee_method_id (no stem-collision bug)', () => {
    const db = getPseudoDb(currentProject);
    const helperA = join(currentProject, 'dirA', 'helper.ts');
    const helperB = join(currentProject, 'dirB', 'helper.ts');
    const callerPath = join(currentProject, 'caller.ts');

    db.upsertStructural(helperA, 'typescript', makeScanResult({
      methods: [{ name: 'target', sourceLine: 1, isExported: true }],
    }));
    db.upsertStructural(helperB, 'typescript', makeScanResult({
      methods: [{ name: 'target', sourceLine: 1, isExported: true }],
    }));
    db.upsertStructural(callerPath, 'typescript', makeScanResult({
      methods: [{ name: 'callIt', sourceLine: 1 }],
    }));
    db.upsertProse(callerPath, makeProseData({
      methods: [{ name: 'callIt', params: '', calls: [{ name: 'target', fileStem: 'helper' }] }],
    }));

    const graph = db.getCallGraph();
    // Should have at least one edge from callIt to some target
    const edge = graph.edges.find(e => e.source.includes('callIt'));
    expect(edge).toBeDefined();
    expect(edge!.target).toContain('target');
  });
});

// ---------------------------------------------------------------------------
// getSourceLink
// ---------------------------------------------------------------------------

describe('getSourceLink', () => {
  it('returns empty array when name not found', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getSourceLink('nothere')).toEqual([]);
  });

  it('returns candidate with sourceLine when method is indexed', () => {
    const db = getPseudoDb(currentProject);
    const srcPath = join(currentProject, 'real.ts');
    db.upsertStructural(srcPath, 'typescript', makeScanResult({
      methods: [{ name: 'findMe', isExported: true, sourceLine: 10, sourceLineEnd: 20 }],
    }));

    const results = db.getSourceLink('findMe');
    expect(results).toHaveLength(1);
    expect(results[0].sourceLine).toBe(10);
    expect(results[0].sourceLineEnd).toBe(20);
    expect(results[0].isExported).toBe(true);
    expect(results[0].sourceFilePath).toBe(srcPath);
  });

  it('filters by hintFileStem when provided', () => {
    const db = getPseudoDb(currentProject);
    const srcA = join(currentProject, 'alpha.ts');
    const srcB = join(currentProject, 'beta.ts');
    db.upsertStructural(srcA, 'typescript', makeScanResult({
      methods: [{ name: 'sharedName', sourceLine: 1 }],
    }));
    db.upsertStructural(srcB, 'typescript', makeScanResult({
      methods: [{ name: 'sharedName', sourceLine: 2 }],
    }));

    const unfiltered = db.getSourceLink('sharedName');
    expect(unfiltered).toHaveLength(2);

    const filtered = db.getSourceLink('sharedName', 'alpha');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceFilePath).toBe(srcA);
  });
});

// ---------------------------------------------------------------------------
// getCoverage
// ---------------------------------------------------------------------------

describe('getCoverage', () => {
  it('returns zero when no source files on disk', () => {
    const db = getPseudoDb(currentProject);
    const report = db.getCoverage();
    expect(report.totalFiles).toBe(0);
    expect(report.coveredFiles).toBe(0);
    expect(report.percent).toBe(0);
    expect(report.missingFiles).toEqual([]);
  });

  it('reports covered vs missing files', () => {
    const db = getPseudoDb(currentProject);
    const srcDir = join(currentProject, 'src');
    mkdirSync(srcDir, { recursive: true });
    const coveredSrc = join(srcDir, 'covered.ts');
    const missingSrc = join(srcDir, 'missing.ts');
    writeFileSync(coveredSrc, 'export function a() {}\n');
    writeFileSync(missingSrc, 'export function b() {}\n');

    db.upsertStructural(coveredSrc, 'typescript', makeScanResult({
      methods: [{ name: 'a', isExported: true, sourceLine: 1 }],
    }));

    const report = db.getCoverage();
    expect(report.totalFiles).toBe(2);
    expect(report.coveredFiles).toBe(1);
    expect(report.missingFiles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getExports (stepSummary field)
// ---------------------------------------------------------------------------

describe('getExports (stepSummary renamed field)', () => {
  it('returns entries with stepSummary field (not purpose)', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'exp.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'exportedFn', isExported: true, sourceLine: 1 },
        { name: 'notExported', isExported: false, sourceLine: 5 },
      ],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{
        name: 'exportedFn',
        params: '',
        steps: [
          { content: 'do step 1', depth: 0 },
          { content: 'do step 2', depth: 0 },
        ],
      }],
    }));

    const exports = db.getExports();
    expect(exports.length).toBeGreaterThanOrEqual(1);
    const entry = exports.find(e => e.methodName === 'exportedFn');
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty('stepSummary');
    expect(entry!.stepSummary).toContain('do step 1');
    expect(entry!.stepSummary).toContain('do step 2');
    expect(entry).not.toHaveProperty('purpose');
  });
});

// ---------------------------------------------------------------------------
// getFunctionsForSource
// ---------------------------------------------------------------------------

describe('getFunctionsForSource', () => {
  it('returns empty array for unknown source path', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getFunctionsForSource(join(currentProject, 'nope.ts'))).toEqual([]);
  });

  it('returns methods ordered by sourceLine', () => {
    const db = getPseudoDb(currentProject);
    const srcPath = join(currentProject, 'src', 'auth.ts');
    db.upsertStructural(srcPath, 'typescript', makeScanResult({
      methods: [
        {
          name: 'second',
          params: 'x: number',
          returnType: 'void',
          isExported: false,
          sourceLine: 20,
          sourceLineEnd: 25,
          visibility: 'public',
          isAsync: true,
          kind: 'method',
        },
        {
          name: 'first',
          params: '',
          returnType: 'string',
          isExported: true,
          sourceLine: 5,
          sourceLineEnd: 10,
        },
      ],
    }));

    const functions = db.getFunctionsForSource(srcPath);
    expect(functions).toHaveLength(2);
    expect(functions[0].name).toBe('first');
    expect(functions[0].sourceLine).toBe(5);
    expect(functions[1].name).toBe('second');
    expect(functions[1].sourceLine).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// getReferences
// ---------------------------------------------------------------------------

describe('getReferences (includes sourceLine)', () => {
  it('returns source_line from the caller method', () => {
    const db = getPseudoDb(currentProject);
    const targetPath = join(currentProject, 'src', 'target.ts');
    const callerPath = join(currentProject, 'src', 'caller.ts');

    db.upsertStructural(targetPath, 'typescript', makeScanResult({
      methods: [{ name: 'targetFn', isExported: true, sourceLine: 1 }],
    }));
    db.upsertStructural(callerPath, 'typescript', makeScanResult({
      methods: [{ name: 'callerFn', sourceLine: 15 }],
    }));
    db.upsertProse(callerPath, makeProseData({
      methods: [{
        name: 'callerFn',
        params: '',
        calls: [{ name: 'targetFn', fileStem: 'target' }],
      }],
    }));

    const refs = db.getReferences('targetFn', 'target');
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toBe(callerPath);
    expect(refs[0].callerMethod).toBe('callerFn');
    expect(refs[0].sourceLine).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// upsertStructural behavior (new tests)
// ---------------------------------------------------------------------------

describe('upsertStructural behavior', () => {
  it('updates existing methods matched by name+params', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'upd.ts');

    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'foo', params: 'x', returnType: 'void', sourceLine: 1 }],
    }));
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'foo', params: 'x', returnType: 'string', sourceLine: 10 }],
    }));

    expect(db.getStats().methodCount).toBe(1);
    const got = db.getFile(filePath);
    expect(got!.methods[0].returnType).toBe('string');
    expect(got!.methods[0].sourceLine).toBe(10);
  });

  it('deletes methods no longer in the scan', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'del.ts');

    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'A', sourceLine: 1 },
        { name: 'B', sourceLine: 5 },
      ],
    }));
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'A', sourceLine: 1 }],
    }));

    const got = db.getFile(filePath);
    expect(got!.methods).toHaveLength(1);
    expect(got!.methods[0].name).toBe('A');
  });

  it('preserves method_steps set by prior upsertProse', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'preserve.ts');

    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'M', params: '', sourceLine: 1 }],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{
        name: 'M',
        params: '',
        steps: [{ content: 'step 1', depth: 0 }, { content: 'step 2', depth: 0 }],
      }],
    }));

    // Re-run structural — should preserve the steps
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'M', params: '', returnType: 'void', sourceLine: 5 }],
    }));

    const got = db.getFile(filePath);
    expect(got!.methods[0].steps).toHaveLength(2);
    expect(got!.methods[0].steps[0].content).toBe('step 1');
    expect(got!.methods[0].sourceLine).toBe(5); // structural still updated
  });

  it('updates source_hash on re-upsert', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'hash.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      sourceHash: 'hash1',
      methods: [{ name: 'a', sourceLine: 1 }],
    }));
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      sourceHash: 'hash2',
      methods: [{ name: 'a', sourceLine: 1 }],
    }));

    // Peek raw db
    const dbPath = join(currentProject, '.collab', 'pseudo', 'pseudo.db');
    const raw = new Database(dbPath);
    const row = raw.prepare('SELECT source_hash FROM files WHERE file_path = ?').get(filePath) as any;
    raw.close();
    expect(row.source_hash).toBe('hash2');
  });
});

// ---------------------------------------------------------------------------
// upsertProse behavior (new tests)
// ---------------------------------------------------------------------------

describe('upsertProse behavior', () => {
  it('updates title/purpose/module_context/has_prose/prose_updated_at', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'prose1.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'foo', sourceLine: 1 }],
    }));
    db.upsertProse(filePath, makeProseData({
      title: 'Prose Title',
      purpose: 'Prose Purpose',
      moduleContext: 'Prose Context',
      methods: [{ name: 'foo', params: '', steps: [{ content: 's', depth: 0 }] }],
    }));

    const state = db.getFileState(filePath);
    expect(state).not.toBeNull();
    expect(state!.hasProse).toBe(true);
    expect(state!.proseUpdatedAt).not.toBeNull();

    const file = db.getFile(filePath);
    expect(file!.title).toBe('Prose Title');
    expect(file!.purpose).toBe('Prose Purpose');
    expect(file!.moduleContext).toBe('Prose Context');
  });

  it('matches methods by name+params for overloads', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'prose2.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'M', params: 'a', sourceLine: 1 },
        { name: 'M', params: 'a, b', sourceLine: 5 },
      ],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{
        name: 'M',
        params: 'a, b',
        steps: [{ content: 'only for M(a, b)', depth: 0 }],
      }],
    }));

    const file = db.getFile(filePath);
    const mAB = file!.methods.find(m => m.params === 'a, b');
    const mA = file!.methods.find(m => m.params === 'a');
    expect(mAB!.steps).toHaveLength(1);
    expect(mA!.steps).toHaveLength(0);
  });

  it('matches by name alone when params not provided', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'prose3.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'onlyOne', sourceLine: 1 }],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'onlyOne', steps: [{ content: 'matched by name', depth: 0 }] }],
    }));

    const file = db.getFile(filePath);
    expect(file!.methods[0].steps).toHaveLength(1);
  });

  it('warns and skips when method does not exist', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'prose4.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'exists', sourceLine: 1 }],
    }));

    expect(() => {
      db.upsertProse(filePath, makeProseData({
        methods: [
          { name: 'exists', steps: [{ content: 's', depth: 0 }] },
          { name: 'doesNotExist', steps: [{ content: 's2', depth: 0 }] },
        ],
      }));
    }).not.toThrow();

    const file = db.getFile(filePath);
    expect(file!.methods).toHaveLength(1);
    expect(file!.methods[0].steps).toHaveLength(1);
  });

  it('logs warning and skips when name matches multiple overloads without params', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'overloads.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'M', params: 'a', sourceLine: 1 },
        { name: 'M', params: 'a, b', sourceLine: 5 },
      ],
    }));

    expect(() => {
      db.upsertProse(filePath, makeProseData({
        methods: [{ name: 'M', steps: [{ content: 'ambiguous', depth: 0 }] }],
      }));
    }).not.toThrow();

    // Neither overload should have steps because the ambiguous case was skipped.
    const file = db.getFile(filePath);
    expect(file!.methods.every(m => m.steps.length === 0)).toBe(true);
  });

  it('does not set hasProse when all methods miss', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'noproseflag.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'foo', sourceLine: 1 },
        { name: 'bar', sourceLine: 5 },
      ],
    }));

    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'baz', steps: [{ content: 'missing method', depth: 0 }] }],
    }));

    const state = db.getFileState(filePath);
    expect(state).not.toBeNull();
    expect(state!.hasProse).toBe(false);
    expect(state!.proseUpdatedAt).toBeNull();
  });

  it('preserves structural fields', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'prose5.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{
        name: 'M',
        params: '',
        visibility: 'private',
        sourceLine: 42,
        kind: 'method',
        isAsync: true,
      }],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'M', params: '', steps: [{ content: 's', depth: 0 }] }],
    }));

    const file = db.getFile(filePath);
    expect(file!.methods[0].visibility).toBe('private');
    expect(file!.methods[0].sourceLine).toBe(42);
    expect(file!.methods[0].kind).toBe('method');
    expect(file!.methods[0].isAsync).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteStructural
// ---------------------------------------------------------------------------

describe('deleteStructural', () => {
  it('deletes file row and cascades', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'delme.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'foo', sourceLine: 1 }],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'foo', steps: [{ content: 's', depth: 0 }] }],
    }));

    db.deleteStructural(filePath);

    expect(db.getFile(filePath)).toBeNull();
    expect(db.getStats().fileCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFileState
// ---------------------------------------------------------------------------

describe('getFileState', () => {
  it('returns null for unknown file', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getFileState(join(currentProject, 'nope.ts'))).toBeNull();
  });

  it('returns methods with hasSteps flags', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'state.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [
        { name: 'A', sourceLine: 1 },
        { name: 'B', sourceLine: 5 },
      ],
    }));
    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'A', steps: [{ content: 's', depth: 0 }] }],
    }));

    const state = db.getFileState(filePath);
    expect(state).not.toBeNull();
    expect(state!.methods).toHaveLength(2);
    const a = state!.methods.find(m => m.name === 'A');
    const b = state!.methods.find(m => m.name === 'B');
    expect(a!.hasSteps).toBe(true);
    expect(b!.hasSteps).toBe(false);
  });

  it('returns proseUpdatedAt and hasProse flags', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'state2.ts');
    db.upsertStructural(filePath, 'typescript', makeScanResult({
      methods: [{ name: 'x', sourceLine: 1 }],
    }));

    let state = db.getFileState(filePath);
    expect(state!.hasProse).toBe(false);
    expect(state!.proseUpdatedAt).toBeNull();

    db.upsertProse(filePath, makeProseData({
      methods: [{ name: 'x', steps: [{ content: 's', depth: 0 }] }],
    }));

    state = db.getFileState(filePath);
    expect(state!.hasProse).toBe(true);
    expect(state!.proseUpdatedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkpointWal
// ---------------------------------------------------------------------------

describe('checkpointWal', () => {
  it('executes without error', () => {
    const db = getPseudoDb(currentProject);
    db.upsertStructural(join(currentProject, 'wal.ts'), 'typescript', makeScanResult({
      methods: [{ name: 'foo', sourceLine: 1 }],
    }));
    expect(() => db.checkpointWal()).not.toThrow();
  });
});
