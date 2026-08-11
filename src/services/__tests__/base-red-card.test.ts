import { describe, it, expect } from 'bun:test';
import { buildBaseRedCard, resolveFreshBaseRedCard } from '../base-red-card';

const BASE_INPUT = {
  epicBranch: 'collab/epic/test1234',
  command: 'npx tsc --noEmit',
  output: 'src/x.ts(3,1): error TS2304: Cannot find name "foo".',
};

describe('buildBaseRedCard', () => {
  it('branchIdenticalToBase: false produces byte-identical card to today, including commit the fix', () => {
    const text = buildBaseRedCard({
      ...BASE_INPUT,
      branchIdenticalToBase: false,
    });
    expect(text).toContain('Epic base is RED — no leaf on collab/epic/test1234 can be trusted');
    expect(text).toContain('failing command: npx tsc --noEmit');
    expect(text).toContain('commit the fix');
    expect(text).toContain('Fix the base and commit the fix to collab/epic/test1234');
  });

  it('branchIdenticalToBase: true states branch is identical to base and drops commit-the-fix prescription', () => {
    const text = buildBaseRedCard({
      ...BASE_INPUT,
      branchIdenticalToBase: true,
    });
    expect(text).toContain('Epic base is RED');
    expect(text).toContain('failing command: npx tsc --noEmit');
    expect(text).not.toContain('commit the fix');
    expect(text).toContain('identical to its base');
    expect(text).toContain('upstream');
  });

  it('includes output tail (last 40 lines) in both cases', () => {
    const longOutput = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const text = buildBaseRedCard({
      ...BASE_INPUT,
      output: longOutput,
      branchIdenticalToBase: false,
    });
    expect(text).toContain('line 10'); // should include line 10 (within last 40)
    expect(text).toContain('line 49'); // should include line 49 (last line)
  });
});

describe('resolveFreshBaseRedCard', () => {
  it('empty diff + still-failing remeasure states branch is identical to base and drops commit-the-fix prescription', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
      remeasureBase: async () => ({ status: 'fail' }),
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('identical to its base');
    expect(result!.questionText).not.toContain('commit the fix');
  });

  it('empty diff + passing remeasure resolves no card', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
      remeasureBase: async () => ({ status: 'pass' }),
    });
    expect(result).toBeNull();
  });

  it('the remeasure probe is invoked exactly once', async () => {
    let callCount = 0;
    await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
      remeasureBase: async () => {
        callCount += 1;
        return { status: 'pass' };
      },
    });
    expect(callCount).toBe(1);
  });

  it('remeasure not called when diff is not empty', async () => {
    let called = false;
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => false,
      remeasureBase: async () => {
        called = true;
        return { status: 'pass' };
      },
    });
    expect(called).toBe(false);
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('commit the fix');
  });

  it('isBranchDiffEmpty unset resolves to non-empty diff (today\'s behaviour)', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('commit the fix');
  });

  it('remeasureBase unset with empty diff still produces card with identical-to-base message', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('identical to its base');
    expect(result!.questionText).not.toContain('commit the fix');
  });

  it('remeasure error resolves to still-failing card (fail-safe to identical-to-base)', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
      remeasureBase: async () => {
        throw new Error('gate execution failed');
      },
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('identical to its base');
  });

  it('remeasure returning null resolves to still-failing card', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => true,
      remeasureBase: async () => null,
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('identical to its base');
  });

  it('isBranchDiffEmpty throwing defaults to non-empty diff (fail-safe)', async () => {
    const result = await resolveFreshBaseRedCard({
      ...BASE_INPUT,
      isBranchDiffEmpty: async () => {
        throw new Error('git error');
      },
      remeasureBase: async () => ({ status: 'pass' }),
    });
    expect(result).not.toBeNull();
    expect(result!.questionText).toContain('commit the fix');
  });
});
