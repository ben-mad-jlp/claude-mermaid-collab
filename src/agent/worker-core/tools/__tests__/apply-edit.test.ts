import { describe, it, expect } from 'vitest';
import { applyEdit } from '../apply-edit';

describe('applyEdit', () => {
  it('replaces a unique exact match', () => {
    expect(applyEdit('const a = 1;\nconst b = 2;', 'const a = 1;', 'const a = 99;')).toBe(
      'const a = 99;\nconst b = 2;',
    );
  });

  it('throws when oldString === newString', () => {
    expect(() => applyEdit('x', 'same', 'same')).toThrow(/must be different/);
  });

  it('throws when the match is not found', () => {
    expect(() => applyEdit('hello world', 'nope', 'x')).toThrow(/not found/);
  });

  it('throws on an ambiguous (>1 occurrence) match without replaceAll — never corrupts', () => {
    // Same-line duplicates: no replacer can disambiguate → must throw, not guess.
    expect(() => applyEdit('foo foo', 'foo', 'bar')).toThrow(/multiple|ambiguous|not found/i);
  });

  it('replaceAll replaces every occurrence', () => {
    expect(applyEdit('foo\nfoo\nfoo', 'foo', 'bar', true)).toBe('bar\nbar\nbar');
  });

  it('falls back to line-trimmed matching when indentation differs', () => {
    // find has no leading indent; content is indented — exact match fails, line-trimmed wins.
    const content = '    return x + 1;';
    expect(applyEdit(content, 'return x + 1;', 'return x + 2;')).toBe('    return x + 2;');
  });

  it('falls back to block-anchor matching when the interior drifted', () => {
    const content = ['function f() {', '  const y = 41;', '  return y;', '}'].join('\n');
    // anchors (first + last line) match; interior differs → block-anchor matches the whole block.
    const find = ['function f() {', '  const y = 0;', '  return y;', '}'].join('\n');
    const next = ['function f() {', '  return 42;', '}'].join('\n');
    expect(applyEdit(content, find, next)).toBe(next);
  });

  it('falls back to indentation-flexible matching for a re-indented block', () => {
    const content = ['if (a) {', '        doThing();', '}'].join('\n');
    const find = ['if (a) {', '    doThing();', '}'].join('\n'); // different indent on middle line
    const next = ['if (a) {', '        doOther();', '}'].join('\n');
    const out = applyEdit(content, find, next);
    expect(out).toContain('doOther');
    expect(out).not.toContain('doThing');
  });
});
