import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent } from 'mdast';

import { remarkRawDetails } from '../plugins/rawDetails';

function parse(md: string): Root {
  const processor = unified().use(remarkParse).use(remarkRawDetails);
  const tree = processor.parse(md) as Root;
  return processor.runSync(tree) as Root;
}

describe('remarkRawDetails', () => {
  it('folds paired <details>/<summary> into a synthetic details node', () => {
    const md = [
      '<details>',
      '<summary>Expand me</summary>',
      '',
      'Hidden body paragraph.',
      '',
      '</details>',
      '',
    ].join('\n');

    const tree = parse(md);
    const details = tree.children.find((c) => c.type === 'details') as unknown as
      | { type: string; open: boolean; summary: string; children: RootContent[] }
      | undefined;

    expect(details).toBeDefined();
    expect(details!.open).toBe(false);
    expect(details!.summary).toBe('Expand me');
    expect(Array.isArray(details!.children)).toBe(true);
    expect(details!.children.length).toBeGreaterThan(0);
  });

  it('detects the open attribute', () => {
    const md = [
      '<details open>',
      '<summary>Visible</summary>',
      '',
      'Body.',
      '',
      '</details>',
      '',
    ].join('\n');

    const tree = parse(md);
    const details = tree.children.find((c) => c.type === 'details') as unknown as
      | { open: boolean; summary: string }
      | undefined;
    expect(details).toBeDefined();
    expect(details!.open).toBe(true);
    expect(details!.summary).toBe('Visible');
  });

  it('leaves unmatched <details> openers as raw html (graceful degradation)', () => {
    const md = ['<details>', '<summary>No closer</summary>', '', 'Body.', ''].join('\n');
    const tree = parse(md);
    const hasDetails = tree.children.some((c) => c.type === 'details');
    const hasHtml = tree.children.some((c) => c.type === 'html');
    expect(hasDetails).toBe(false);
    expect(hasHtml).toBe(true);
  });

  it('does not throw on empty input', () => {
    expect(() => parse('')).not.toThrow();
  });
});
