/**
 * Tests for extractFunctions() regex-based parser.
 *
 * findSymbolAtPos() requires a live EditorView and is integration-only,
 * so it's not covered here.
 */

import { describe, it, expect } from 'vitest';
import { extractFunctions, type ExtractedFunction } from '../extract-functions';

describe('extractFunctions', () => {
  it('returns [] for empty string', () => {
    expect(extractFunctions('', 'typescript')).toEqual([]);
  });

  it('returns [] for null/undefined code', () => {
    expect(extractFunctions(null as unknown as string, 'typescript')).toEqual([]);
    expect(extractFunctions(undefined as unknown as string, 'typescript')).toEqual([]);
  });

  it('returns [] for non-TS/JS language', () => {
    expect(extractFunctions('function foo() {}', 'python')).toEqual([]);
    expect(extractFunctions('function foo() {}', 'rust')).toEqual([]);
    expect(extractFunctions('function foo() {}', 'markdown')).toEqual([]);
  });

  it('extracts a simple function declaration', () => {
    const result = extractFunctions('function foo() {}', 'typescript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('foo');
    expect(result[0].sourceLine).toBe(1);
    expect(result[0].kind).toBe('function');
    expect(result[0].isExported).toBe(false);
    expect(result[0].isAsync).toBe(false);
    expect(result[0].params).toBe('');
    expect(result[0].returnType).toBe('');
    expect(result[0].visibility).toBeNull();
    expect(result[0].sourceLineEnd).toBe(1);
  });

  it('extracts exported async function with params and return type', () => {
    const code = 'export async function bar(x: number): string { return ""; }';
    const result = extractFunctions(code, 'typescript');
    expect(result).toHaveLength(1);
    const fn = result[0];
    expect(fn.name).toBe('bar');
    expect(fn.isExported).toBe(true);
    expect(fn.isAsync).toBe(true);
    expect(fn.params).toBe('x: number');
    expect(fn.returnType).toBe('string');
    expect(fn.kind).toBe('function');
  });

  it('extracts arrow function assigned to const', () => {
    const result = extractFunctions('const baz = () => 1;', 'javascript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('baz');
    expect(result[0].kind).toBe('callback');
    expect(result[0].isAsync).toBe(false);
    expect(result[0].isExported).toBe(false);
    // Inline arrow has no block body → sourceLineEnd should be null
    expect(result[0].sourceLineEnd).toBeNull();
  });

  it('extracts exported async arrow function', () => {
    const result = extractFunctions('export const qux = async () => {}', 'typescript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('qux');
    expect(result[0].isExported).toBe(true);
    expect(result[0].isAsync).toBe(true);
    expect(result[0].kind).toBe('callback');
    expect(result[0].sourceLineEnd).toBe(1);
  });

  it('extracts function expression assigned to const', () => {
    const result = extractFunctions('const helper = function(n) { return n * 2; };', 'typescript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('helper');
    expect(result[0].kind).toBe('function');
    expect(result[0].isAsync).toBe(false);
  });

  it('extracts multiple functions sorted by line', () => {
    const code = [
      'function first() {}',
      'export async function second(y: string): void {',
      '  return;',
      '}',
      'const third = () => 42;',
    ].join('\n');

    const result = extractFunctions(code, 'typescript');
    expect(result).toHaveLength(3);

    expect(result[0].name).toBe('first');
    expect(result[0].sourceLine).toBe(1);

    expect(result[1].name).toBe('second');
    expect(result[1].sourceLine).toBe(2);
    expect(result[1].sourceLineEnd).toBe(4);
    expect(result[1].isAsync).toBe(true);

    expect(result[2].name).toBe('third');
    expect(result[2].sourceLine).toBe(5);
    expect(result[2].kind).toBe('callback');
  });

  it('handles multi-line function body end tracking', () => {
    const code = [
      'function outer() {',
      '  if (true) {',
      '    doStuff();',
      '  }',
      '}',
    ].join('\n');

    const result = extractFunctions(code, 'typescript');
    expect(result).toHaveLength(1);
    expect(result[0].sourceLineEnd).toBe(5);
  });

  it('gracefully handles malformed code without throwing', () => {
    expect(() => extractFunctions('function (((broken', 'typescript')).not.toThrow();
    expect(() => extractFunctions('const = () =>', 'typescript')).not.toThrow();
    expect(() => extractFunctions('{{{}}}', 'typescript')).not.toThrow();
  });

  it('ignores anonymous arrow callbacks without a name binding', () => {
    // `arr.map(() => 1)` has no `const name =` prefix, so it's not matched.
    expect(extractFunctions('arr.map(() => 1);', 'typescript')).toEqual([]);
  });

  it('does not confuse string/comment braces with code braces', () => {
    const code = [
      'function tricky() {',
      '  const s = "} not real";',
      '  // } comment brace',
      '  /* block } brace */',
      '  return 1;',
      '}',
    ].join('\n');

    const result = extractFunctions(code, 'typescript');
    expect(result).toHaveLength(1);
    expect(result[0].sourceLineEnd).toBe(6);
  });
});
