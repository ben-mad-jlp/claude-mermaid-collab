import { $nodeSchema, $remark } from '@milkdown/utils';
import type { Plugin } from 'unified';
import type { Root, RootContent, Html } from 'mdast';
import React from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';

const DETAILS_OPEN_RE = /^<details\b([^>]*)>/i;
const DETAILS_CLOSE_RE = /^<\/details>\s*$/i;
const SUMMARY_PAIR_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i;

function hasOpenAttr(attrs: string): boolean {
  // Matches `open`, `open=""`, `open="open"`, `open="true"` etc.
  return /\bopen\b/i.test(attrs);
}

/**
 * Process a children array (root or block-container) in place: find paired
 * `<details>` html nodes and replace the range with a synthetic `details`
 * mdast node. Unmatched openers are left untouched.
 */
function processChildren(children: RootContent[]): void {
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type !== 'html') {
      // Recurse into containers that themselves have children arrays.
      const maybeParent = node as unknown as { children?: RootContent[] };
      if (Array.isArray(maybeParent.children)) {
        processChildren(maybeParent.children);
      }
      i += 1;
      continue;
    }

    const htmlNode = node as Html;
    const openMatch = htmlNode.value.match(DETAILS_OPEN_RE);
    if (!openMatch) {
      i += 1;
      continue;
    }

    const attrs = openMatch[1] ?? '';
    const open = hasOpenAttr(attrs);

    // Find the matching closer among sibling html nodes. Track nesting depth.
    let depth = 1;
    let closerIdx = -1;
    for (let j = i + 1; j < children.length; j++) {
      const sib = children[j];
      if (sib.type !== 'html') continue;
      const val = (sib as Html).value;
      if (DETAILS_OPEN_RE.test(val)) {
        depth += 1;
        continue;
      }
      if (DETAILS_CLOSE_RE.test(val)) {
        depth -= 1;
        if (depth === 0) {
          closerIdx = j;
          break;
        }
      }
    }

    if (closerIdx === -1) {
      // Unmatched opener: leave html nodes untouched (graceful degradation).
      i += 1;
      continue;
    }

    // Extract summary. It may appear inside the opener html node's value
    // after `<details …>`, or as an immediately-following html sibling.
    let summary = '';
    let bodyStart = i + 1;

    const afterOpen = htmlNode.value.slice(openMatch[0].length);
    const summaryInOpen = afterOpen.match(SUMMARY_PAIR_RE);
    if (summaryInOpen) {
      summary = summaryInOpen[1].trim();
    } else if (bodyStart < closerIdx && children[bodyStart].type === 'html') {
      const candidate = (children[bodyStart] as Html).value;
      const summaryPair = candidate.match(SUMMARY_PAIR_RE);
      if (summaryPair) {
        summary = summaryPair[1].trim();
        bodyStart += 1;
      }
    }

    const bodyChildren = children.slice(bodyStart, closerIdx);
    // Recurse into body so nested details are also transformed.
    processChildren(bodyChildren);

    const detailsNodeMdast = {
      type: 'details',
      open,
      summary,
      children: bodyChildren,
    } as unknown as RootContent;

    children.splice(i, closerIdx - i + 1, detailsNodeMdast);
    i += 1;
  }
}

export const remarkRawDetails: Plugin<[], Root> = () => (tree: Root) => {
  processChildren(tree.children as RootContent[]);
};

export const rawDetailsRemarkPlugin = $remark('rawDetails', () => remarkRawDetails);

export const detailsNode = $nodeSchema('details', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    open: { default: false },
    summary: { default: '' },
  },
  parseDOM: [
    {
      tag: 'details[data-raw-details]',
      getAttrs: (dom: HTMLElement | string) => {
        if (typeof dom === 'string') return {};
        return {
          open: dom.hasAttribute('open'),
          summary: dom.getAttribute('data-summary') ?? '',
        };
      },
    },
  ],
  toDOM: (node) => {
    const attrs: Record<string, string> = {
      'data-raw-details': 'true',
      'data-summary': node.attrs.summary ?? '',
    };
    if (node.attrs.open) attrs.open = '';
    return ['details', attrs, 0];
  },
  parseMarkdown: {
    match: ({ type }) => type === 'details',
    runner: (state, node, type) => {
      state.openNode(type, {
        open: Boolean((node as { open?: boolean }).open),
        summary: (node as { summary?: string }).summary ?? '',
      });
      state.next(((node as unknown as { children?: unknown[] }).children ?? []) as never);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'details',
    runner: (state, node) => {
      const open = node.attrs.open ? ' open' : '';
      const summary: string = node.attrs.summary ?? '';
      const opener = `<details${open}>${summary ? `\n<summary>${summary}</summary>` : ''}`;
      state.addNode('html', undefined, opener);
      state.next(node.content);
      state.addNode('html', undefined, '</details>');
    },
  },
}));

export function DetailsView(): React.ReactElement {
  const { node, contentRef } = useNodeViewContext();
  const open = Boolean(node.attrs.open);
  const summary: string = node.attrs.summary ?? '';
  return React.createElement(
    'details',
    { open, 'data-raw-details': 'true' },
    React.createElement('summary', { contentEditable: false }, summary || 'Details'),
    React.createElement('div', { ref: contentRef }),
  );
}

export default detailsNode;
