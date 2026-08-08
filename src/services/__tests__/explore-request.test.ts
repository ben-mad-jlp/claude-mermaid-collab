import { describe, it, expect } from 'bun:test';
import {
  validateExploreRequest,
  type ExploreRequestInput,
  EXPLORE_STOPWORDS,
} from '../explore-request';

describe('explore-request validator', () => {
  describe('oracle refusal', () => {
    it('an absent oracle yields a non-null refusal', () => {
      const result = validateExploreRequest({ oracle: '' });
      expect(result.refusal).toBeTruthy();
      expect(result.warnings.length).toBe(0);
    });

    it('a whitespace-only oracle yields a non-null refusal', () => {
      const result = validateExploreRequest({ oracle: '   ' });
      expect(result.refusal).toBeTruthy();
      expect(result.warnings.length).toBe(0);
    });

    it('a null oracle yields a non-null refusal', () => {
      const result = validateExploreRequest({ oracle: null as any });
      expect(result.refusal).toBeTruthy();
      expect(result.warnings.length).toBe(0);
    });
  });

  describe('no-named-anchor tell', () => {
    it('fires alone on an oracle with no identifier, path:line, or hash reference', () => {
      const input: ExploreRequestInput = {
        oracle: 'the result always is nice',
        scope: 'something else entirely',
        target: 'another thing',
      };
      const result = validateExploreRequest(input);
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].code).toBe('no-named-anchor');
    });

    it('does not fire when oracle contains a dotted identifier', () => {
      const result = validateExploreRequest({
        oracle: 'function object.method must work',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains a camelCase identifier', () => {
      const result = validateExploreRequest({
        oracle: 'function myMethod must work',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains a snake_case identifier', () => {
      const result = validateExploreRequest({
        oracle: 'function my_method must work',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains a path:line reference', () => {
      const result = validateExploreRequest({
        oracle: 'bug at src/services/todo.ts:42 must be fixed',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains a hash reference', () => {
      const result = validateExploreRequest({
        oracle: 'commit abc1234 must be reverted',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains the word golden', () => {
      const result = validateExploreRequest({
        oracle: 'golden test must pass',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire when oracle contains a 7-char hex run', () => {
      const result = validateExploreRequest({
        oracle: 'commit 1a2b3c4 must be reverted',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });
  });

  describe('oracle-subsumed-by-scope tell', () => {
    it('fires alone when oracle only restates scope/target tokens', () => {
      const input: ExploreRequestInput = {
        oracle: 'listTodos function must work',
        scope: 'the listTodos function must always work correctly',
      };
      const result = validateExploreRequest(input);
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].code).toBe('oracle-subsumed-by-scope');
    });

    it('does not fire when oracle adds novel tokens beyond scope/target', () => {
      const input: ExploreRequestInput = {
        oracle: 'listTodos must return parentId values',
        scope: 'the listTodos function must work',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(false);
    });

    it('does not fire on an oracle with no non-stopword tokens', () => {
      const input: ExploreRequestInput = {
        oracle: 'the and a of',
        scope: 'something',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(false);
    });

    it('treats tokens from both scope and target as surface', () => {
      const input: ExploreRequestInput = {
        oracle: 'foo work',
        scope: 'the foo function',
        target: 'work correctly',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(true);
    });

    it('excludes stopwords from the subset test', () => {
      const input: ExploreRequestInput = {
        oracle: 'listTodos function',
        scope: 'the listTodos function must work',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(true);
    });

    it('excludes pure-numeric tokens from the subset test', () => {
      const input: ExploreRequestInput = {
        oracle: 'listTodos 123 function must work',
        scope: 'the listTodos function must work',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(true);
    });
  });

  describe('no-falsifiable-predicate tell', () => {
    it('fires alone on an oracle with an anchor but no predicate lexicon word', () => {
      const input: ExploreRequestInput = {
        oracle: 'listTodos returns rows from the parentId join',
      };
      const result = validateExploreRequest(input);
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].code).toBe('no-falsifiable-predicate');
    });

    it('does not fire when oracle contains must', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos must work',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains never', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos never returns null',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains always', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos always completes',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains equals', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos result equals expected',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains identical', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos result identical to snapshot',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains monotonic', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos results are monotonic by id',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains idempotent', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos is idempotent',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains "at most"', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos takes at most 100ms',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains "no more than"', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos returns no more than 1000 rows',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('does not fire when oracle contains within', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos completes within 1s',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });

    it('is case-insensitive', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos MUST work',
      });
      expect(result.warnings.some(w => w.code === 'no-falsifiable-predicate')).toBe(false);
    });
  });

  describe('well-formed oracle', () => {
    it('yields zero warnings and no refusal for a good oracle', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos must never return a row whose parentId is missing from the same result set',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });

    it('accepts an oracle with dotted identifier, novel tokens, and predicate', () => {
      const result = validateExploreRequest({
        oracle: 'user.firstName must equal the normalized first name from the database',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });

    it('accepts an oracle with path:line and predicate', () => {
      const result = validateExploreRequest({
        oracle: 'bug at src/services/store.ts:123 must be fixed by June',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });

    it('accepts an oracle with hash and predicate', () => {
      const result = validateExploreRequest({
        oracle: 'commit abcdef1 must be reverted before release',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });
  });

  describe('multiple tells firing simultaneously', () => {
    it('reports all tells when multiple vacuities are present', () => {
      const input: ExploreRequestInput = {
        oracle: 'the result is nice',
        scope: 'the result is nice too',
      };
      const result = validateExploreRequest(input);
      expect(result.refusal).toBeNull();
      // Should fire: no-named-anchor (no identifier), oracle-subsumed-by-scope (all tokens in scope), no-falsifiable-predicate (no predicate)
      expect(result.warnings.length).toBe(3);
      const codes = new Set(result.warnings.map(w => w.code));
      expect(codes.has('no-named-anchor')).toBe(true);
      expect(codes.has('oracle-subsumed-by-scope')).toBe(true);
      expect(codes.has('no-falsifiable-predicate')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles oracle with mixed case dotted identifiers', () => {
      const result = validateExploreRequest({
        oracle: 'SomeClass.method must work',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('handles scope and target both absent', () => {
      const result = validateExploreRequest({
        oracle: 'listTodos must work',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });

    it('handles very short oracle with anchor and predicate', () => {
      const result = validateExploreRequest({
        oracle: 'myVar must be positive',
      });
      expect(result.refusal).toBeNull();
      expect(result.warnings.length).toBe(0);
    });

    it('handles path with backslash (Windows-style)', () => {
      const result = validateExploreRequest({
        oracle: 'bug in C:\\users\\code\\file.ts:42 must fix',
      });
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });

    it('does not fire no-named-anchor on uuid-like (hex)', () => {
      const result = validateExploreRequest({
        oracle: 'epic 550e8400e29b41d4a716446655440000 must be landed',
      });
      // 550e8400e29b41d4a716446655440000 is 32 hex chars, should match /\b[0-9a-f]{7,}\b/
      expect(result.warnings.some(w => w.code === 'no-named-anchor')).toBe(false);
    });
  });

  describe('stopwords are actually excluded', () => {
    it('stopwords are in the exported set', () => {
      expect(EXPLORE_STOPWORDS.has('the')).toBe(true);
      expect(EXPLORE_STOPWORDS.has('and')).toBe(true);
      expect(EXPLORE_STOPWORDS.has('must')).toBe(true); // must appears in both stopwords and predicate lexicon
    });

    it('stopword tokens do not count for oracle-subsumed-by-scope', () => {
      // If we tested "the and of" against "the and of", they would be equal stopwords only.
      // The test should NOT fire oracle-subsumed-by-scope because oracleTokens is empty.
      const input: ExploreRequestInput = {
        oracle: 'the and of',
        scope: 'the and of',
      };
      const result = validateExploreRequest(input);
      expect(result.warnings.some(w => w.code === 'oracle-subsumed-by-scope')).toBe(false);
    });
  });
});
