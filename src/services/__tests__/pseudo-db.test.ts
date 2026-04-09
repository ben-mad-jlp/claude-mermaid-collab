import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'bun:sqlite';
import { getPseudoDb } from '../pseudo-db';

/**
 * Tests for PseudoDbService (schema v1 rewrite)
 *
 * The pseudo-parser has not yet been updated to produce the new ParsedMethod/
 * ParsedPseudoFile shape that pseudo-db expects, so we declare local
 * duck-typed interfaces here and cast when calling upsertFile.
 */

// ---------------------------------------------------------------------------
// Local duck-typed interfaces matching the NEW shape pseudo-db expects
// ---------------------------------------------------------------------------

interface ParsedStep {
  content: string;
  depth: number;
  sortOrder: number;
}

interface ParsedMethod {
  name: string;
  params: string;
  returnType: string;
  isExport: boolean;
  date: string | null;
  calls: Array<{ name: string; fileStem: string }>;
  steps: ParsedStep[];
  sortOrder: number;
  visibility: string | null;
  isAsync: boolean;
  kind: string | null;
  paramCount: number;
  stepCount: number;
  owningSymbol: string | null;
  sourceLine: number | null;
  sourceLineEnd: number | null;
}

interface ParsedPseudoFile {
  title: string;
  purpose: string;
  syncedAt: string | null;
  sourceFilePath: string | null;
  language: string | null;
  moduleContext: string;
  methods: ParsedMethod[];
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_ROOT = join(homedir(), '.test-collab-pseudo-db');

/**
 * Each test gets its own subdirectory (and therefore its own db instance),
 * so we can rely on getPseudoDb's per-project caching without cross-test
 * pollution.
 */
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

function makeParsedFile(
  opts: Omit<Partial<ParsedPseudoFile>, 'methods'> & { methods?: Array<Partial<ParsedMethod>> } = {}
): ParsedPseudoFile {
  return {
    title: opts.title ?? 'Test',
    purpose: opts.purpose ?? 'Test file',
    syncedAt: opts.syncedAt ?? null,
    sourceFilePath: opts.sourceFilePath ?? null,
    language: opts.language ?? null,
    moduleContext: opts.moduleContext ?? '',
    methods: (opts.methods ?? []).map((m, i) => ({
      name: m.name ?? `fn${i}`,
      params: m.params ?? '',
      returnType: m.returnType ?? '',
      isExport: m.isExport ?? false,
      date: m.date ?? null,
      calls: m.calls ?? [],
      steps: m.steps ?? [],
      sortOrder: m.sortOrder ?? i,
      visibility: m.visibility ?? null,
      isAsync: m.isAsync ?? false,
      kind: m.kind ?? null,
      paramCount: m.paramCount ?? 0,
      stepCount: m.stepCount ?? 0,
      owningSymbol: m.owningSymbol ?? null,
      sourceLine: m.sourceLine ?? null,
      sourceLineEnd: m.sourceLineEnd ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PseudoDbService schema migration', () => {
  it('creates fresh schema_version row on first init', () => {
    getPseudoDb(currentProject); // triggers migrate()

    // Peek at the db directly to verify schema_version
    const dbPath = join(currentProject, '.collab', 'pseudo', 'pseudo.db');
    expect(existsSync(dbPath)).toBe(true);

    const raw = new Database(dbPath);
    const row = raw.prepare('SELECT version FROM schema_version WHERE id = 1').get() as any;
    raw.close();

    expect(row).toBeTruthy();
    expect(row.version).toBe(1);
  });

  it('is idempotent across re-init (same project path)', () => {
    // Two calls with the same project path return the cached instance; still must not throw.
    expect(() => {
      getPseudoDb(currentProject);
      getPseudoDb(currentProject);
    }).not.toThrow();

    const stats = getPseudoDb(currentProject).getStats();
    expect(stats.fileCount).toBe(0);
  });
});

describe('upsertFile + getFile', () => {
  it('round-trips a simple file', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'foo.pseudo');

    const parsed = makeParsedFile({
      title: 'Foo',
      purpose: 'Does foo things',
      moduleContext: 'module stuff',
      methods: [
        {
          name: 'doFoo',
          params: 'x: number',
          returnType: 'string',
          isExport: true,
          steps: [{ content: 'return "bar"', depth: 0, sortOrder: 0 }],
          stepCount: 1,
          paramCount: 1,
        },
      ],
    });

    db.upsertFile(filePath, parsed as any);

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
    expect(got!.methods[0].steps).toEqual([{ content: 'return "bar"', depth: 0 }]);
  });

  it('returns null for unknown file', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getFile('/nonexistent/path.pseudo')).toBeNull();
  });

  it('handles overloaded methods (same name in same file)', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'over.pseudo');

    const parsed = makeParsedFile({
      methods: [
        { name: 'foo', params: 'x: number', sortOrder: 0 },
        { name: 'foo', params: 'x: string, y: number', sortOrder: 1 },
      ],
    });

    expect(() => db.upsertFile(filePath, parsed as any)).not.toThrow();

    const got = db.getFile(filePath);
    expect(got).not.toBeNull();
    expect(got!.methods).toHaveLength(2);
    const paramsSeen = got!.methods.map(m => m.params).sort();
    expect(paramsSeen).toEqual(['x: number', 'x: string, y: number']);
  });

  it('persists new metadata columns (visibility, isAsync, kind, sourceLine)', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'meta.pseudo');

    const parsed = makeParsedFile({
      methods: [
        {
          name: 'myMethod',
          visibility: 'private',
          isAsync: true,
          kind: 'method',
          sourceLine: 42,
          sourceLineEnd: 57,
          owningSymbol: 'MyClass',
        },
      ],
    });

    db.upsertFile(filePath, parsed as any);

    const got = db.getFile(filePath);
    expect(got).not.toBeNull();
    const m = got!.methods[0];
    expect(m.visibility).toBe('private');
    expect(m.isAsync).toBe(true);
    expect(m.kind).toBe('method');
    expect(m.sourceLine).toBe(42);
    expect(m.sourceLineEnd).toBe(57);
    expect(m.owningSymbol).toBe('MyClass');
  });
});

