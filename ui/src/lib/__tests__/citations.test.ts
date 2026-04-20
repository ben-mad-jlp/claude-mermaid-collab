import { describe, it, expect } from 'vitest';
import { parseCitations } from '../citations';

const tc = (id: string, name: string) => ({ id, name });

describe('parseCitations', () => {
  it('returns empty array for empty string', () => {
    expect(parseCitations('', [])).toEqual([]);
  });

  it('returns single text segment when no markers present', () => {
    const result = parseCitations('just plain text', []);
    expect(result).toEqual([{ kind: 'text', value: 'just plain text' }]);
  });

  it('parses a single [[read#1]] marker with surrounding text', () => {
    const calls = [tc('read1', 'Read')];
    const result = parseCitations('Hello [[read#1]] world', calls);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ kind: 'text', value: 'Hello ' });
    expect(result[1]).toMatchObject({
      kind: 'citation',
      toolUseId: 'read1',
      toolName: 'Read',
      index: 1,
      value: '[[read#1]]',
    });
    expect(result[2]).toEqual({ kind: 'text', value: ' world' });
  });

  it('maps multiple [[read#N]] markers to the respective tool calls', () => {
    const calls = [tc('read1', 'Read'), tc('read2', 'Read')];
    const result = parseCitations('a [[read#1]] b [[read#2]] c', calls);
    const citations = result.filter((s) => s.kind === 'citation');
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ toolUseId: 'read1', index: 1 });
    expect(citations[1]).toMatchObject({ toolUseId: 'read2', index: 2 });
  });

  it('resolves mixed kinds case-insensitively and independently', () => {
    const calls = [
      tc('read1', 'Read'),
      tc('bash1', 'Bash'),
    ];
    const result = parseCitations('x [[READ#1]] y [[Bash#1]] z', calls);
    const citations = result.filter((s) => s.kind === 'citation');
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ toolUseId: 'read1', toolName: 'Read' });
    expect(citations[1]).toMatchObject({ toolUseId: 'bash1', toolName: 'Bash' });
  });

  it('renders an invalid index as a text segment with raw marker', () => {
    const calls = [tc('read1', 'Read'), tc('read2', 'Read')];
    const result = parseCitations('before [[read#5]] after', calls);
    expect(result).toEqual([
      { kind: 'text', value: 'before ' },
      { kind: 'text', value: '[[read#5]]' },
      { kind: 'text', value: ' after' },
    ]);
  });

  it('renders an unknown kind as a text segment with raw marker', () => {
    const calls = [tc('read1', 'Read')];
    const result = parseCitations('pre [[foo#1]] post', calls);
    expect(result).toEqual([
      { kind: 'text', value: 'pre ' },
      { kind: 'text', value: '[[foo#1]]' },
      { kind: 'text', value: ' post' },
    ]);
  });

  it('does not emit empty text segments between adjacent markers', () => {
    const calls = [tc('read1', 'Read'), tc('read2', 'Read')];
    const result = parseCitations('[[read#1]][[read#2]]', calls);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'citation', toolUseId: 'read1' });
    expect(result[1]).toMatchObject({ kind: 'citation', toolUseId: 'read2' });
  });

  it('does not emit empty leading or trailing text segments', () => {
    const calls = [tc('read1', 'Read'), tc('read2', 'Read')];
    const result = parseCitations('[[read#1]] middle [[read#2]]', calls);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: 'citation', toolUseId: 'read1' });
    expect(result[1]).toEqual({ kind: 'text', value: ' middle ' });
    expect(result[2]).toMatchObject({ kind: 'citation', toolUseId: 'read2' });
  });
});
