import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePseudoAPI } from './pseudo-api';
import { getPseudoDb } from '../services/pseudo-db';

function makeParsedFile(opts: any = {}): any {
  return {
    title: opts.title ?? 'T',
    purpose: opts.purpose ?? 'P',
    syncedAt: opts.syncedAt ?? null,
    sourceFilePath: opts.sourceFilePath ?? null,
    language: opts.language ?? null,
    moduleContext: opts.moduleContext ?? '',
    methods: (opts.methods ?? []).map((m: any, i: number) => ({
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
      stepCount: m.stepCount ?? (m.steps?.length ?? 0),
      owningSymbol: m.owningSymbol ?? null,
      sourceLine: m.sourceLine ?? null,
      sourceLineEnd: m.sourceLineEnd ?? null,
    })),
  };
}

describe('Pseudo API Routes', () => {
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = join(tmpdir(), `test-pseudo-project-${Date.now()}`);
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('Missing project parameter', () => {
    it('should return 400 when project parameter is missing', async () => {
      const req = new Request('http://localhost/api/pseudo/files', { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('project');
    });
  });

  describe('GET /api/pseudo/files', () => {
    it('should return empty list when no .pseudo files exist', async () => {
      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.files).toEqual([]);
    });

    it('should return list of .pseudo files with extensions stripped', async () => {
      // Create some .pseudo files
      await writeFile(join(testProjectPath, 'auth.pseudo'), 'FUNCTION auth()');
      await writeFile(join(testProjectPath, 'utils.pseudo'), 'FUNCTION helper()');
      await writeFile(join(testProjectPath, 'other.txt'), 'not a pseudo file');

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.files).toHaveLength(2);
      expect(data.files).toContain('auth');
      expect(data.files).toContain('utils');
      expect(data.files).not.toContain('other.txt');
    });

    it('should return files sorted alphabetically', async () => {
      // Create files in non-alphabetical order
      await writeFile(join(testProjectPath, 'zebra.pseudo'), 'FUNCTION z()');
      await writeFile(join(testProjectPath, 'apple.pseudo'), 'FUNCTION a()');
      await writeFile(join(testProjectPath, 'banana.pseudo'), 'FUNCTION b()');

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.files).toEqual(['apple', 'banana', 'zebra']);
    });

    it('should scan recursively in subdirectories', async () => {
      // Create nested .pseudo files
      const subdir = join(testProjectPath, 'subdir');
      await mkdir(subdir, { recursive: true });
      await writeFile(join(testProjectPath, 'root.pseudo'), 'FUNCTION root()');
      await writeFile(join(subdir, 'nested.pseudo'), 'FUNCTION nested()');

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.files).toHaveLength(2);
      expect(data.files).toContain('root');
      expect(data.files).toContain('subdir/nested');
    });
  });

  describe('GET /api/pseudo/file', () => {
    it('should return 400 when file parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return 404 when file does not exist', async () => {
      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return file content and path', async () => {
      const content = 'FUNCTION test()\n  return 42\nEND FUNCTION';
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=test`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe(content);
      expect(data.path).toBeDefined();
      expect(data.path).toContain('test.pseudo');
    });

    it('should handle nested file paths', async () => {
      const subdir = join(testProjectPath, 'src', 'lib');
      await mkdir(subdir, { recursive: true });
      const content = 'FUNCTION nested()';
      await writeFile(join(subdir, 'helper.pseudo'), content);

      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=src/lib/helper`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe(content);
    });
  });

  describe('GET /api/pseudo/search', () => {
    it('should return 400 when query parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return empty results when no matches found', async () => {
      await writeFile(join(testProjectPath, 'test.pseudo'), 'FUNCTION foo()');

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.matches).toEqual({});
    });

    it('should find matches case-insensitively', async () => {
      const content = 'FUNCTION test()\n  return DEBUG\nEND FUNCTION';
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=debug`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.matches).toBeDefined();
      expect(Object.keys(data.matches)).toContain('test');
    });

    it('should track current FUNCTION name as it scans', async () => {
      const content = `FUNCTION first()
  print "in first"
END FUNCTION

FUNCTION second()
  print "in second"
END FUNCTION`;
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=print`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.matches.test).toBeDefined();
      expect(data.matches.test).toHaveLength(2);
    });

    it('should flag FUNCTION line matches with isFunctionLine: true', async () => {
      const content = `FUNCTION calculateSum(a, b)
  return a + b
END FUNCTION`;
      await writeFile(join(testProjectPath, 'math.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=calculateSum`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.matches.math).toBeDefined();
      const matches = data.matches.math;
      expect(matches.some((m: any) => m.isFunctionLine === true)).toBe(true);
    });

    it('should sort FUNCTION line matches above body matches', async () => {
      const content = `FUNCTION search()
  print "searching for search"
END FUNCTION`;
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=search`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      const matches = data.matches.test;
      // FUNCTION line should come first
      expect(matches[0].isFunctionLine).toBe(true);
    });

    it('should track CALLS from function lines', async () => {
      const content = `FUNCTION main()
  CALLS helper
  CALLS other
END FUNCTION`;
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=helper`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      const matches = data.matches.test;
      expect(matches.length).toBeGreaterThan(0);
      // Verify the CALLS line is captured
      const callsMatch = matches.find((m: any) => m.line.includes('CALLS'));
      expect(callsMatch).toBeDefined();
    });

    it('should group results by file', async () => {
      await writeFile(join(testProjectPath, 'file1.pseudo'), 'FUNCTION test1()\nCOMPARE items');
      await writeFile(join(testProjectPath, 'file2.pseudo'), 'FUNCTION test2()\nCOMPARE values');

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=compare`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Object.keys(data.matches)).toHaveLength(2);
      expect(data.matches.file1).toBeDefined();
      expect(data.matches.file2).toBeDefined();
    });

    it('should cap results at 50 total matches', async () => {
      let content = '';
      // Create content with 60 matching lines
      for (let i = 0; i < 60; i++) {
        content += `line with target text ${i}\n`;
      }
      await writeFile(join(testProjectPath, 'test.pseudo'), content);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=target`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      const totalMatches = Object.values(data.matches).reduce((sum: number, matches: any) => sum + matches.length, 0);
      expect(totalMatches).toBeLessThanOrEqual(50);
    });

    it('should handle multiple files with complex search', async () => {
      await writeFile(join(testProjectPath, 'auth.pseudo'), `FUNCTION authenticate(user)
  CALLS validatePassword
  CHECK permissions
END FUNCTION`);

      await writeFile(join(testProjectPath, 'utils.pseudo'), `FUNCTION validatePassword()
  CHECK rules
  COMPARE hashes
END FUNCTION`);

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=check`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Object.keys(data.matches).length).toBeGreaterThan(0);
      // Verify matches are found in both files
      const totalMatches = Object.values(data.matches).reduce((sum: number, matches: any) => sum + matches.length, 0);
      expect(totalMatches).toBeGreaterThan(0);
    });
  });

  describe('GET /api/pseudo/stats', () => {
    it('returns zero counts on an empty project', async () => {
      const url = `http://localhost/api/pseudo/stats?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ fileCount: 0, methodCount: 0, exportCount: 0 });
    });

    it('returns correct counts after indexing', async () => {
      const db = getPseudoDb(testProjectPath);
      db.upsertFile('/virtual/a.pseudo', makeParsedFile({
        title: 'A',
        methods: [
          { name: 'foo', isExport: true },
          { name: 'bar', isExport: false },
        ],
      }));
      db.upsertFile('/virtual/b.pseudo', makeParsedFile({
        title: 'B',
        methods: [
          { name: 'baz', isExport: false },
        ],
      }));

      const url = `http://localhost/api/pseudo/stats?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ fileCount: 2, methodCount: 3, exportCount: 1 });
    });
  });

  describe('GET /api/pseudo/source-link', () => {
    it('returns 400 when name parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error).toContain('name');
    });

    it('returns empty candidates when no methods match', async () => {
      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ candidates: [] });
    });

    it('returns candidates for methods with sourceLine', async () => {
      // Source file must exist on disk for pseudo-db to record it
      const srcPath = join(testProjectPath, 'foo.ts');
      await writeFile(srcPath, 'export function foo() {}\n');
      const pseudoPath = join(testProjectPath, 'foo.pseudo');
      await writeFile(pseudoPath, '');

      const db = getPseudoDb(testProjectPath);
      db.upsertFile(pseudoPath, makeParsedFile({
        title: 'Foo',
        sourceFilePath: srcPath,
        language: 'typescript',
        methods: [
          {
            name: 'foo',
            isExport: true,
            sourceLine: 42,
            sourceLineEnd: 58,
          },
        ],
      }));

      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=foo`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.candidates).toHaveLength(1);
      expect(data.candidates[0]).toEqual({
        sourceFilePath: srcPath,
        sourceLine: 42,
        sourceLineEnd: 58,
        language: 'typescript',
        isExported: true,
      });
    });

    it('filters by hintFileStem', async () => {
      const aSrc = join(testProjectPath, 'a.ts');
      const bSrc = join(testProjectPath, 'b.ts');
      await writeFile(aSrc, 'export function foo() {}\n');
      await writeFile(bSrc, 'export function foo() {}\n');
      const aPseudo = join(testProjectPath, 'a.pseudo');
      const bPseudo = join(testProjectPath, 'b.pseudo');
      await writeFile(aPseudo, '');
      await writeFile(bPseudo, '');

      const db = getPseudoDb(testProjectPath);
      db.upsertFile(aPseudo, makeParsedFile({
        title: 'A',
        sourceFilePath: aSrc,
        language: 'typescript',
        methods: [
          { name: 'foo', isExport: true, sourceLine: 10, sourceLineEnd: 20 },
        ],
      }));
      db.upsertFile(bPseudo, makeParsedFile({
        title: 'B',
        sourceFilePath: bSrc,
        language: 'typescript',
        methods: [
          { name: 'foo', isExport: true, sourceLine: 30, sourceLineEnd: 40 },
        ],
      }));

      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=foo&hintFileStem=a`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.candidates).toHaveLength(1);
      expect(data.candidates[0].sourceFilePath).toBe(aSrc);
      expect(data.candidates[0].sourceLine).toBe(10);
    });
  });

  describe('GET /api/pseudo/functions-for-source', () => {
    it('returns 400 when sourcePath parameter is missing', async () => {
      const req = new Request(
        `http://localhost/api/pseudo/functions-for-source?project=${encodeURIComponent(testProjectPath)}`
      );
      const res = await handlePseudoAPI(req);
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toMatch(/sourcePath/i);
    });

    it('returns empty functions array for unknown sourcePath', async () => {
      const req = new Request(
        `http://localhost/api/pseudo/functions-for-source?project=${encodeURIComponent(testProjectPath)}&sourcePath=${encodeURIComponent('/no/such/file.ts')}`
      );
      const res = await handlePseudoAPI(req);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.functions).toEqual([]);
    });

    it('returns seeded functions for a given sourcePath', async () => {
      const db = getPseudoDb(testProjectPath);
      const srcPath = join(testProjectPath, 'module.ts');
      await writeFile(srcPath, 'placeholder');

      const pseudoPath = join(testProjectPath, 'module.pseudo');
      db.upsertFile(pseudoPath, makeParsedFile({
        sourceFilePath: srcPath,
        language: 'haskell',
        methods: [
          {
            name: 'foo',
            isExport: true,
            sourceLine: 1,
            sourceLineEnd: 1,
            params: '',
            returnType: 'void',
          },
        ],
      }) as any);

      const req = new Request(
        `http://localhost/api/pseudo/functions-for-source?project=${encodeURIComponent(testProjectPath)}&sourcePath=${encodeURIComponent(srcPath)}`
      );
      const res = await handlePseudoAPI(req);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.functions).toHaveLength(1);
      expect(data.functions[0].name).toBe('foo');
      expect(data.functions[0].isExported).toBe(true);
      expect(data.functions[0].sourceLine).toBe(1);
    });
  });

  describe('GET /api/pseudo/exports (stepSummary)', () => {
    it('returns empty array on empty project', async () => {
      const url = `http://localhost/api/pseudo/exports?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual([]);
    });

    it('returns entries with stepSummary field (not purpose)', async () => {
      const db = getPseudoDb(testProjectPath);
      db.upsertFile('/virtual/login.pseudo', makeParsedFile({
        title: 'Login',
        methods: [
          {
            name: 'login',
            isExport: true,
            steps: [
              { content: 'Validate credentials', depth: 0, sortOrder: 0 },
              { content: 'Create session', depth: 0, sortOrder: 1 },
            ],
          },
        ],
      }));

      const url = `http://localhost/api/pseudo/exports?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      const entry = data[0];
      expect(entry).toHaveProperty('filePath');
      expect(entry).toHaveProperty('methodName', 'login');
      expect(entry).toHaveProperty('stepSummary');
      expect(entry.stepSummary).toContain('Validate credentials');
      expect(entry.stepSummary).toContain('Create session');
      expect(entry).not.toHaveProperty('purpose');
    });
  });
});
