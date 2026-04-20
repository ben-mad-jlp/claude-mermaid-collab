import { describe, it, expect } from 'vitest';
import { cn, randomUUID, truncate } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('dedupes conflicting tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles conditional/falsy inputs', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('randomUUID', () => {
  it('returns a non-empty string longer than 8 chars', () => {
    const v = randomUUID();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(8);
  });

  it('returns distinct values across calls', () => {
    expect(randomUUID()).not.toBe(randomUUID());
  });
});

describe('truncate', () => {
  it('returns input unchanged when under or equal to max', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('clamps and appends suffix when over max', () => {
    expect(truncate('hello world', 8)).toBe('hello w\u2026');
  });

  it('supports custom suffix', () => {
    expect(truncate('hello world', 8, '...')).toBe('hello...');
  });

  it('handles max smaller than suffix length', () => {
    expect(truncate('hello', 1, '\u2026')).toBe('\u2026');
  });
});
