import { describe, it, expect, beforeEach } from 'vitest';
import { groupTimeline } from '../timeline-group';
import type { AgentTimelineItem } from '@/stores/agentStore';

let counter = 0;

const makeRead = (file_path: string): AgentTimelineItem =>
  ({
    type: 'tool_call',
    id: `t${++counter}`,
    name: 'Read',
    input: { file_path },
    status: 'ok',
  }) as any;

const makeGrep = (pattern: string): AgentTimelineItem =>
  ({
    type: 'tool_call',
    id: `t${++counter}`,
    name: 'Grep',
    input: { pattern },
    status: 'ok',
  }) as any;

const makeMsg = (text: string): AgentTimelineItem =>
  ({
    type: 'message',
    id: `m${++counter}`,
    role: 'assistant',
    text,
  }) as any;

describe('groupTimeline', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('returns empty array for empty input', () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it('passes through a single Read unchanged', () => {
    const items = [makeRead('/a/b/x.ts')];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(items[0]);
  });

  it('passes through two Reads in same dir (below threshold)', () => {
    const items = [makeRead('/a/b/x.ts'), makeRead('/a/b/y.ts')];
    const result = groupTimeline(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(items[0]);
    expect(result[1]).toBe(items[1]);
  });

  it('groups three Reads under a common dir', () => {
    const items = [
      makeRead('/a/b/x.ts'),
      makeRead('/a/b/y.ts'),
      makeRead('/a/b/z.ts'),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    const group = result[0] as any;
    expect(group.kind).toBe('read');
    expect(group.items).toHaveLength(3);
    expect(typeof group.commonPrefix).toBe('string');
    expect(group.commonPrefix.startsWith('/a/b')).toBe(true);
  });

  it('passes through three Reads with no common dir', () => {
    const items = [
      makeRead('/a/x.ts'),
      makeRead('/b/y.ts'),
      makeRead('/c/z.ts'),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(items[0]);
    expect(result[1]).toBe(items[1]);
    expect(result[2]).toBe(items[2]);
  });

  it('groups three consecutive Greps', () => {
    const items = [makeGrep('foo'), makeGrep('bar'), makeGrep('baz')];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    const group = result[0] as any;
    expect(group.kind).toBe('grep');
    expect(group.items).toHaveLength(3);
  });

  it('handles mixed: 3 Reads + msg + 3 Greps + 1 Read', () => {
    const reads = [
      makeRead('/a/b/x.ts'),
      makeRead('/a/b/y.ts'),
      makeRead('/a/b/z.ts'),
    ];
    const msg = makeMsg('hello');
    const greps = [makeGrep('foo'), makeGrep('bar'), makeGrep('baz')];
    const trailingRead = makeRead('/other/q.ts');
    const items = [...reads, msg, ...greps, trailingRead];
    const result = groupTimeline(items);
    expect(result).toHaveLength(4);
    expect((result[0] as any).kind).toBe('read');
    expect((result[0] as any).items).toHaveLength(3);
    expect(result[1]).toBe(msg);
    expect((result[2] as any).kind).toBe('grep');
    expect((result[2] as any).items).toHaveLength(3);
    expect(result[3]).toBe(trailingRead);
  });

  it('passes through 2 Reads + msg + 2 Reads (neither run >= 3)', () => {
    const r1 = makeRead('/a/b/x.ts');
    const r2 = makeRead('/a/b/y.ts');
    const msg = makeMsg('divider');
    const r3 = makeRead('/a/b/z.ts');
    const r4 = makeRead('/a/b/w.ts');
    const items = [r1, r2, msg, r3, r4];
    const result = groupTimeline(items);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(r1);
    expect(result[1]).toBe(r2);
    expect(result[2]).toBe(msg);
    expect(result[3]).toBe(r3);
    expect(result[4]).toBe(r4);
  });
});
