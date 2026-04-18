import { $nodeSchema, $remark } from '@milkdown/utils';
import type { Plugin } from 'unified';
import type { Root, Paragraph, Text, PhrasingContent, RootContent } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { EMBED_RE, type EmbedKind } from '../../../../lib/milkdownEmbedBridge';

const EMBED_RE_G = new RegExp(EMBED_RE.source, 'g');

export type Segment =
  | { type: 'text'; value: string }
  | { type: 'embed'; kind: EmbedKind; refId: string };

export function splitTextByEmbed(text: string): Segment[] {
  if (!text) return [{ type: 'text', value: '' }];
  const segments: Segment[] = [];
  const re = new RegExp(EMBED_RE_G.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'embed',
      kind: match[1] as EmbedKind,
      refId: match[2],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  if (segments.length === 0) return [{ type: 'text', value: text }];
  return segments;
}

export const remarkDiagramEmbed: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, 'paragraph', (paragraph: Paragraph, index, parent) => {
    if (index === undefined || !parent) return;

    const newNodes: RootContent[] = [];
    let currentPhrasing: PhrasingContent[] = [];
    let hasEmbed = false;

    const flushParagraph = () => {
      if (currentPhrasing.length === 0) return;
      const hasNonWhitespace = currentPhrasing.some((child) => {
        if (child.type === 'text') return child.value.trim().length > 0;
        return true;
      });
      if (hasNonWhitespace) {
        newNodes.push({ type: 'paragraph', children: currentPhrasing } as Paragraph);
      }
      currentPhrasing = [];
    };

    for (const child of paragraph.children) {
      if (child.type !== 'text') {
        currentPhrasing.push(child);
        continue;
      }
      const segments = splitTextByEmbed(child.value);
      if (segments.length === 1 && segments[0].type === 'text') {
        currentPhrasing.push(child);
        continue;
      }
      hasEmbed = true;
      for (const seg of segments) {
        if (seg.type === 'text') {
          if (seg.value.length > 0) {
            currentPhrasing.push({ type: 'text', value: seg.value } as Text);
          }
        } else {
          flushParagraph();
          newNodes.push({
            type: 'diagramEmbed',
            kind: seg.kind,
            refId: seg.refId,
          } as unknown as RootContent);
        }
      }
    }
    flushParagraph();

    if (!hasEmbed) return;

    parent.children.splice(index, 1, ...newNodes);
    return [SKIP, index + newNodes.length];
  });
};

export const diagramEmbedRemarkPlugin = $remark('diagramEmbed', () => remarkDiagramEmbed);

export const diagramEmbedNode = $nodeSchema('diagramEmbed', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,
  attrs: {
    kind: { default: 'diagram' },
    refId: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div[data-diagram-embed]',
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === 'string') return {};
        return {
          kind: dom.getAttribute('data-kind') ?? 'diagram',
          refId: dom.getAttribute('data-ref-id') ?? '',
        };
      },
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-diagram-embed': '',
      'data-kind': node.attrs.kind,
      'data-ref-id': node.attrs.refId,
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'diagramEmbed',
    runner: (state, node, type) => {
      state.addNode(type, {
        kind: (node as { kind?: string }).kind ?? 'diagram',
        refId: (node as { refId?: string }).refId ?? '',
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'diagramEmbed',
    runner: (state, node) => {
      state.openNode('paragraph');
      state.addNode('text', undefined, `{{${node.attrs.kind}:${node.attrs.refId}}}`);
      state.closeNode();
    },
  },
}));

export default diagramEmbedNode;
