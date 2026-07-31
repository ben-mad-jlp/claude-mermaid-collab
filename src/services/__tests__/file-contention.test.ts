import { describe, test, expect } from 'bun:test';
import { normalizeDeclaredFiles, declaredFilesConflict, partitionByContention } from '../file-contention';

describe('file-contention', () => {
  test('exact same file conflicts', () => {
    expect(declaredFilesConflict(['a.ts'], ['a.ts'])).toBe(true);
  });

  test('./a.ts vs a.ts conflicts after normalization', () => {
    expect(declaredFilesConflict(['./a.ts'], ['a.ts'])).toBe(true);
  });

  test('disjoint files do not conflict', () => {
    expect(declaredFilesConflict(['a.ts'], ['b.ts'])).toBe(false);
  });

  test('empty declared set is unconstrained in both directions (never deferred, never reserves)', () => {
    const heldFiles = new Set<string>(['x.ts']);
    const sizeBefore = heldFiles.size;

    const { dispatch, deferred } = partitionByContention(
      ['emptyCandidate'],
      heldFiles,
      () => []
    );

    expect(dispatch).toEqual(['emptyCandidate']);
    expect(deferred).toEqual([]);
    expect(heldFiles.size).toBe(sizeBefore);

    const { dispatch: dispatch2 } = partitionByContention(
      ['realCandidate'],
      heldFiles,
      () => ['x.ts']
    );
    expect(dispatch2).toEqual([]);
  });

  test('two same-file candidates in one batch ⇒ second deferred', () => {
    const heldFiles = new Set<string>();
    const candidates = [
      { id: 'first', files: ['a.ts'] },
      { id: 'second', files: ['a.ts'] },
    ];

    const { dispatch, deferred } = partitionByContention(
      candidates,
      heldFiles,
      (c) => c.files
    );

    expect(dispatch.map((c) => c.id)).toEqual(['first']);
    expect(deferred.map((c) => c.id)).toEqual(['second']);
  });
});
