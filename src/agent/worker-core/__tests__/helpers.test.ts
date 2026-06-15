import { describe, it, expect } from 'vitest';
import { normalizeErrorSig, sameSignatures } from '../helpers';

describe('normalizeErrorSig', () => {
  it('collapses absolute paths to basenames and strips line:col', () => {
    expect(normalizeErrorSig('/Users/x/repo/src/foo.ts:120:5 error TS2304')).toBe(
      'foo.ts:l:c error ts2304',
    );
  });

  it('normalizes hex addresses', () => {
    expect(normalizeErrorSig('segfault at 0xDEADBEEF')).toBe('segfault at 0xaddr');
  });
});

describe('sameSignatures', () => {
  it('treats the same failure with different paths/line-numbers as equal', () => {
    const a = ['/a/b/foo.ts:10:2 error TS2304: Cannot find name x'];
    const b = ['/other/root/foo.ts:88:9 error TS2304: Cannot find name x'];
    expect(sameSignatures(a, b)).toBe(true);
  });

  it('is order-independent and de-duplicates', () => {
    expect(sameSignatures(['e1', 'e2', 'e1'], ['e2', 'e1'])).toBe(true);
  });

  it('detects a genuinely different failure set', () => {
    expect(sameSignatures(['error TS2304'], ['error TS2345'])).toBe(false);
  });

  it('different counts are not equal', () => {
    expect(sameSignatures(['a'], ['a', 'b'])).toBe(false);
  });

  it('two empty sets are equal (no errors == no errors)', () => {
    expect(sameSignatures([], [])).toBe(true);
  });
});
