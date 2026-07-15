import { describe, it, expect } from 'vitest';
import { damerauLevenshtein } from '../distance';

describe('damerauLevenshtein', () => {
  it('detects adjacent transposition with cost 1', () => {
    expect(damerauLevenshtein('misison', 'mission', 2)).toBe(1);
  });

  it('detects transposition (teh -> the)', () => {
    expect(damerauLevenshtein('teh', 'the', 2)).toBe(1);
  });

  it('returns maxDist + 1 for beyond-bound pair', () => {
    expect(damerauLevenshtein('abcdef', 'uvwxyz', 2)).toBe(3);
  });

  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('hello', 'hello', 5)).toBe(0);
  });
});
