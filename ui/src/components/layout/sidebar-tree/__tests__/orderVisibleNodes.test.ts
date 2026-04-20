import { describe, it, expect } from 'vitest';
import { orderVisibleNodes, type VisibleTreeNode } from '../orderVisibleNodes';

describe('orderVisibleNodes', () => {
  it('returns [] for empty input', () => {
    expect(orderVisibleNodes([], new Set())).toEqual([]);
  });

  it('returns flat leaves in order with empty collapsed set', () => {
    const roots: VisibleTreeNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(orderVisibleNodes(roots, new Set())).toEqual(['a', 'b', 'c']);
  });

  it('traverses nested children depth-first with empty collapsed set', () => {
    const roots: VisibleTreeNode[] = [
      { id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'b' },
    ];
    expect(orderVisibleNodes(roots, new Set())).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('skips descendants of collapsed node but still emits its id', () => {
    const roots: VisibleTreeNode[] = [
      { id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'b' },
    ];
    expect(orderVisibleNodes(roots, new Set(['a']))).toEqual(['a', 'b']);
  });

  it('handles deep nesting with an intermediate collapsed node', () => {
    const roots: VisibleTreeNode[] = [
      {
        id: 'a',
        children: [
          { id: 'a1', children: [{ id: 'a1a' }] },
          { id: 'a2' },
        ],
      },
    ];
    expect(orderVisibleNodes(roots, new Set(['a1']))).toEqual(['a', 'a1', 'a2']);
  });

  it('ignores collapsed ids that do not appear in the tree', () => {
    const roots: VisibleTreeNode[] = [
      { id: 'a', children: [{ id: 'a1' }] },
      { id: 'b' },
    ];
    expect(orderVisibleNodes(roots, new Set(['does-not-exist']))).toEqual([
      'a',
      'a1',
      'b',
    ]);
  });

  it('treats a node with children:[] as a leaf', () => {
    const roots: VisibleTreeNode[] = [
      { id: 'a', children: [] },
      { id: 'b' },
    ];
    expect(orderVisibleNodes(roots, new Set())).toEqual(['a', 'b']);
  });
});
