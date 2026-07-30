import { describe, it, expect } from 'bun:test';
import { diffAgainstBaseline } from '../../../scripts/test-backend';

describe('diffAgainstBaseline', () => {
  it('reports count growth on an already-baselined file (not net-new)', () => {
    const failed = [{ file: 'src/a.test.ts', output: '(fail) one\n(fail) two\n(fail) three' }];
    const baseline = {
      generatedAt: '2026-01-01T00:00:00Z',
      schema: 2 as const,
      files: [{ file: 'src/a.test.ts', failingTests: ['one'], count: 1 }],
    };

    const result = diffAgainstBaseline(failed, baseline);

    expect(result.netNew).toEqual([]);
    expect(result.countGrowth).toHaveLength(1);
    expect(result.countGrowth[0].file).toBe('src/a.test.ts');
    expect(result.countGrowth[0].baselineCount).toBe(1);
    expect(result.countGrowth[0].currentCount).toBe(3);
  });

  it('an unchanged baselined file is absorbed with no growth and no netNew/netFixed', () => {
    const failed = [{ file: 'src/b.test.ts', output: '(fail) known' }];
    const baseline = {
      generatedAt: '2026-01-01T00:00:00Z',
      schema: 2 as const,
      files: [{ file: 'src/b.test.ts', failingTests: ['known'], count: 1 }],
    };

    const result = diffAgainstBaseline(failed, baseline);

    expect(result.countGrowth).toEqual([]);
    expect(result.netNew).toEqual([]);
    expect(result.netFixed).toEqual([]);
  });

  it('a genuinely new failing file lands in netNew, not countGrowth', () => {
    const failed = [{ file: 'src/new.test.ts', output: '(fail) surprise' }];
    const baseline = { generatedAt: '2026-01-01T00:00:00Z', schema: 2 as const, files: [] };

    const result = diffAgainstBaseline(failed, baseline);

    expect(result.netNew).toHaveLength(1);
    expect(result.netNew[0].file).toBe('src/new.test.ts');
    expect(result.countGrowth).toEqual([]);
  });

  it('accepts a legacy {failing: [...]} baseline without throwing, warning about it', () => {
    const failed = [{ file: 'src/legacy.test.ts', output: '(fail) whatever' }];
    const baseline = { generatedAt: '2026-01-01T00:00:00Z', failing: ['src/legacy.test.ts'] };

    const result = diffAgainstBaseline(failed, baseline);

    expect(result.warnings.some((w) => w.includes('src/legacy.test.ts'))).toBe(true);
    expect(result.netNew).toEqual([]);
  });
});
