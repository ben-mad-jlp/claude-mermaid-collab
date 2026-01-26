/**
 * Remark plugin for parsing annotation markers in markdown.
 * Converts HTML comment markers into custom AST nodes for rendering.
 *
 * Supported patterns:
 * - `<!-- comment: text -->` -> comment block
 * - `<!-- comment-start: text -->...<!-- comment-end -->` -> comment inline
 * - `<!-- status: proposed -->` -> propose block
 * - `<!-- propose-start -->...<!-- propose-end -->` -> propose inline
 * - `<!-- status: approved -->` -> approve block
 * - `<!-- approve-start -->...<!-- approve-end -->` -> approve inline
 * - `<!-- status: rejected: reason -->` -> reject block
 * - `<!-- reject-start: reason -->...<!-- reject-end -->` -> reject inline
 */

import { Plugin } from 'unified';
import { Root, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';

/** Annotation marker types */
export type AnnotationType = 'comment' | 'comment-inline' | 'propose' | 'approve' | 'reject';

/** Parsed annotation data */
export interface AnnotationNode {
  type: AnnotationType;
  text?: string;        // For comment text or reject reason
  children?: RootContent[];     // For inline annotations wrapping content
}

/** Custom MDAST node for annotations */
export interface AnnotationMdastNode {
  type: 'annotation';
  data: AnnotationNode;
  children: RootContent[];
}

// Regex patterns for matching annotation markers
const COMMENT_BLOCK_PATTERN = /^<!--\s*comment:\s*(.+?)\s*-->$/;
const COMMENT_START_PATTERN = /^<!--\s*comment-start:\s*(.+?)\s*-->$/;
const COMMENT_END_PATTERN = /^<!--\s*comment-end\s*-->$/;

const PROPOSE_BLOCK_PATTERN = /^<!--\s*status:\s*proposed\s*-->$/;
const PROPOSE_START_PATTERN = /^<!--\s*propose-start\s*-->$/;
const PROPOSE_END_PATTERN = /^<!--\s*propose-end\s*-->$/;

const APPROVE_BLOCK_PATTERN = /^<!--\s*status:\s*approved\s*-->$/;
const APPROVE_START_PATTERN = /^<!--\s*approve-start\s*-->$/;
const APPROVE_END_PATTERN = /^<!--\s*approve-end\s*-->$/;

const REJECT_BLOCK_PATTERN = /^<!--\s*status:\s*rejected:\s*(.+?)\s*-->$/;
const REJECT_START_PATTERN = /^<!--\s*reject-start:\s*(.+?)\s*-->$/;
const REJECT_END_PATTERN = /^<!--\s*reject-end\s*-->$/;

/**
 * Create an annotation AST node
 * @param type - Annotation type
 * @param text - Optional text content (comment text or reject reason)
 * @param children - Optional child nodes for inline annotations
 */
function annotationNode(
  type: AnnotationType,
  text?: string | null,
  children?: RootContent[]
): AnnotationMdastNode {
  return {
    type: 'annotation',
    data: {
      type,
      text: text ?? undefined,
      children: children ?? undefined,
    },
    children: children ?? [],
  };
}

/**
 * Find a sibling node matching a pattern
 * @param parent - Parent node containing children
 * @param startIndex - Index to start searching from (exclusive)
 * @param pattern - Regex pattern to match against HTML node value
 * @returns Index of matching sibling or null if not found
 */
function findSibling(
  parent: { children: RootContent[] },
  startIndex: number,
  pattern: RegExp
): number | null {
  for (let i = startIndex + 1; i < parent.children.length; i++) {
    const node = parent.children[i];
    if (node.type === 'html' && pattern.test((node as { value: string }).value)) {
      return i;
    }
  }
  return null;
}

/**
 * Remark plugin that parses HTML comment markers into annotation nodes.
 */
export const remarkAnnotations: Plugin<[], Root> = () => {
  return (tree: Root) => {
    // Process nodes in reverse order to handle splicing correctly
    // We collect all transformations first, then apply them
    const transformations: Array<{
      parent: { children: RootContent[] };
      startIndex: number;
      endIndex: number;
      replacement: AnnotationMdastNode;
    }> = [];

    visit(tree, 'html', (node, index, parent) => {
      if (index === undefined || parent === null) return;

      const value = (node as { value: string }).value.trim();

      // Try to match comment block pattern
      let match = value.match(COMMENT_BLOCK_PATTERN);
      if (match) {
        transformations.push({
          parent: parent as { children: RootContent[] },
          startIndex: index,
          endIndex: index,
          replacement: annotationNode('comment', match[1]),
        });
        return;
      }

      // Try to match comment-start pattern
      match = value.match(COMMENT_START_PATTERN);
      if (match) {
        const endIndex = findSibling(parent as { children: RootContent[] }, index, COMMENT_END_PATTERN);
        if (endIndex !== null) {
          const children = (parent as { children: RootContent[] }).children.slice(index + 1, endIndex);
          transformations.push({
            parent: parent as { children: RootContent[] },
            startIndex: index,
            endIndex: endIndex,
            replacement: annotationNode('comment-inline', match[1], children),
          });
        }
        return;
      }

      // Try to match propose block pattern
      if (PROPOSE_BLOCK_PATTERN.test(value)) {
        transformations.push({
          parent: parent as { children: RootContent[] },
          startIndex: index,
          endIndex: index,
          replacement: annotationNode('propose'),
        });
        return;
      }

      // Try to match propose-start pattern
      if (PROPOSE_START_PATTERN.test(value)) {
        const endIndex = findSibling(parent as { children: RootContent[] }, index, PROPOSE_END_PATTERN);
        if (endIndex !== null) {
          const children = (parent as { children: RootContent[] }).children.slice(index + 1, endIndex);
          transformations.push({
            parent: parent as { children: RootContent[] },
            startIndex: index,
            endIndex: endIndex,
            replacement: annotationNode('propose', null, children),
          });
        }
        return;
      }

      // Try to match approve block pattern
      if (APPROVE_BLOCK_PATTERN.test(value)) {
        transformations.push({
          parent: parent as { children: RootContent[] },
          startIndex: index,
          endIndex: index,
          replacement: annotationNode('approve'),
        });
        return;
      }

      // Try to match approve-start pattern
      if (APPROVE_START_PATTERN.test(value)) {
        const endIndex = findSibling(parent as { children: RootContent[] }, index, APPROVE_END_PATTERN);
        if (endIndex !== null) {
          const children = (parent as { children: RootContent[] }).children.slice(index + 1, endIndex);
          transformations.push({
            parent: parent as { children: RootContent[] },
            startIndex: index,
            endIndex: endIndex,
            replacement: annotationNode('approve', null, children),
          });
        }
        return;
      }

      // Try to match reject block pattern
      match = value.match(REJECT_BLOCK_PATTERN);
      if (match) {
        transformations.push({
          parent: parent as { children: RootContent[] },
          startIndex: index,
          endIndex: index,
          replacement: annotationNode('reject', match[1]),
        });
        return;
      }

      // Try to match reject-start pattern
      match = value.match(REJECT_START_PATTERN);
      if (match) {
        const endIndex = findSibling(parent as { children: RootContent[] }, index, REJECT_END_PATTERN);
        if (endIndex !== null) {
          const children = (parent as { children: RootContent[] }).children.slice(index + 1, endIndex);
          transformations.push({
            parent: parent as { children: RootContent[] },
            startIndex: index,
            endIndex: endIndex,
            replacement: annotationNode('reject', match[1], children),
          });
        }
        return;
      }
    });

    // Apply transformations in reverse order to preserve indices
    // Sort by startIndex descending
    transformations.sort((a, b) => b.startIndex - a.startIndex);

    for (const { parent, startIndex, endIndex, replacement } of transformations) {
      // Remove nodes from startIndex to endIndex (inclusive) and insert replacement
      const deleteCount = endIndex - startIndex + 1;
      parent.children.splice(startIndex, deleteCount, replacement as unknown as RootContent);
    }
  };
};
