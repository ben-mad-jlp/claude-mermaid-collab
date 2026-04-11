import { describe, it, expect } from 'bun:test';
import { computeMethodId, normalizeParams, computeBodyFingerprint } from '../pseudo-id.js';

describe('computeMethodId edge cases', () => {
  it('produces stable ids for identical inputs', () => {
    const id1 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: 'Foo', name: 'bar', normalized_params: 'string' });
    const id2 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: 'Foo', name: 'bar', normalized_params: 'string' });
    expect(id1).toBe(id2);
  });

  it('differs when params differ', () => {
    const id1 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: null, name: 'fn', normalized_params: 'string' });
    const id2 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: null, name: 'fn', normalized_params: 'number' });
    expect(id1).not.toBe(id2);
  });

  it('differs when enclosing class differs', () => {
    const id1 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: 'A', name: 'fn', normalized_params: '' });
    const id2 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: 'B', name: 'fn', normalized_params: '' });
    expect(id1).not.toBe(id2);
  });

  it('normalizes windows backslashes in file path', () => {
    const id1 = computeMethodId({ file_path: 'src\\a.ts', enclosing_class: null, name: 'fn', normalized_params: '' });
    const id2 = computeMethodId({ file_path: 'src/a.ts', enclosing_class: null, name: 'fn', normalized_params: '' });
    expect(id1).toBe(id2);
  });

  it('starts with m_', () => {
    const id = computeMethodId({ file_path: 'src/a.ts', enclosing_class: null, name: 'fn', normalized_params: '' });
    expect(id).toMatch(/^m_[0-9a-f]{8}$/);
  });
});

describe('normalizeParams edge cases', () => {
  it('returns empty for empty input', () => {
    expect(normalizeParams('')).toBe('');
    expect(normalizeParams('()')).toBe('');
  });

  it('extracts types from TypeScript annotations', () => {
    expect(normalizeParams('(a: string, b: number)')).toBe('string,number');
  });

  it('strips default values', () => {
    expect(normalizeParams('(a: string = "x", b: number = 5)')).toBe('string,number');
  });

  it('strips leading modifiers', () => {
    expect(normalizeParams('(public a: string, readonly b: number)')).toBe('string,number');
  });

  it('handles nested generics', () => {
    expect(normalizeParams('(a: Map<string, number>, b: Array<T>)')).toBe('Map<string, number>,Array<T>');
  });

  it('untyped params fall back to any', () => {
    expect(normalizeParams('(x, y)')).toBe('any,any');
  });

  it('handles rest parameters', () => {
    expect(normalizeParams('(...args: string[])')).toBe('string[]');
  });
});

describe('computeBodyFingerprint edge cases', () => {
  it('empty body returns h_empty___', () => {
    expect(computeBodyFingerprint('')).toBe('h_empty___');
    expect(computeBodyFingerprint('   ')).toBe('h_empty___');
  });

  it('identical bodies produce identical fingerprints', () => {
    const body = 'const x = 1; return x + 2;';
    expect(computeBodyFingerprint(body)).toBe(computeBodyFingerprint(body));
  });

  it('variable rename preserves fingerprint (identifiers are deduped + sorted)', () => {
    const a = 'const foo = bar + baz;';
    const b = 'const baz = foo + bar;';
    expect(computeBodyFingerprint(a)).toBe(computeBodyFingerprint(b));
  });

  it('different identifiers produce different fingerprints', () => {
    const a = 'const apple = 1;';
    const b = 'const banana = 1;';
    expect(computeBodyFingerprint(a)).not.toBe(computeBodyFingerprint(b));
  });

  it('fingerprint starts with h_', () => {
    const fp = computeBodyFingerprint('const x = 1;');
    expect(fp).toMatch(/^h_[0-9a-f]{8}$/);
  });
});
