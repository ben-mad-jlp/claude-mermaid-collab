/**
 * Tests for remarkAnnotations remark plugin
 */

import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkAnnotations, AnnotationMdastNode } from './remarkAnnotations';
import { Root, RootContent } from 'mdast';

/**
 * Helper to parse markdown and apply remarkAnnotations plugin
 */
function parseWithAnnotations(markdown: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkAnnotations);

  return processor.runSync(processor.parse(markdown)) as Root;
}

/**
 * Find annotation nodes in the AST
 */
function findAnnotations(tree: Root): AnnotationMdastNode[] {
  const annotations: AnnotationMdastNode[] = [];

  function walk(nodes: RootContent[]) {
    for (const node of nodes) {
      if ((node as AnnotationMdastNode).type === 'annotation') {
        annotations.push(node as unknown as AnnotationMdastNode);
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children as RootContent[]);
      }
    }
  }

  walk(tree.children);
  return annotations;
}

describe('remarkAnnotations', () => {
  describe('comment markers', () => {
    it('should parse comment block marker', () => {
      const markdown = '<!-- comment: This is a comment -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('comment');
      expect(annotations[0].data.text).toBe('This is a comment');
    });

    it('should parse comment inline markers', () => {
      const markdown = `<!-- comment-start: Review this section -->

Some content here

<!-- comment-end -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('comment-inline');
      expect(annotations[0].data.text).toBe('Review this section');
      expect(annotations[0].children.length).toBeGreaterThan(0);
    });
  });

  describe('propose markers', () => {
    it('should parse propose block marker', () => {
      const markdown = '<!-- status: proposed -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('propose');
      expect(annotations[0].data.text).toBeUndefined();
    });

    it('should parse propose inline markers', () => {
      const markdown = `<!-- propose-start -->

This is proposed content

<!-- propose-end -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('propose');
      expect(annotations[0].children.length).toBeGreaterThan(0);
    });
  });

  describe('approve markers', () => {
    it('should parse approve block marker', () => {
      const markdown = '<!-- status: approved -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('approve');
    });

    it('should parse approve inline markers', () => {
      const markdown = `<!-- approve-start -->

Approved content here

<!-- approve-end -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('approve');
      expect(annotations[0].children.length).toBeGreaterThan(0);
    });
  });

  describe('reject markers', () => {
    it('should parse reject block marker with reason', () => {
      const markdown = '<!-- status: rejected: Does not meet requirements -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('reject');
      expect(annotations[0].data.text).toBe('Does not meet requirements');
    });

    it('should parse reject inline markers with reason', () => {
      const markdown = `<!-- reject-start: Needs revision -->

Rejected content

<!-- reject-end -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('reject');
      expect(annotations[0].data.text).toBe('Needs revision');
      expect(annotations[0].children.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple annotations in sequence', () => {
      const markdown = `<!-- status: proposed -->

<!-- comment: Note about this -->

<!-- status: approved -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(3);
      expect(annotations[0].data.type).toBe('propose');
      expect(annotations[1].data.type).toBe('comment');
      expect(annotations[2].data.type).toBe('approve');
    });

    it('should handle inline annotation without matching end marker', () => {
      const markdown = `<!-- comment-start: Orphaned comment -->

Some content`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      // Without matching end, it should not be transformed
      expect(annotations).toHaveLength(0);
    });

    it('should handle whitespace variations in markers', () => {
      const markdown = '<!--   comment:    Lots of spaces   -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('comment');
      expect(annotations[0].data.text).toBe('Lots of spaces');
    });

    it('should preserve regular HTML comments', () => {
      const markdown = '<!-- This is just a regular HTML comment -->';
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      // Regular comments should not match any pattern
      expect(annotations).toHaveLength(0);
    });

    it('should handle nested content in inline annotations', () => {
      const markdown = `<!-- propose-start -->

# Heading

- List item 1
- List item 2

\`\`\`javascript
const x = 1;
\`\`\`

<!-- propose-end -->`;
      const tree = parseWithAnnotations(markdown);
      const annotations = findAnnotations(tree);

      expect(annotations).toHaveLength(1);
      expect(annotations[0].data.type).toBe('propose');
      // Should have multiple children (heading, list, code block)
      expect(annotations[0].children.length).toBeGreaterThan(2);
    });
  });
});
