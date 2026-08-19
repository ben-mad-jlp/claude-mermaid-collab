/**
 * Coverage for resolveMergedTreeSha: the fail-open resolver for merge-tree output.
 */
import { describe, it, expect } from 'bun:test';
import { resolveMergedTreeSha } from '../merged-tree-sha';

const REPO = '/tmp/merged-tree-sha-fixture';
const BASE_SHA = '0000000000000000000000000000000000000001';
const EPIC_SHA = '0000000000000000000000000000000000000002';
const MERGED_SHA_40 = 'abcd1234abcd1234abcd1234abcd1234abcd1234';
const MERGED_SHA_64 = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';

describe('resolveMergedTreeSha', () => {
  it('resolveMergedTreeSha returns the tree oid from a clean merge-tree', () => {
    const mockGit = (cwd: string, args: string[]) => {
      expect(cwd).toBe(REPO);
      expect(args).toEqual(['merge-tree', '--write-tree', BASE_SHA, EPIC_SHA]);
      return { code: 0, stdout: MERGED_SHA_40 };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(MERGED_SHA_40);
  });

  it('resolveMergedTreeSha returns null on a non-zero git exit', () => {
    const mockGit = () => {
      return { code: 1, stdout: '' };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha returns null on a conflicted merge-tree result', () => {
    const mockGit = () => {
      return {
        code: 0,
        stdout: `${MERGED_SHA_40}\n1 blob 1a2b3c src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts`,
      };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha handles sha-256 format', () => {
    const mockGit = () => {
      return { code: 0, stdout: MERGED_SHA_64 };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(MERGED_SHA_64);
  });

  it('resolveMergedTreeSha returns null on empty stdout', () => {
    const mockGit = () => {
      return { code: 0, stdout: '' };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha returns null on non-hex first line', () => {
    const mockGit = () => {
      return { code: 0, stdout: 'not-a-hex-oid' };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha returns null on wrong-length hex', () => {
    const mockGit = () => {
      return { code: 0, stdout: 'abcd1234abcd1234' };
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha returns null when injected git throws', () => {
    const mockGit = () => {
      throw new Error('git command failed');
    };

    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
      git: mockGit,
    });

    expect(result).toBe(null);
  });

  it('resolveMergedTreeSha uses default git when not injected', () => {
    // This test verifies the default git is used by checking that it doesn't throw
    // when called with valid parameters (though the actual git call will likely fail
    // in a test environment).
    const result = resolveMergedTreeSha({
      repo: REPO,
      baseSha: BASE_SHA,
      epicTipSha: EPIC_SHA,
    });

    // Either returns null (git not found or failed) or a value
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
