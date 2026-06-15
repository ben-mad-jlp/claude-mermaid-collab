import { describe, it, expect } from 'vitest';
import { formatRead } from '../read-file';

describe('formatRead', () => {
  it('renders 1-indexed line numbers', () => {
    const r = formatRead('alpha\nbeta\ngamma');
    expect(r.text).toBe('1: alpha\n2: beta\n3: gamma');
    expect(r.totalLines).toBe(3);
    expect(r.truncated).toBe(false);
    expect(r.nextOffset).toBeUndefined();
  });

  it('honors offset + limit and reports the next page', () => {
    const content = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    const r = formatRead(content, { offset: 3, limit: 4 });
    expect(r.text).toBe('3: line3\n4: line4\n5: line5\n6: line6');
    expect(r.truncated).toBe(true);
    expect(r.nextOffset).toBe(7);
  });

  it('last page has no nextOffset', () => {
    const content = 'a\nb\nc';
    const r = formatRead(content, { offset: 2, limit: 10 });
    expect(r.text).toBe('2: b\n3: c');
    expect(r.truncated).toBe(false);
    expect(r.nextOffset).toBeUndefined();
  });

  it('caps by bytes and always emits at least one line', () => {
    const huge = 'x'.repeat(100 * 1024);
    const content = `${huge}\n${huge}`;
    const r = formatRead(content);
    expect(r.text.split('\n').length).toBe(1); // only the first line fits under the cap
    expect(r.truncated).toBe(true);
    expect(r.nextOffset).toBe(2);
  });
});
