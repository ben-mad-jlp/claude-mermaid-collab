/**
 * Tests for resolveDefinition — pure function covering all decision branches.
 */

import { describe, it, expect } from 'vitest';
import { resolveDefinition, type LinkedSnippetRef } from '../definition-resolver';
import type { SourceLinkCandidate } from '../pseudo-api';

function candidate(
  sourceFilePath: string,
  sourceLine: number | null = 10,
  isExported = true,
): SourceLinkCandidate {
  return {
    sourceFilePath,
    sourceLine,
    sourceLineEnd: sourceLine != null ? sourceLine + 5 : null,
    language: 'typescript',
    isExported,
  };
}

describe('resolveDefinition', () => {
  describe('not-found', () => {
    it('returns not-found when candidates array is empty', () => {
      const result = resolveDefinition([], []);
      expect(result).toEqual({ type: 'not-found' });
    });

    it('returns not-found when candidates is null (defensive)', () => {
      const result = resolveDefinition(null as any, []);
      expect(result).toEqual({ type: 'not-found' });
    });
  });

  describe('single candidate', () => {
    it('returns found-linked when the single candidate matches a linked snippet', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/auth.ts' },
      ];
      const candidates = [candidate('/project/src/auth.ts', 42)];
      const result = resolveDefinition(candidates, linked);
      expect(result).toEqual({
        type: 'found-linked',
        snippetId: 'snip-1',
        line: 42,
      });
    });

    it('returns needs-link when the single candidate does not match any linked snippet', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/other.ts' },
      ];
      const candidates = [candidate('/project/src/auth.ts', 42)];
      const result = resolveDefinition(candidates, linked);
      expect(result).toEqual({
        type: 'needs-link',
        candidate: candidates[0],
      });
    });

    it('returns needs-link when there are no linked snippets at all', () => {
      const candidates = [candidate('/project/src/auth.ts', 42)];
      const result = resolveDefinition(candidates, []);
      expect(result.type).toBe('needs-link');
    });

    it('fallbacks to line 1 when the matched candidate has null sourceLine', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/auth.ts' },
      ];
      const candidates = [candidate('/project/src/auth.ts', null)];
      const result = resolveDefinition(candidates, linked);
      expect(result).toEqual({
        type: 'found-linked',
        snippetId: 'snip-1',
        line: 1,
      });
    });
  });

  describe('multiple candidates', () => {
    it('returns found-linked when all candidates share the same linked source path', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/auth.ts' },
      ];
      const candidates = [
        candidate('/project/src/auth.ts', 10),
        candidate('/project/src/auth.ts', 42), // same file, different line
      ];
      const result = resolveDefinition(candidates, linked);
      expect(result.type).toBe('found-linked');
      if (result.type === 'found-linked') {
        expect(result.snippetId).toBe('snip-1');
        expect(result.line).toBe(10); // first candidate wins
      }
    });

    it('returns needs-link when all candidates share the same unlinked source path', () => {
      const candidates = [
        candidate('/project/src/auth.ts', 10),
        candidate('/project/src/auth.ts', 42),
      ];
      const result = resolveDefinition(candidates, []);
      expect(result.type).toBe('needs-link');
      if (result.type === 'needs-link') {
        expect(result.candidate.sourceFilePath).toBe('/project/src/auth.ts');
      }
    });

    it('returns needs-link-picker when candidates point at different paths', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/auth.ts' },
      ];
      const candidates = [
        candidate('/project/src/auth.ts', 10),
        candidate('/project/src/user.ts', 20),
      ];
      const result = resolveDefinition(candidates, linked);
      expect(result.type).toBe('needs-link-picker');
      if (result.type === 'needs-link-picker') {
        expect(result.candidates).toHaveLength(2);
      }
    });

    it('returns needs-link-picker when none of multiple paths are linked', () => {
      const candidates = [
        candidate('/project/src/auth.ts', 10),
        candidate('/project/src/user.ts', 20),
      ];
      const result = resolveDefinition(candidates, []);
      expect(result.type).toBe('needs-link-picker');
    });

    it('returns needs-link-picker even when only one of multiple paths is linked', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '/project/src/auth.ts' },
      ];
      const candidates = [
        candidate('/project/src/auth.ts', 10),
        candidate('/project/src/user.ts', 20),
      ];
      const result = resolveDefinition(candidates, linked);
      expect(result.type).toBe('needs-link-picker');
    });
  });

  describe('linked snippets without filePath', () => {
    it('ignores linked snippets that have empty filePath', () => {
      const linked: LinkedSnippetRef[] = [
        { id: 'snip-1', filePath: '' },
      ];
      const candidates = [candidate('/project/src/auth.ts', 42)];
      const result = resolveDefinition(candidates, linked);
      expect(result.type).toBe('needs-link');
    });
  });
});