describe('getStats', () => {
  it('returns zero counts for empty db', () => {
    const db = getPseudoDb(currentProject);
    const stats = db.getStats();
    expect(stats).toEqual({ fileCount: 0, methodCount: 0, exportCount: 0 });
  });

  it('counts files, methods, exports', () => {
    const db = getPseudoDb(currentProject);

    const fileA = join(currentProject, 'a.pseudo');
    const fileB = join(currentProject, 'b.pseudo');

    db.upsertFile(fileA, makeParsedFile({
      methods: [
        { name: 'a1', isExport: true },
        { name: 'a2', isExport: true },
        { name: 'a3', isExport: false },
      ],
    }) as any);

    db.upsertFile(fileB, makeParsedFile({
      methods: [
        { name: 'b1', isExport: true },
        { name: 'b2', isExport: true },
        { name: 'b3', isExport: false },
      ],
    }) as any);

    const stats = db.getStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.methodCount).toBe(6);
    expect(stats.exportCount).toBe(4);
  });
});

describe('getCallGraph', () => {
  it('resolves edges using callee_method_id (no stem collision bug)', () => {
    const db = getPseudoDb(currentProject);

    // Two files with the same stem ("util") in different directories.
    // The caller in dirA/util.pseudo calls target() in stem "helper" which
    // only exists at dirB/helper.pseudo. The stale/naive stem join would have
    // matched either "helper" file; the resolved callee_method_id must point
    // to the specific method we inserted.
    const callerPath = join(currentProject, 'dirA', 'util.pseudo');
    const helperAPath = join(currentProject, 'dirA', 'helper.pseudo');
    const helperBPath = join(currentProject, 'dirB', 'helper.pseudo');

    // helperA has NO "target" method; helperB has it. Stem is "helper" for both.
    db.upsertFile(helperAPath, makeParsedFile({
      methods: [{ name: 'other', isExport: true }],
    }) as any);

    db.upsertFile(helperBPath, makeParsedFile({
      methods: [{ name: 'target', isExport: true }],
    }) as any);

    db.upsertFile(callerPath, makeParsedFile({
      methods: [
        {
          name: 'callIt',
          calls: [{ name: 'target', fileStem: 'helper' }],
        },
      ],
    }) as any);

    const graph = db.getCallGraph();

    // Must have at least one edge from callIt -> target
    const edge = graph.edges.find(
      e => e.source === `${callerPath}::callIt`
    );
    expect(edge).toBeTruthy();
    // The target should resolve to one of the two helper files (whichever has
    // the target method). We only inserted target in helperB, so edges
    // pointing to helperA would indicate the bug.
    expect(edge!.target).toBe(`${helperBPath}::target`);

    // And there should be exactly one outbound edge from callIt
    const outbound = graph.edges.filter(e => e.source === `${callerPath}::callIt`);
    expect(outbound).toHaveLength(1);
  });
});

