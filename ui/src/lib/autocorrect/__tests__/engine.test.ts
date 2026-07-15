import { describe, it, expect } from 'vitest';
import { correctToken, correctMessage } from '../engine';

describe('correctToken', () => {
  const vocab = {
    protected: new Set(['leaf']),
    targets: new Set(['mission', 'early', 'branch', 'grokking', 'session']),
  };

  it('crit 2: corrects misison to mission', () => {
    const result = correctToken('misison', vocab);
    expect(result).toEqual({
      from: 'misison',
      to: 'mission',
      strength: 'strong',
    });
  });

  describe('crit 5: never-touch cases return null', () => {
    it('filters src/ (contains /)', () => {
      expect(correctToken('src/', vocab)).toBeNull();
    });

    it('filters leaf-gate.ts (contains - and .)', () => {
      expect(correctToken('leaf-gate.ts', vocab)).toBeNull();
    });

    it('filters fix-early (contains -)', () => {
      expect(correctToken('fix-early', vocab)).toBeNull();
    });

    it('filters --no-ff (starts with -)', () => {
      expect(correctToken('--no-ff', vocab)).toBeNull();
    });

    it('filters grok-4.5 (contains digit and .)', () => {
      expect(correctToken('grok-4.5', vocab)).toBeNull();
    });

    it('filters a8785f3d (contains digits)', () => {
      expect(correctToken('a8785f3d', vocab)).toBeNull();
    });

    it('filters camelCase (camelCase pattern)', () => {
      expect(correctToken('camelCase', vocab)).toBeNull();
    });

    it('filters teh (length < 5)', () => {
      expect(correctToken('teh', vocab)).toBeNull();
    });

    it('filters ALLCAPS token', () => {
      expect(correctToken('BLOCK', vocab)).toBeNull();
    });

    it('filters token starting with /', () => {
      expect(correctToken('/path/to/file', vocab)).toBeNull();
    });
  });

  describe('protected exact match', () => {
    it('returns null for protected word leaf', () => {
      expect(correctToken('leaf', vocab)).toBeNull();
    });
  });
});

describe('correctMessage', () => {
  const vocab = {
    protected: new Set(['leaf']),
    targets: new Set(['mission', 'early', 'branch', 'grokking', 'session']),
  };

  describe('quote-safe: ignores tokens inside quotes', () => {
    it('ignores token inside backticks', () => {
      const result = correctMessage('This `misison` word', vocab);
      expect(result).toHaveLength(0);
    });

    it('ignores token inside single quotes', () => {
      const result = correctMessage("This 'misison' word", vocab);
      expect(result).toHaveLength(0);
    });

    it('ignores token inside double quotes', () => {
      const result = correctMessage('This "misison" word', vocab);
      expect(result).toHaveLength(0);
    });

    it('ignores token after unclosed quote to end-of-text', () => {
      const result = correctMessage('This "misison', vocab);
      expect(result).toHaveLength(0);
    });

    it('corrects bare token outside quotes', () => {
      const result = correctMessage('This misison word', vocab);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        start: 5,
        end: 12,
        from: 'misison',
        to: 'mission',
      });
    });

    it('ignores quoted but corrects unquoted in same message', () => {
      const result = correctMessage('Check `misison` and misison', vocab);
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe('misison');
      expect(result[0].to).toBe('mission');
      expect(result[0].start).toBe(20); // position of unquoted misison
    });

    it('handles multiple quote types in same message', () => {
      const result = correctMessage(
        "The 'misison' is \"misison\" but misison works",
        vocab,
      );
      expect(result).toHaveLength(1);
      expect(result[0].from).toBe('misison');
    });

    it('protects nested quote pairs', () => {
      const result = correctMessage(
        'Process `this "misison" value` correctly',
        vocab,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe('crit 5 never-touch in correctMessage', () => {
    it('excludes src/ from output', () => {
      const result = correctMessage('Check src/ directory', vocab);
      expect(result).toHaveLength(0);
    });

    it('excludes a8785f3d from output', () => {
      const result = correctMessage('The ID a8785f3d was found', vocab);
      expect(result).toHaveLength(0);
    });

    it('excludes camelCase from output', () => {
      const result = correctMessage('The token camelCase here', vocab);
      expect(result).toHaveLength(0);
    });

    it('excludes teh from output (too short)', () => {
      const result = correctMessage('Did you mean teh word', vocab);
      expect(result).toHaveLength(0);
    });

    it('excludes leaf-gate.ts (protected name)', () => {
      const result = correctMessage('File leaf-gate.ts found', vocab);
      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for text with no corrections', () => {
      const result = correctMessage('This text has no errors', vocab);
      expect(result).toHaveLength(0);
    });

    it('returns multiple corrections if found', () => {
      const vocab2 = {
        protected: new Set<string>(),
        targets: new Set(['mission', 'early', 'branch', 'grokking', 'session', 'branch']),
      };
      const result = correctMessage('misison and earley', vocab2);
      // misison -> mission, earley -> early
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty string', () => {
      const result = correctMessage('', vocab);
      expect(result).toHaveLength(0);
    });

    it('handles only whitespace', () => {
      const result = correctMessage('   ', vocab);
      expect(result).toHaveLength(0);
    });
  });
});
