import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root } from 'mdast';
import { splitTextByEmbed, remarkDiagramEmbed } from '../diagramEmbed';

describe('splitTextByEmbed', () => {
  it('returns a single empty text segment for empty input', () => {
    expect(splitTextByEmbed('')).toEqual([{ type: 'text', value: '' }]);
  });

  it('returns a single text segment for plain text', () => {
    expect(splitTextByEmbed('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ]);
  });

  it('parses an isolated diagram embed', () => {
    expect(splitTextByEmbed('{{diagram:abc}}')).toEqual([
      { type: 'embed', kind: 'diagram', refId: 'abc' },
    ]);
  });

  it('parses an isolated design embed', () => {
    expect(splitTextByEmbed('{{design:xyz}}')).toEqual([
      { type: 'embed', kind: 'design', refId: 'xyz' },
    ]);
  });

  it('alternates text and embeds correctly', () => {
    expect(
      splitTextByEmbed('before {{diagram:a}} mid {{design:b}} after'),
    ).toEqual([
      { type: 'text', value: 'before ' },
      { type: 'embed', kind: 'diagram', refId: 'a' },
      { type: 'text', value: ' mid ' },
      { type: 'embed', kind: 'design', refId: 'b' },
      { type: 'text', value: ' after' },
    ]);
  });

  it('keeps malformed empty-refId tokens as text', () => {
    expect(splitTextByEmbed('{{diagram:}}')).toEqual([
      { type: 'text', value: '{{diagram:}}' },
    ]);
  });

  it('handles two adjacent embeds without empty text between them', () => {
    expect(splitTextByEmbed('{{diagram:a}}{{design:b}}')).toEqual([
      { type: 'embed', kind: 'diagram', refId: 'a' },
      { type: 'embed', kind: 'design', refId: 'b' },
    ]);
  });

  it.skip('round-trips through Milkdown PM schema — TODO Phase 1 integration', () => {});
});

function parseMd(md: string): Root {
  const tree = unified().use(remarkParse).parse(md) as Root;
  remarkDiagramEmbed()(tree, {} as any, () => {});
  return tree;
}

describe('remarkDiagramEmbed', () => {
  it('replaces isolated embed paragraph with a diagramEmbed block', () => {
    const tree = parseMd('{{diagram:abc}}');
    expect(tree.children).toHaveLength(1);
    const node = tree.children[0] as any;
    expect(node.type).toBe('diagramEmbed');
    expect(node.kind).toBe('diagram');
    expect(node.refId).toBe('abc');
  });

  it('splits mixed paragraph into paragraph/embed/paragraph', () => {
    const tree = parseMd('before {{diagram:a}} after');
    expect(tree.children.map((c: any) => c.type)).toEqual([
      'paragraph', 'diagramEmbed', 'paragraph',
    ]);
  });

  it('handles two embeds in one paragraph', () => {
    const tree = parseMd('x {{diagram:a}} y {{design:b}} z');
    const types = tree.children.map((c: any) => c.type);
    expect(types).toEqual(['paragraph', 'diagramEmbed', 'paragraph', 'diagramEmbed', 'paragraph']);
  });

  it('handles adjacent embeds with no text between', () => {
    const tree = parseMd('{{diagram:a}}{{design:b}}');
    const types = tree.children.map((c: any) => c.type);
    expect(types).toEqual(['diagramEmbed', 'diagramEmbed']);
  });

  it('leaves plain paragraph untouched', () => {
    const tree = parseMd('just plain text');
    expect(tree.children).toHaveLength(1);
    expect((tree.children[0] as any).type).toBe('paragraph');
  });

  it('leaves malformed embed as plain text', () => {
    const tree = parseMd('{{diagram:}}');
    expect(tree.children).toHaveLength(1);
    expect((tree.children[0] as any).type).toBe('paragraph');
  });
});