describe('getSourceLink', () => {
  it('returns empty array when name not found', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getSourceLink('doesNotExist')).toEqual([]);
  });

  it('returns candidate with sourceLine when method has sourceLine', () => {
    const db = getPseudoDb(currentProject);

    // Create a matching source file so resolveSourceFilePath can find it.
    const srcPath = join(currentProject, 'real.ts');
    // Put `findMe` on line 10 so the auto-scan finds it there.
    writeFileSync(srcPath, [
      '// header line 1',
      '// header line 2',
      '// header line 3',
      '// header line 4',
      '// header line 5',
      '// header line 6',
      '// header line 7',
      '// header line 8',
      '',
      'export function findMe() {',
      '  return 1;',
      '}',
    ].join('\n'));

    const pseudoPath = join(currentProject, 'real.pseudo');
    db.upsertFile(pseudoPath, makeParsedFile({
      sourceFilePath: srcPath,
      language: 'typescript',
      methods: [
        {
          name: 'findMe',
          isExport: true,
        },
      ],
    }) as any);

    const results = db.getSourceLink('findMe');
    expect(results).toHaveLength(1);
    expect(results[0].sourceLine).toBe(10);
    expect(results[0].isExported).toBe(true);
    expect(results[0].sourceFilePath).toBe(srcPath);
  });

  it('filters by hintFileStem when provided', () => {
    const db = getPseudoDb(currentProject);

    // Two files, both defining "sharedName", with different file stems.
    const srcA = join(currentProject, 'alpha.ts');
    const srcB = join(currentProject, 'beta.ts');
    writeFileSync(srcA, 'export function sharedName() {}\n');
    writeFileSync(srcB, 'export function sharedName() {}\n');

    db.upsertFile(join(currentProject, 'alpha.pseudo'), makeParsedFile({
      sourceFilePath: srcA,
      methods: [{ name: 'sharedName', sourceLine: 1 }],
    }) as any);

    db.upsertFile(join(currentProject, 'beta.pseudo'), makeParsedFile({
      sourceFilePath: srcB,
      methods: [{ name: 'sharedName', sourceLine: 2 }],
    }) as any);

    const unfiltered = db.getSourceLink('sharedName');
    expect(unfiltered).toHaveLength(2);

    const filtered = db.getSourceLink('sharedName', 'alpha');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceFilePath).toBe(srcA);
  });
});

