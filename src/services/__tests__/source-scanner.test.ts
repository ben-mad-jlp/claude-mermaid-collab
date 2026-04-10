import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { scanSourceFile, isSupportedExtension, countParams } from '../source-scanner';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'source-scanner-test-' + Date.now());

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return path;
}

describe('isSupportedExtension', () => {
  it('accepts TS/JS variants', () => {
    expect(isSupportedExtension('.ts')).toBe(true);
    expect(isSupportedExtension('.tsx')).toBe(true);
    expect(isSupportedExtension('.js')).toBe(true);
    expect(isSupportedExtension('.jsx')).toBe(true);
    expect(isSupportedExtension('.mjs')).toBe(true);
  });
  it('accepts C# / C++ / Python', () => {
    expect(isSupportedExtension('.cs')).toBe(true);
    expect(isSupportedExtension('.cpp')).toBe(true);
    expect(isSupportedExtension('.h')).toBe(true);
    expect(isSupportedExtension('.py')).toBe(true);
  });
  it('rejects unknown extensions', () => {
    expect(isSupportedExtension('.txt')).toBe(false);
    expect(isSupportedExtension('.md')).toBe(false);
  });
});

describe('scanSourceFile — guards', () => {
  it('returns null for nonexistent file', () => {
    expect(scanSourceFile(join(TEST_DIR, 'nope.ts'))).toBeNull();
  });

  it('returns null for unsupported extension', () => {
    const path = writeTmp('test.txt', 'hello');
    expect(scanSourceFile(path)).toBeNull();
  });

  it('returns ScanResult for empty file', () => {
    const path = writeTmp('empty.ts', '');
    const result = scanSourceFile(path);
    expect(result).not.toBeNull();
    expect(result!.methods).toEqual([]);
    expect(result!.language).toBe('typescript');
    expect(result!.sourceHash).toHaveLength(16);
  });

  it('computes stable sourceHash for same content', () => {
    const p1 = writeTmp('same1.ts', 'const x = 1;');
    const p2 = writeTmp('same2.ts', 'const x = 1;');
    const r1 = scanSourceFile(p1);
    const r2 = scanSourceFile(p2);
    expect(r1?.sourceHash).toBe(r2?.sourceHash);
  });
});

describe('scanTypeScript — function declarations', () => {
  it('extracts simple function decl', () => {
    const path = writeTmp('fn.ts', 'function foo() {\n  return 1;\n}\n');
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(1);
    const m = result!.methods[0];
    expect(m.name).toBe('foo');
    expect(m.kind).toBe('function');
    expect(m.isExported).toBe(false);
    expect(m.isAsync).toBe(false);
    expect(m.sourceLine).toBe(1);
    expect(m.sourceLineEnd).toBe(3);
    expect(m.owningSymbol).toBeNull();
  });

  it('extracts exported async function with return type', () => {
    const path = writeTmp('fn2.ts', 'export async function bar(x: number): Promise<string> { return ""; }\n');
    const result = scanSourceFile(path);
    const m = result!.methods[0];
    expect(m.name).toBe('bar');
    expect(m.isExported).toBe(true);
    expect(m.isAsync).toBe(true);
    expect(m.returnType).toBe('Promise<string>');
    expect(m.params).toBe('x: number');
  });

  it('extracts function with multiple params', () => {
    const path = writeTmp('fn3.ts', 'function baz(a: number, b: string, c: boolean) {}\n');
    const result = scanSourceFile(path);
    expect(result!.methods[0].params).toBe('a: number, b: string, c: boolean');
  });
});

describe('scanTypeScript — arrow functions', () => {
  it('extracts const arrow as callback', () => {
    const path = writeTmp('arr.ts', 'const fn = () => 1;\n');
    const result = scanSourceFile(path);
    expect(result!.methods[0].name).toBe('fn');
    expect(result!.methods[0].kind).toBe('callback');
  });

  it('extracts exported async arrow', () => {
    const path = writeTmp('arr2.ts', 'export const go = async () => {};\n');
    const result = scanSourceFile(path);
    const m = result!.methods[0];
    expect(m.isExported).toBe(true);
    expect(m.isAsync).toBe(true);
    expect(m.kind).toBe('callback');
  });
});

