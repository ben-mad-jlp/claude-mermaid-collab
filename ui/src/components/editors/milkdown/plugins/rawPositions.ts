import { $remark } from '@milkdown/utils';
import type { Plugin } from 'unified';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { visit } from 'unist-util-visit';

export type BlockStyleBreak = 'spaces' | 'backslash' | 'html';

declare module 'mdast' {
  interface Data {
    rawTrailing?: string;
    style?: BlockStyleBreak;
    marker?: string[];
  }
}

export const remarkCaptureRawPositions: Plugin<[], Root> = () => (tree, file) => {
  const src = String((file as VFile).value ?? '');

  // Pass 1: rawTrailing on block-level children only. Limiting to parents
  // whose children are block nodes (root, listItem, blockquote) prevents
  // inline nodes (text, emphasis, strong, etc.) from being polluted with a
  // rawTrailing field that nothing downstream consumes.
  const BLOCK_PARENT_TYPES = new Set(['root', 'listItem', 'blockquote', 'list']);
  visit(tree, (node: any, index, parent: any) => {
    if (!parent || index === undefined || !Array.isArray(parent.children)) return;
    if (!BLOCK_PARENT_TYPES.has(parent.type)) return;
    if (node.position?.end?.offset == null) return;
    const next = parent.children[index + 1];
    const endOffset: number = node.position.end.offset;
    // Cap the trailing-slice to the parent's span so the last child in a
    // container doesn't capture whitespace/content after the parent ended.
    const parentEnd: number = parent.position?.end?.offset ?? src.length;
    const nextStart: number = Math.min(
      next?.position?.start?.offset ?? parentEnd,
      parentEnd,
    );
    const slice = src.slice(endOffset, nextStart);
    node.data = { ...(node.data ?? {}), rawTrailing: slice };
  });

  // Pass 2: break style
  visit(tree, 'break', (node: any) => {
    if (node.position?.start?.offset == null) return;
    const startOffset: number = node.position.start.offset;
    const endOffset: number = node.position.end?.offset ?? startOffset;
    const raw = src.slice(Math.max(0, startOffset - 3), endOffset);
    // Fixed ±2 window around startOffset for the two-space + backslash checks.
    const window2 = src.slice(Math.max(0, startOffset - 2), Math.min(src.length, startOffset + 2));
    let style: BlockStyleBreak = 'spaces';
    // Wider window (±10 back, +1 forward) preserved for the <br> html regex
    // because the tag itself is 4-5 chars; a ±2 window would miss it.
    if (/<br\s*\/?>/i.test(src.slice(Math.max(0, startOffset - 10), endOffset + 1))) {
      style = 'html';
    } else if (window2.includes('\\\n')) {
      // Only a backslash immediately followed by newline counts as a
      // backslash-style break. A bare trailing backslash in text is not a
      // line-break marker on its own.
      style = 'backslash';
    } else if (window2.endsWith('  \n') || window2.endsWith('  ') || raw.endsWith('  \n') || raw.endsWith('  ')) {
      style = 'spaces';
    }
    node.data = { ...(node.data ?? {}), style };
  });

  // Pass 3: per-list marker capture
  visit(tree, 'list', (node: any) => {
    if (!Array.isArray(node.children)) return;
    const markers: string[] = [];
    for (const item of node.children) {
      if (item?.position?.start?.offset === undefined) continue;
      const itemStart: number = item.position.start.offset;
      // Scan forward up to 8 chars to capture the marker token
      const head = src.slice(itemStart, itemStart + 8);
      const m = head.match(/^(\s*)([-*+]|\d+[.)])/);
      if (m) markers.push(m[2]);
    }
    if (markers.length > 0) {
      node.data = { ...(node.data ?? {}), marker: markers };
    }
  });
};

export const rawPositionsPlugin = $remark('rawPositions', () => remarkCaptureRawPositions);
