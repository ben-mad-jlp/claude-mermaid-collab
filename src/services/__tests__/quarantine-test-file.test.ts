// Runs via `bun test`.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  resolveQuarantineTestFile,
  resetQuarantineTestFileCache,
  type ResolveTestFileDeps,
} from '../quarantine-test-file';

describe('resolveQuarantineTestFile', () => {
  beforeEach(() => {
    resetQuarantineTestFileCache();
  });

  it('resolves a test-name-only quarantine to its owning file', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/services/__tests__/server-supervisor-term-grace.test.ts'],
      readFile: (projectRoot, rel) => {
        if (rel === 'src/services/__tests__/server-supervisor-term-grace.test.ts') {
          return 'watchdog kill escalates SIGTERM -> SIGKILL > a sidecar that exits on SIGTERM is never SIGKILLed';
        }
        return '';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'watchdog kill escalates SIGTERM -> SIGKILL > a sidecar that exits on SIGTERM is never SIGKILLed',
      deps,
    );

    expect(result).toBe('src/services/__tests__/server-supervisor-term-grace.test.ts');
  });

  it('returns null when the suite string is unresolvable or ambiguous', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => [
        'src/services/__tests__/file1.test.ts',
        'src/services/__tests__/file2.test.ts',
      ],
      readFile: (projectRoot, rel) => {
        return 'some shared string that appears in both files';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'some shared string that appears in both files',
      deps,
    );

    expect(result).toBeNull();
  });

  it('strips progress counter prefix', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/foo.test.ts'],
      readFile: () => 'my test name',
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      '(444/492) my test name',
      deps,
    );

    expect(result).toBe('src/foo.test.ts');
  });

  it('returns path token if already present in test string', () => {
    const result = resolveQuarantineTestFile(
      '/test/project',
      'src/services/__tests__/sweep-measurement.test.ts > some test',
    );

    expect(result).toBe('src/services/__tests__/sweep-measurement.test.ts');
  });

  it('strips trailing punctuation from path', () => {
    const result = resolveQuarantineTestFile(
      '/test/project',
      'src/services/__tests__/sweep-measurement.test.ts:123',
    );

    expect(result).toBe('src/services/__tests__/sweep-measurement.test.ts');
  });

  it('strips trailing > and , from path', () => {
    const result = resolveQuarantineTestFile(
      '/test/project',
      'src/foo.test.ts>,',
    );

    expect(result).toBe('src/foo.test.ts');
  });

  it('recognizes ui/ paths', () => {
    const result = resolveQuarantineTestFile(
      '/test/project',
      'ui/src/components/__tests__/App.test.tsx > renders',
    );

    expect(result).toBe('ui/src/components/__tests__/App.test.tsx');
  });

  it('retries with arrow-variant when leading segment contains ->', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/my.test.ts'],
      readFile: (projectRoot, rel) => {
        if (rel === 'src/my.test.ts') {
          // Note: the source uses unicode arrow →
          return 'SIGTERM → SIGKILL > expected behavior';
        }
        return '';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      // Note: the test string uses ASCII arrow ->
      'SIGTERM -> SIGKILL > expected behavior > with unicode variant',
      deps,
    );

    expect(result).toBe('src/my.test.ts');
  });

  it('retries with arrow-variant when leading segment contains →', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/my.test.ts'],
      readFile: (projectRoot, rel) => {
        if (rel === 'src/my.test.ts') {
          return 'SIGTERM -> SIGKILL > expected behavior';
        }
        return '';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      // Note: test string uses unicode arrow
      'SIGTERM → SIGKILL > expected behavior',
      deps,
    );

    expect(result).toBe('src/my.test.ts');
  });

  it('scans final segment when leading segment has no match', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/my.test.ts'],
      readFile: (projectRoot, rel) => {
        if (rel === 'src/my.test.ts') {
          return 'only final test name appears in source';
        }
        return '';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'some suite that doesnt appear > only final test name appears in source',
      deps,
    );

    expect(result).toBe('src/my.test.ts');
  });

  it('handles multiple > separators by using first and last segment', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/my.test.ts', 'src/other.test.ts'],
      readFile: (projectRoot, rel) => {
        if (rel === 'src/my.test.ts') {
          return 'leading part';
        }
        return '';
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'leading part > middle > trailing part',
      deps,
    );

    expect(result).toBe('src/my.test.ts');
  });

  it('caches file list and contents per projectRoot', () => {
    let walkCount = 0;
    let readCount = 0;

    const deps: ResolveTestFileDeps = {
      listTestFiles: () => {
        walkCount += 1;
        return ['src/foo.test.ts'];
      },
      readFile: () => {
        readCount += 1;
        return 'my test';
      },
    };

    resolveQuarantineTestFile('/test/project', 'my test', deps);
    resolveQuarantineTestFile('/test/project', 'my test', deps);

    expect(walkCount).toBe(1);
    expect(readCount).toBe(1);
  });

  it('maintains separate caches per projectRoot', () => {
    const depsForProject1: ResolveTestFileDeps = {
      listTestFiles: () => ['src/foo.test.ts'],
      readFile: () => 'test1',
    };

    const depsForProject2: ResolveTestFileDeps = {
      listTestFiles: () => ['src/bar.test.ts'],
      readFile: () => 'test2',
    };

    resolveQuarantineTestFile('/project1', 'test1', depsForProject1);
    resolveQuarantineTestFile('/project2', 'test2', depsForProject2);

    // Both should resolve to their respective file
    const result1 = resolveQuarantineTestFile('/project1', 'test1', depsForProject1);
    const result2 = resolveQuarantineTestFile('/project2', 'test2', depsForProject2);

    expect(result1).toBe('src/foo.test.ts');
    expect(result2).toBe('src/bar.test.ts');
  });

  it('returns null when listTestFiles throws', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => {
        throw new Error('walk failed');
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'my test',
      deps,
    );

    expect(result).toBeNull();
  });

  it('degrades to empty string when readFile throws', () => {
    const deps: ResolveTestFileDeps = {
      listTestFiles: () => ['src/foo.test.ts'],
      readFile: (projectRoot, rel) => {
        throw new Error('read failed');
      },
    };

    const result = resolveQuarantineTestFile(
      '/test/project',
      'my test',
      deps,
    );

    expect(result).toBeNull();
  });

  it('resetQuarantineTestFileCache clears cached entries', () => {
    let walkCount = 0;

    const deps: ResolveTestFileDeps = {
      listTestFiles: () => {
        walkCount += 1;
        return ['src/foo.test.ts'];
      },
      readFile: () => 'my test',
    };

    resolveQuarantineTestFile('/test/project', 'my test', deps);
    expect(walkCount).toBe(1);

    resetQuarantineTestFileCache();

    resolveQuarantineTestFile('/test/project', 'my test', deps);
    expect(walkCount).toBe(2);
  });
});