describe('getCoverage', () => {
  it('returns zero when no source files walked', () => {
    const db = getPseudoDb(currentProject);
    // currentProject is empty (only the .collab dir is inside it)
    const report = db.getCoverage();
    expect(report.totalFiles).toBe(0);
    expect(report.coveredFiles).toBe(0);
    expect(report.percent).toBe(0);
    expect(report.missingFiles).toEqual([]);
  });

  it('reports covered vs missing files', () => {
    const db = getPseudoDb(currentProject);

    // Create two .ts files on disk
    const srcDir = join(currentProject, 'src');
    mkdirSync(srcDir, { recursive: true });
    const coveredSrc = join(srcDir, 'covered.ts');
    const missingSrc = join(srcDir, 'missing.ts');
    writeFileSync(coveredSrc, 'export function a() {}\n');
    writeFileSync(missingSrc, 'export function b() {}\n');

    // Upsert pseudo pointing at the covered source file
    db.upsertFile(join(currentProject, 'covered.pseudo'), makeParsedFile({
      sourceFilePath: coveredSrc,
      methods: [{ name: 'a', isExport: true }],
    }) as any);

    const report = db.getCoverage();
    expect(report.totalFiles).toBe(2);
    expect(report.coveredFiles).toBe(1);
    expect(report.percent).toBe(50);
    expect(report.missingFiles).toHaveLength(1);
    expect(report.missingFiles[0]).toContain('missing.ts');
  });
});

describe('getExports (renamed field)', () => {
  it('returns stepSummary not purpose', () => {
    const db = getPseudoDb(currentProject);
    const filePath = join(currentProject, 'ex.pseudo');

    db.upsertFile(filePath, makeParsedFile({
      methods: [
        {
          name: 'exportedFn',
          isExport: true,
          steps: [
            { content: 'do step 1', depth: 0, sortOrder: 0 },
            { content: 'do step 2', depth: 0, sortOrder: 1 },
          ],
        },
        {
          name: 'notExported',
          isExport: false,
        },
      ],
    }) as any);

    const exports = db.getExports();
    expect(exports).toHaveLength(1);

    const entry = exports[0];
    expect(entry.methodName).toBe('exportedFn');
    expect(entry.filePath).toBe(filePath);

    // New field name
    expect(entry).toHaveProperty('stepSummary');
    expect(entry.stepSummary).toContain('do step 1');
    expect(entry.stepSummary).toContain('do step 2');

    // Old field name must be gone
    expect(entry).not.toHaveProperty('purpose');
  });
});

describe('scanSourceFileForLines', () => {
  it('populates sourceLine for TS function definitions', () => {
    const db = getPseudoDb(currentProject);
    const sourceDir = join(currentProject, 'src');
    mkdirSync(sourceDir, { recursive: true });
    const sourceFile = join(sourceDir, 'auth.ts');
    writeFileSync(sourceFile, [
      'import { foo } from "bar";',
      '',
      'export function login(email: string): void {',
      '  console.log(email);',
      '}',
      '',
      'export async function logout(): Promise<void> {',
      '  return;',
      '}',
    ].join('\n'));

    const parsed = makeParsedFile({
      sourceFilePath: sourceFile,
      language: 'typescript',
      methods: [
        { name: 'login', params: 'email', isExport: true },
        { name: 'logout', params: '', isExport: true, isAsync: true },
      ],
    });

    db.upsertFile(join(sourceDir, 'auth.pseudo'), parsed as any);

    const got = db.getFile(join(sourceDir, 'auth.pseudo'));
    expect(got).not.toBeNull();
    expect(got!.methods[0].sourceLine).toBe(3);
    expect(got!.methods[1].sourceLine).toBe(7);
  });

  it('leaves sourceLine null when language is not TS/C#/C++/Python', () => {
    const db = getPseudoDb(currentProject);
    const sourceDir = join(currentProject, 'src');
    mkdirSync(sourceDir, { recursive: true });
    const sourceFile = join(sourceDir, 'foo.xyz');
    writeFileSync(sourceFile, 'function login() {}');

    const parsed = makeParsedFile({
      sourceFilePath: sourceFile,
      language: 'haskell',
      methods: [{ name: 'login', isExport: true }],
    });

    db.upsertFile(join(sourceDir, 'foo.pseudo'), parsed as any);

    const got = db.getFile(join(sourceDir, 'foo.pseudo'));
    expect(got!.methods[0].sourceLine).toBeNull();
  });

  it('populates sourceLine for Python def', () => {
    const db = getPseudoDb(currentProject);
    const sourceDir = join(currentProject, 'src');
    mkdirSync(sourceDir, { recursive: true });
    const sourceFile = join(sourceDir, 'auth.py');
    writeFileSync(sourceFile, [
      'import os',
      '',
      'def login(email):',
      '    pass',
    ].join('\n'));

    const parsed = makeParsedFile({
      sourceFilePath: sourceFile,
      language: 'python',
      methods: [{ name: 'login', isExport: true }],
    });

    db.upsertFile(join(sourceDir, 'auth.pseudo'), parsed as any);
    const got = db.getFile(join(sourceDir, 'auth.pseudo'));
    expect(got!.methods[0].sourceLine).toBe(3);
  });
});

