import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { VFile } from 'vfile';
import type { Root } from 'mdast';
import { remarkCaptureRawPositions } from '../rawPositions';

function runPlugin(md: string): Root {
  const file = new VFile({ value: md });
  const tree = unified().use(remarkParse).use(remarkGfm).parse(file) as Root;
  remarkCaptureRawPositions()(tree, file, () => {});
  return tree;
}

function findFirst(tree: Root, type: string): any {
  let out: any = null;
  const walk = (n: any) => {
    if (!out && n?.type === type) out = n;
    for (const c of n?.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}

describe('remarkCaptureRawPositions', () => {
  it('captures rawTrailing between two paragraph blocks', () => {
    const tree = runPlugin('para1\n\npara2\n');
    const first = (tree.children[0] as any);
    expect(first.data?.rawTrailing).toContain('\n\n');
  });

  it('captures rawTrailing at EOF for last block', () => {
    const tree = runPlugin('only\n');
    const last = tree.children[tree.children.length - 1] as any;
    expect(typeof last.data?.rawTrailing).toBe('string');
  });

  it('detects two-space break style', () => {
    const tree = runPlugin('a  \nb\n');
    const brk = findFirst(tree, 'break');
    expect(brk?.data?.style).toBe('spaces');
  });

  it('detects backslash break style', () => {
    const tree = runPlugin('a\\\nb\n');
    const brk = findFirst(tree, 'break');
    expect(brk?.data?.style).toBe('backslash');
  });

  it('captures dash bullet markers', () => {
    const tree = runPlugin('- one\n- two\n');
    const list = findFirst(tree, 'list');
    expect(list?.data?.marker).toEqual(['-', '-']);
  });

  it('captures ordered list markers', () => {
    const tree = runPlugin('1. one\n2. two\n');
    const list = findFirst(tree, 'list');
    expect(list?.data?.marker?.[0]).toMatch(/^1[.)]$/);
  });

  it('captures asterisk bullet markers', () => {
    const tree = runPlugin('* one\n* two\n');
    const list = findFirst(tree, 'list');
    expect(list?.data?.marker).toEqual(['*', '*']);
  });
});
