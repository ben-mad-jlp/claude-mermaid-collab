import { describe, it, expect } from 'vitest';
import { buildFolderTree, hasVisibleLeaf } from './folderTree';
import type { TreeNode } from './getActionsForNode';

function makeNode(name: string, id?: string, lastModified = 1000): TreeNode {
  return {
    id: id ?? name,
    kind: 'artifact',
    artifactType: 'diagram',
    name,
    lastModified,
  } as TreeNode;
}

describe('buildFolderTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  it('returns flat leaves for nodes with no slashes', () => {
    const result = buildFolderTree([makeNode('foo'), makeNode('bar')]);
    expect(result.every((i) => i.type === 'leaf')).toBe(true);
    const names = result.map((i) => (i as any).displayName);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
  });

  it('creates nested folders for slash-separated names', () => {
    const result = buildFolderTree([makeNode('Implementation/Wave-1/Foo.cs')]);
    expect(result[0].type).toBe('folder');
    expect((result[0] as any).name).toBe('Implementation');
    const wave = (result[0] as any).children[0];
    expect(wave.type).toBe('folder');
    expect(wave.name).toBe('Wave-1');
    const leaf = wave.children[0];
    expect(leaf.type).toBe('leaf');
    expect(leaf.displayName).toBe('Foo.cs');
  });

  it('shares folder nodes for siblings under the same parent', () => {
    const result = buildFolderTree([
      makeNode('Implementation/Wave-1/Foo.cs'),
      makeNode('Implementation/Wave-1/Bar.cs'),
    ]);
    expect(result.length).toBe(1);
    const wave = (result[0] as any).children[0];
    expect(wave.children.length).toBe(2);
  });

  it('handles multiple top-level folders', () => {
    const result = buildFolderTree([
      makeNode('A/foo'),
      makeNode('B/bar'),
    ]);
    expect(result.length).toBe(2);
    expect(result.every((i) => i.type === 'folder')).toBe(true);
  });

  it('puts folders before leaves at each level', () => {
    const result = buildFolderTree([
      makeNode('flat-node'),
      makeNode('A/leaf'),
    ]);
    expect(result[0].type).toBe('folder');
    expect(result[1].type).toBe('leaf');
  });

  it('sorts folders alphabetically', () => {
    const result = buildFolderTree([makeNode('Z/a'), makeNode('A/b')]);
    expect((result[0] as any).name).toBe('A');
    expect((result[1] as any).name).toBe('Z');
  });

  it('sorts leaves by lastModified descending', () => {
    const result = buildFolderTree([makeNode('old', 'old', 100), makeNode('new', 'new', 200)]);
    expect((result[0] as any).displayName).toBe('new');
    expect((result[1] as any).displayName).toBe('old');
  });

  it('treats names with leading slash as flat', () => {
    const result = buildFolderTree([makeNode('/bad')]);
    expect(result[0].type).toBe('leaf');
  });

  it('treats names with trailing slash as flat', () => {
    const result = buildFolderTree([makeNode('also-bad/')]);
    expect(result[0].type).toBe('leaf');
  });

  it('handles deep nesting (3+ levels)', () => {
    const result = buildFolderTree([makeNode('A/B/C/D/file')]);
    let cur: any = result[0];
    for (const seg of ['A', 'B', 'C', 'D']) {
      expect(cur.type).toBe('folder');
      expect(cur.name).toBe(seg);
      cur = cur.children[0];
    }
    expect(cur.type).toBe('leaf');
    expect(cur.displayName).toBe('file');
  });
});

describe('hasVisibleLeaf', () => {
  it('returns true when a direct child leaf is visible', () => {
    const tree = buildFolderTree([makeNode('A/foo', 'id-foo')]);
    expect(hasVisibleLeaf(tree[0] as any, new Set(['id-foo']))).toBe(true);
  });

  it('returns false when no leaves match', () => {
    const tree = buildFolderTree([makeNode('A/foo', 'id-foo')]);
    expect(hasVisibleLeaf(tree[0] as any, new Set(['other']))).toBe(false);
  });

  it('returns true for a deeply nested visible leaf', () => {
    const tree = buildFolderTree([makeNode('A/B/C/deep', 'deep-id')]);
    expect(hasVisibleLeaf(tree[0] as any, new Set(['deep-id']))).toBe(true);
  });

  it('returns false for empty visibleNodes', () => {
    const tree = buildFolderTree([makeNode('A/foo', 'id-foo')]);
    expect(hasVisibleLeaf(tree[0] as any, new Set())).toBe(false);
  });
});
