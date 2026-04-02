import { describe, it, expect } from 'vitest';
import { findAnchorLine, extractWithAnchors } from '../snippet';

describe('findAnchorLine', () => {
  const filePath = '/test/file.ts';

  it('throws when anchor has 0 matches', () => {
    const lines = ['line one', 'line two', 'line three'];
    expect(() => findAnchorLine(lines, 'nonexistent', 'startAt', filePath))
      .toThrow('startAt anchor not found in /test/file.ts: "nonexistent"');
  });

  it('returns the line index for exactly 1 match', () => {
    const lines = ['function foo() {', '  return 42;', '}'];
    expect(findAnchorLine(lines, 'return 42', 'startAt', filePath)).toBe(1);
  });

  it('throws when anchor matches multiple lines', () => {
    const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
    expect(() => findAnchorLine(lines, 'const', 'endAt', filePath))
      .toThrow('endAt anchor "const" matched 3 lines');
  });

  it('trims whitespace from anchor before matching', () => {
    const lines = ['  function bar() {', '  }'];
    expect(findAnchorLine(lines, '  function bar  ', 'startAt', filePath)).toBe(0);
  });

  it('trims whitespace from lines before matching', () => {
    const lines = ['    export class Foo {', '    }'];
    expect(findAnchorLine(lines, 'export class Foo {', 'startAt', filePath)).toBe(0);
  });

  it('throws for empty anchor (matches everything)', () => {
    const lines = ['a', 'b'];
    // Empty string after trim matches all lines — should trigger multi-match error
    expect(() => findAnchorLine(lines, '   ', 'startAt', filePath))
      .toThrow('matched 2 lines');
  });

  it('uses the label in error messages', () => {
    const lines = ['x'];
    expect(() => findAnchorLine(lines, 'missing', 'endAt', filePath))
      .toThrow(/^endAt anchor/);
  });
});

describe('extractWithAnchors', () => {
  const filePath = '/test/file.ts';

  const sampleFile = [
    'import { foo } from "bar";',
    '',
    'export function hello() {',
    '  console.log("hello");',
    '  return true;',
    '}',
    '',
    'export function goodbye() {',
    '  console.log("goodbye");',
    '  return false;',
    '}',
  ].join('\n');

  it('returns the whole file when no anchors provided', () => {
    expect(extractWithAnchors(sampleFile, filePath)).toBe(sampleFile);
  });

  it('extracts from startAt anchor to end of file', () => {
    const result = extractWithAnchors(sampleFile, filePath, 'export function goodbye()');
    const expected = [
      'export function goodbye() {',
      '  console.log("goodbye");',
      '  return false;',
      '}',
    ].join('\n');
    expect(result).toBe(expected);
  });

  it('extracts from beginning to endAt anchor', () => {
    const result = extractWithAnchors(sampleFile, filePath, undefined, 'export function hello()');
    const expected = [
      'import { foo } from "bar";',
      '',
      'export function hello() {',
    ].join('\n');
    expect(result).toBe(expected);
  });

  it('extracts range between both anchors', () => {
    const result = extractWithAnchors(sampleFile, filePath, 'export function hello()', 'return true;');
    const expected = [
      'export function hello() {',
      '  console.log("hello");',
      '  return true;',
    ].join('\n');
    expect(result).toBe(expected);
  });

  it('extracts a single line when both anchors match same line', () => {
    const result = extractWithAnchors(sampleFile, filePath, 'return false;', 'return false;');
    expect(result).toBe('  return false;');
  });

  it('normalizes CRLF to LF', () => {
    const crlfContent = 'line1\r\nline2\r\nline3';
    const result = extractWithAnchors(crlfContent, filePath, 'line2', 'line2');
    expect(result).toBe('line2');
  });

  it('throws for single-line file with anchors', () => {
    const minified = 'function a(){return 1}function b(){return 2}';
    expect(() => extractWithAnchors(minified, filePath, 'function a'))
      .toThrow('minified');
  });

  it('throws when endAt anchor is before startAt anchor', () => {
    expect(() => extractWithAnchors(sampleFile, filePath, 'export function goodbye()', 'export function hello()'))
      .toThrow('endAt anchor appears before startAt');
  });

  it('throws when range exceeds maxLines', () => {
    expect(() => extractWithAnchors(sampleFile, filePath, 'import { foo }', 'return false;', 3))
      .toThrow('exceeding maxLines limit of 3');
  });

  it('allows range exactly equal to maxLines', () => {
    // 'export function hello() {' to 'return true;' is 3 lines
    const result = extractWithAnchors(sampleFile, filePath, 'export function hello()', 'return true;', 3);
    expect(result.split('\n')).toHaveLength(3);
  });
});
