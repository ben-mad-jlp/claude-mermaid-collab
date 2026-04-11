import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePseudoAPI } from './pseudo-api';
import { getPseudoDb, type ScanResult, type ProseData, type StructuralMethod, type ProseMethod } from '../services/pseudo-db';

function makeScanResult(opts: {
  language?: string;
  lineCount?: number;
  sourceHash?: string;
  methods?: Array<Partial<StructuralMethod>>;
}): ScanResult {
  return {
    language: opts.language ?? 'typescript',
    lineCount: opts.lineCount ?? 10,
    sourceHash: opts.sourceHash ?? 'hash',
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
    title: opts.title ?? 'T',
    purpose: opts.purpose ?? 'P',
    moduleContext: opts.moduleContext ?? '',
    methods: (opts.methods ?? []).map(m => ({
      name: m.name,
      params: m.params,
      steps: m.steps ?? [],
      calls: m.calls ?? [],
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
      const data = await response.json() as any;
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
      const data = await response.json() as any;
      expect(data.files).toEqual([]);
    });

    it('should return list of indexed files', async () => {
      // Seed via DB (post-Phase 3: /files reads from pseudo-db, not disk)
      const authSrc = join(testProjectPath, 'auth.ts');
      const utilsSrc = join(testProjectPath, 'utils.ts');
      await writeFile(authSrc, 'export function auth() {}\n');
      await writeFile(utilsSrc, 'export function helper() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(authSrc, 'typescript', makeScanResult({
        methods: [{ name: 'auth', isExported: true }],
      }));
      db.upsertStructural(utilsSrc, 'typescript', makeScanResult({
        methods: [{ name: 'helper', isExported: true }],
      }));

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.files).toHaveLength(2);
      const paths = data.files.map((f: any) => f.filePath);
      expect(paths).toContain(authSrc);
      expect(paths).toContain(utilsSrc);
    });

    it('should return each file with summary metadata', async () => {
      const aSrc = join(testProjectPath, 'apple.ts');
      const bSrc = join(testProjectPath, 'banana.ts');
      const zSrc = join(testProjectPath, 'zebra.ts');
      await writeFile(aSrc, 'export function a() {}\n');
      await writeFile(bSrc, 'export function b() {}\n');
      await writeFile(zSrc, 'export function z() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(zSrc, 'typescript', makeScanResult({
        methods: [{ name: 'z', isExported: true }],
      }));
      db.upsertStructural(aSrc, 'typescript', makeScanResult({
        methods: [{ name: 'a', isExported: true }],
      }));
      db.upsertStructural(bSrc, 'typescript', makeScanResult({
        methods: [{ name: 'b', isExported: false }],
      }));

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.files).toHaveLength(3);
      // Each entry should have summary fields from PseudoFileSummary
      for (const entry of data.files) {
        expect(entry).toHaveProperty('filePath');
        expect(entry).toHaveProperty('methodCount');
        expect(entry).toHaveProperty('exportCount');
      }
    });

    it('should include files from subdirectories', async () => {
      // Seed files from nested source paths
      const rootSrc = join(testProjectPath, 'root.ts');
      const subdir = join(testProjectPath, 'subdir');
      await mkdir(subdir, { recursive: true });
      const nestedSrc = join(subdir, 'nested.ts');
      await writeFile(rootSrc, 'export function root() {}\n');
      await writeFile(nestedSrc, 'export function nested() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(rootSrc, 'typescript', makeScanResult({
        methods: [{ name: 'root', isExported: true }],
      }));
      db.upsertStructural(nestedSrc, 'typescript', makeScanResult({
        methods: [{ name: 'nested', isExported: true }],
      }));

      const url = `http://localhost/api/pseudo/files?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.files).toHaveLength(2);
      const paths = data.files.map((f: any) => f.filePath);
      expect(paths).toContain(rootSrc);
      expect(paths).toContain(nestedSrc);
    });
  });

  describe('GET /api/pseudo/file', () => {
    it('should return 400 when file parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
    });

    it('should return 404 when file does not exist', async () => {
      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
    });

    it('should return file with methods by stem lookup', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function test() { return 42; }\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          { name: 'test', isExported: true, sourceLine: 1, sourceLineEnd: 1, returnType: 'number' },
        ],
      }));
      db.upsertProse(srcPath, makeProseData({
        title: 'Test Module',
        purpose: 'Test file',
        methods: [
          {
            name: 'test',
            params: '',
            steps: [{ content: 'return 42', depth: 0 }],
          },
        ],
      }));

      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=test`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.filePath).toBe(srcPath);
      expect(data.title).toBe('Test Module');
      expect(Array.isArray(data.methods)).toBe(true);
      expect(data.methods).toHaveLength(1);
      expect(data.methods[0].name).toBe('test');
    });

    it('should handle nested file paths via exact filePath lookup', async () => {
      const subdir = join(testProjectPath, 'src', 'lib');
      await mkdir(subdir, { recursive: true });
      const srcPath = join(subdir, 'helper.ts');
      await writeFile(srcPath, 'export function nested() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          { name: 'nested', isExported: true, sourceLine: 1, sourceLineEnd: 1 },
        ],
      }));

      const url = `http://localhost/api/pseudo/file?project=${encodeURIComponent(testProjectPath)}&file=${encodeURIComponent(srcPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.filePath).toBe(srcPath);
      expect(data.methods).toHaveLength(1);
      expect(data.methods[0].name).toBe('nested');
    });
  });

  describe('GET /api/pseudo/search', () => {
    it('should return 400 when query parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
    });

    it('should return empty results when no matches found', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function foo() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [{ name: 'foo', isExported: true }],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [{ name: 'foo', params: '', steps: [{ content: 'do something', depth: 0 }] }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches).toEqual([]);
    });

    it('should find matches case-insensitively', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function test() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [{ name: 'test', isExported: true }],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [{
          name: 'test',
          params: '',
          steps: [{ content: 'return DEBUG value', depth: 0 }],
        }],
      }));

      // FTS uses porter stemmer + unicode61 which lowercases tokens
      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=debug`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      expect(data.matches[0].filePath).toBe(srcPath);
    });

    it('should return a SearchResult for each matching method', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function first() {}\nexport function second() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          { name: 'first', isExported: true },
          { name: 'second', isExported: true },
        ],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [
          { name: 'first', params: '', steps: [{ content: 'print "in first"', depth: 0 }] },
          { name: 'second', params: '', steps: [{ content: 'print "in second"', depth: 0 }] },
        ],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=print`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      // Both methods contain "print" in their steps, so both should match
      expect(data.matches).toHaveLength(2);
      const methodNames = data.matches.map((m: any) => m.methodName).sort();
      expect(methodNames).toEqual(['first', 'second']);
    });

    it('should match on method name', async () => {
      const srcPath = join(testProjectPath, 'math.ts');
      await writeFile(srcPath, 'export function calculateSum(a, b) {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [{ name: 'calculateSum', isExported: true, params: 'a, b' }],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [{ name: 'calculateSum', params: 'a, b', steps: [{ content: 'return a + b', depth: 0 }] }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=calculateSum`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      expect(data.matches.some((m: any) => m.methodName === 'calculateSum')).toBe(true);
    });

    it('should include snippet and rank in each result', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function search() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [{ name: 'search', isExported: true }],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [{ name: 'search', params: '', steps: [{ content: 'searching for search term', depth: 0 }] }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=search`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      const first = data.matches[0];
      expect(first).toHaveProperty('filePath');
      expect(first).toHaveProperty('methodName');
      expect(first).toHaveProperty('snippet');
      expect(first).toHaveProperty('rank');
    });

    it('should match step content containing search term', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function main() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [{ name: 'main', isExported: true }],
      }));
      db.upsertProse(srcPath, makeProseData({
        methods: [{
          name: 'main',
          params: '',
          steps: [
            { content: 'CALLS helper', depth: 0 },
            { content: 'CALLS other', depth: 0 },
          ],
          calls: [
            { name: 'helper', fileStem: 'test' },
            { name: 'other', fileStem: 'test' },
          ],
        }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=helper`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      // The snippet should highlight the matching token
      expect(data.matches.some((m: any) => m.methodName === 'main')).toBe(true);
    });

    it('should return matches across multiple files', async () => {
      const file1Src = join(testProjectPath, 'file1.ts');
      const file2Src = join(testProjectPath, 'file2.ts');
      await writeFile(file1Src, 'export function test1() {}\n');
      await writeFile(file2Src, 'export function test2() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(file1Src, 'typescript', makeScanResult({
        methods: [{ name: 'test1', isExported: true }],
      }));
      db.upsertStructural(file2Src, 'typescript', makeScanResult({
        methods: [{ name: 'test2', isExported: true }],
      }));
      db.upsertProse(file1Src, makeProseData({
        methods: [{ name: 'test1', params: '', steps: [{ content: 'COMPARE items', depth: 0 }] }],
      }));
      db.upsertProse(file2Src, makeProseData({
        methods: [{ name: 'test2', params: '', steps: [{ content: 'COMPARE values', depth: 0 }] }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=compare`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches).toHaveLength(2);
      const filePaths = data.matches.map((m: any) => m.filePath).sort();
      expect(filePaths).toEqual([file1Src, file2Src].sort());
    });

    it('should cap results at 50 total matches', async () => {
      const srcPath = join(testProjectPath, 'test.ts');
      await writeFile(srcPath, 'export function test() {}\n');

      const db = getPseudoDb(testProjectPath);
      // Seed 60 methods each containing the term "target"
      const methods = Array.from({ length: 60 }, (_, i) => ({
        name: `fn${i}`,
        isExported: false,
      }));
      db.upsertStructural(srcPath, 'typescript', makeScanResult({ methods }));
      db.upsertProse(srcPath, makeProseData({
        methods: methods.map((_, i) => ({
          name: `fn${i}`,
          params: '',
          steps: [{ content: `line with target text ${i}`, depth: 0 }],
        })),
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=target`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeLessThanOrEqual(50);
    });

    it('should handle multiple files with complex search', async () => {
      const authSrc = join(testProjectPath, 'auth.ts');
      const utilsSrc = join(testProjectPath, 'utils.ts');
      await writeFile(authSrc, 'export function authenticate(user) {}\n');
      await writeFile(utilsSrc, 'export function validatePassword() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(authSrc, 'typescript', makeScanResult({
        methods: [{ name: 'authenticate', isExported: true, params: 'user' }],
      }));
      db.upsertStructural(utilsSrc, 'typescript', makeScanResult({
        methods: [{ name: 'validatePassword', isExported: true }],
      }));
      db.upsertProse(authSrc, makeProseData({
        methods: [{
          name: 'authenticate',
          params: 'user',
          steps: [
            { content: 'CALLS validatePassword', depth: 0 },
            { content: 'CHECK permissions', depth: 0 },
          ],
        }],
      }));
      db.upsertProse(utilsSrc, makeProseData({
        methods: [{
          name: 'validatePassword',
          params: '',
          steps: [
            { content: 'CHECK rules', depth: 0 },
            { content: 'COMPARE hashes', depth: 0 },
          ],
        }],
      }));

      const url = `http://localhost/api/pseudo/search?project=${encodeURIComponent(testProjectPath)}&q=check`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      // Verify matches come from both files
      const filePaths = new Set(data.matches.map((m: any) => m.filePath));
      expect(filePaths.size).toBe(2);
    });
  });

  describe('GET /api/pseudo/stats', () => {
    it('returns zero counts on an empty project', async () => {
      const url = `http://localhost/api/pseudo/stats?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data).toEqual({ fileCount: 0, methodCount: 0, exportCount: 0 });
    });

    it('returns correct counts after indexing', async () => {
      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(join(testProjectPath, 'a.ts'), 'typescript', makeScanResult({
        methods: [
          { name: 'foo', isExported: true },
          { name: 'bar', isExported: false },
        ],
      }));
      db.upsertStructural(join(testProjectPath, 'b.ts'), 'typescript', makeScanResult({
        methods: [
          { name: 'baz', isExported: false },
        ],
      }));

      const url = `http://localhost/api/pseudo/stats?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data).toEqual({ fileCount: 2, methodCount: 3, exportCount: 1 });
    });
  });

  describe('GET /api/pseudo/source-link', () => {
    it('returns 400 when name parameter is missing', async () => {
      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBeDefined();
      expect(data.error).toContain('name');
    });

    it('returns empty candidates when no methods match', async () => {
      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=nonexistent`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data).toEqual({ candidates: [] });
    });

    it('returns candidates for methods with sourceLine', async () => {
      // Source file must exist on disk for pseudo-db to record it
      const srcPath = join(testProjectPath, 'foo.ts');
      await writeFile(srcPath, 'export function foo() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          {
            name: 'foo',
            isExported: true,
            sourceLine: 42,
            sourceLineEnd: 58,
          },
        ],
      }));

      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=foo`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
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

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(aSrc, 'typescript', makeScanResult({
        methods: [
          { name: 'foo', isExported: true, sourceLine: 10, sourceLineEnd: 20 },
        ],
      }));
      db.upsertStructural(bSrc, 'typescript', makeScanResult({
        methods: [
          { name: 'foo', isExported: true, sourceLine: 30, sourceLineEnd: 40 },
        ],
      }));

      const url = `http://localhost/api/pseudo/source-link?project=${encodeURIComponent(testProjectPath)}&name=foo&hintFileStem=a`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
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

      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          {
            name: 'foo',
            isExported: true,
            sourceLine: 1,
            sourceLineEnd: 1,
            params: '',
            returnType: 'void',
          },
        ],
      }));

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
      const data = await response.json() as any;
      expect(data).toEqual([]);
    });

    it('returns entries with stepSummary field (not purpose)', async () => {
      const srcPath = join(testProjectPath, 'login.ts');
      await writeFile(srcPath, 'export function login() {}\n');

      const db = getPseudoDb(testProjectPath);
      db.upsertStructural(srcPath, 'typescript', makeScanResult({
        methods: [
          { name: 'login', isExported: true },
        ],
      }));
      db.upsertProse(srcPath, makeProseData({
        title: 'Login',
        methods: [
          {
            name: 'login',
            params: '',
            steps: [
              { content: 'Validate credentials', depth: 0 },
              { content: 'Create session', depth: 0 },
            ],
          },
        ],
      }));

      const url = `http://localhost/api/pseudo/exports?project=${encodeURIComponent(testProjectPath)}`;
      const req = new Request(url, { method: 'GET' });
      const response = await handlePseudoAPI(req);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
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