describe('getFunctionsForSource', () => {
  it('returns empty array for unknown source path', () => {
    const db = getPseudoDb(currentProject);
    expect(db.getFunctionsForSource('/no/such/file.ts')).toEqual([]);
  });

  it('returns methods for a seeded file ordered by sourceLine', () => {
    const db = getPseudoDb(currentProject);
    const sourceDir = join(currentProject, 'src');
    mkdirSync(sourceDir, { recursive: true });
    const srcPath = join(sourceDir, 'auth.ts');
    // Use 'haskell' language so scanSourceFileForLines skips and preset values are preserved.
    writeFileSync(srcPath, 'placeholder');

    const pseudoPath = join(sourceDir, 'auth.pseudo');
    db.upsertFile(pseudoPath, makeParsedFile({
      sourceFilePath: srcPath,
      language: 'haskell',
      methods: [
        {
          name: 'second',
          params: 'x: number',
          returnType: 'void',
          isExport: false,
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
          isExport: true,
          sourceLine: 5,
          sourceLineEnd: 10,
        },
      ],
    }) as any);

    const functions = db.getFunctionsForSource(srcPath);
    expect(functions).toHaveLength(2);
    // Ordered by source_line asc: first (line 5) before second (line 20)
    expect(functions[0].name).toBe('first');
    expect(functions[0].sourceLine).toBe(5);
    expect(functions[0].sourceLineEnd).toBe(10);
    expect(functions[0].isExported).toBe(true);
    expect(functions[0].returnType).toBe('string');

    expect(functions[1].name).toBe('second');
    expect(functions[1].sourceLine).toBe(20);
    expect(functions[1].sourceLineEnd).toBe(25);
    expect(functions[1].isExported).toBe(false);
    expect(functions[1].visibility).toBe('public');
    expect(functions[1].isAsync).toBe(true);
    expect(functions[1].kind).toBe('method');
  });
});

describe('getReferences (includes sourceLine)', () => {
  it('returns source_line from the caller method', () => {
    const db = getPseudoDb(currentProject);
    const sourceDir = join(currentProject, 'src');
    mkdirSync(sourceDir, { recursive: true });

    // Target file — 'target' stem.
    writeFileSync(join(sourceDir, 'target.ts'), 'placeholder');
    db.upsertFile(join(sourceDir, 'target.pseudo'), makeParsedFile({
      sourceFilePath: join(sourceDir, 'target.ts'),
      language: 'haskell',
      methods: [{ name: 'targetFn', isExport: true }],
    }) as any);

    // Caller file — calls targetFn.
    writeFileSync(join(sourceDir, 'caller.ts'), 'placeholder');
    db.upsertFile(join(sourceDir, 'caller.pseudo'), makeParsedFile({
      sourceFilePath: join(sourceDir, 'caller.ts'),
      language: 'haskell',
      methods: [
        {
          name: 'callerFn',
          sourceLine: 15,
          calls: [{ name: 'targetFn', fileStem: 'target' }],
        },
      ],
    }) as any);

    const refs = db.getReferences('targetFn', 'target');
    expect(refs).toHaveLength(1);
    expect(refs[0].file).toBe(join(sourceDir, 'caller.pseudo'));
    expect(refs[0].callerMethod).toBe('callerFn');
    expect(refs[0].sourceLine).toBe(15);
  });
});