describe('scanTypeScript — classes', () => {
  it('extracts class methods with owningSymbol', () => {
    const path = writeTmp('cls.ts', [
      'class Foo {',
      '  bar() {',
      '    return 1;',
      '  }',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(1);
    expect(result!.methods[0].name).toBe('bar');
    expect(result!.methods[0].owningSymbol).toBe('Foo');
    expect(result!.methods[0].kind).toBe('method');
  });

  it('parses visibility modifiers', () => {
    const path = writeTmp('cls2.ts', [
      'class Foo {',
      '  public a() {}',
      '  private b() {}',
      '  protected c() {}',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(3);
    expect(result!.methods[0].visibility).toBe('public');
    expect(result!.methods[1].visibility).toBe('private');
    expect(result!.methods[2].visibility).toBe('protected');
  });

  it('extracts constructor with correct kind', () => {
    const path = writeTmp('cls3.ts', [
      'class Foo {',
      '  constructor(x: number) {}',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods[0].name).toBe('constructor');
    expect(result!.methods[0].kind).toBe('constructor');
  });

  it('pops class stack after class closes', () => {
    const path = writeTmp('cls4.ts', [
      'class Foo {',
      '  bar() {}',
      '}',
      '',
      'function topLevel() {}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(2);
    expect(result!.methods[0].owningSymbol).toBe('Foo');
    expect(result!.methods[1].owningSymbol).toBeNull();
  });
});

describe('scanTypeScript — brace matching', () => {
  it('computes sourceLineEnd for multi-line function', () => {
    const path = writeTmp('multi.ts', [
      'function outer() {',
      '  if (true) {',
      '    doStuff();',
      '  }',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods[0].sourceLineEnd).toBe(5);
  });

  it('ignores braces inside strings', () => {
    const path = writeTmp('str.ts', [
      'function s() {',
      '  const x = "}";',
      '  return 1;',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods[0].sourceLineEnd).toBe(4);
  });
});

describe('scanTypeScript — multiple methods', () => {
  it('extracts multiple functions sorted by line', () => {
    const path = writeTmp('multi2.ts', [
      'function first() {}',
      'function second() {}',
      'const third = () => {};',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(3);
    expect(result!.methods[0].name).toBe('first');
    expect(result!.methods[0].sourceLine).toBe(1);
    expect(result!.methods[1].name).toBe('second');
    expect(result!.methods[1].sourceLine).toBe(2);
    expect(result!.methods[2].name).toBe('third');
    expect(result!.methods[2].sourceLine).toBe(3);
  });
});

describe('scanPython', () => {
  it('extracts def at module level', () => {
    const path = writeTmp('py1.py', 'def foo():\n    pass\n');
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(1);
    expect(result!.methods[0].name).toBe('foo');
    expect(result!.methods[0].kind).toBe('function');
    expect(result!.methods[0].owningSymbol).toBeNull();
  });

  it('extracts async def', () => {
    const path = writeTmp('py2.py', 'async def fetch():\n    pass\n');
    const result = scanSourceFile(path);
    expect(result!.methods[0].isAsync).toBe(true);
  });

  it('tracks owning class via indentation', () => {
    const path = writeTmp('py3.py', [
      'class Foo:',
      '    def bar(self):',
      '        pass',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(1);
    expect(result!.methods[0].name).toBe('bar');
    expect(result!.methods[0].owningSymbol).toBe('Foo');
    expect(result!.methods[0].kind).toBe('method');
  });

  it('marks leading-underscore as private', () => {
    const path = writeTmp('py4.py', 'def _private():\n    pass\n');
    const result = scanSourceFile(path);
    expect(result!.methods[0].visibility).toBe('private');
    expect(result!.methods[0].isExported).toBe(false);
  });
});

describe('scanTypeScript — edge cases', () => {
  it('handles empty file', () => {
    const path = writeTmp('empty2.ts', '');
    const result = scanSourceFile(path);
    expect(result!.methods).toEqual([]);
  });

  it('handles malformed code without crashing', () => {
    const path = writeTmp('bad.ts', 'function (((broken');
    const result = scanSourceFile(path);
    expect(result).not.toBeNull();
    expect(Array.isArray(result!.methods)).toBe(true);
  });

  it('skips control keywords that look like methods inside a class', () => {
    const path = writeTmp('ctrl.ts', [
      'class Foo {',
      '  bar() {',
      '    if (true) {',
      '      return 1;',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    expect(result!.methods).toHaveLength(1);
    expect(result!.methods[0].name).toBe('bar');
  });
});

describe('scanTypeScript — multi-line signatures', () => {
  it('scans method with multi-line param list', () => {
    const path = writeTmp('multiline-method.ts', [
      'class Foo {',
      '  public doThing(',
      '    a: number,',
      '    b: number,',
      '  ): Promise<void> {',
      '    return Promise.resolve();',
      '  }',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    const method = result!.methods.find(m => m.name === 'doThing');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('method');
    expect(method!.visibility).toBe('public');
    expect(method!.paramCount).toBe(2);
    expect(method!.owningSymbol).toBe('Foo');
    expect(method!.returnType).toContain('Promise<void>');
  });

  it('scans arrow function with multi-line params', () => {
    const path = writeTmp('multiline-arrow.ts', [
      'export const handler = (',
      '  req: Request,',
      '  res: Response,',
      '): void => {',
      '  res.end();',
      '};',
    ].join('\n'));
    const result = scanSourceFile(path);
    const method = result!.methods.find(m => m.name === 'handler');
    expect(method).toBeDefined();
    expect(method!.kind).toBe('callback');
    expect(method!.isExported).toBe(true);
    expect(method!.paramCount).toBe(2);
  });

  it('skips abstract method declaration (no brace within 50 lines)', () => {
    const path = writeTmp('abstract-method.ts', [
      'abstract class Base {',
      '  abstract render(',
      '    ctx: Context,',
      '  ): void;',
      '  concreteMethod() {',
      '    return 1;',
      '  }',
      '}',
    ].join('\n'));
    const result = scanSourceFile(path);
    // The abstract method has no `{` body, so it should NOT be indexed.
    const abstractMethod = result!.methods.find(m => m.name === 'render');
    expect(abstractMethod).toBeUndefined();
    // But the concrete method should still be scanned.
    const concrete = result!.methods.find(m => m.name === 'concreteMethod');
    expect(concrete).toBeDefined();
  });
});

describe('countParams', () => {
  it('returns 0 for empty string', () => {
    expect(countParams('')).toBe(0);
    expect(countParams('   ')).toBe(0);
  });

  it('counts simple comma-separated params', () => {
    expect(countParams('a, b')).toBe(2);
    expect(countParams('a')).toBe(1);
    expect(countParams('a, b, c')).toBe(3);
  });

  it('treats generics as a single param', () => {
    expect(countParams('r: Record<string, number>, b: number')).toBe(2);
    expect(countParams('m: Map<string, Array<number>>')).toBe(1);
  });

  it('treats default object params as a single param', () => {
    expect(countParams('{ x: 1, y: 2 } = {}')).toBe(1);
    expect(countParams('opts: { a: number, b: number } = { a: 1, b: 2 }, cb: () => void')).toBe(2);
  });

  it('treats callback type params correctly', () => {
    expect(countParams('cb: (a: number, b: number) => void, extra: string')).toBe(2);
  });

  it('ignores commas inside string literals', () => {
    expect(countParams('name: string = "a, b", age: number')).toBe(2);
    expect(countParams('label: string = \'x, y, z\'')).toBe(1);
  });
});
