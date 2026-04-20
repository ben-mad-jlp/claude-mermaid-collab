import { describe, it, expect, beforeEach } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

import {
  getHeadingSectionId,
  createHeadingCollapsePlugin,
  headingCollapsePluginKey,
  __resetHeadingCollapseStateForTests,
  __setHeadingCollapseExpandedForTests,
} from '../plugins/headingCollapse';

// Minimal PM schema with heading, paragraph, text so we can exercise the
// decoration builder without spinning up Milkdown.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    text: { group: 'inline' },
  },
});

function docFromMarkdownLike() {
  // # H1
  // para1
  // ## H2
  // para2
  // # H1b
  // para3
  const { heading, paragraph, text, doc } = schema.nodes;
  return doc.create({}, [
    heading.create({ level: 1 }, text.schema.text('H1')),
    paragraph.create({}, text.schema.text('para1')),
    heading.create({ level: 2 }, text.schema.text('H2')),
    paragraph.create({}, text.schema.text('para2')),
    heading.create({ level: 1 }, text.schema.text('H1b')),
    paragraph.create({}, text.schema.text('para3')),
  ]);
}

describe('getHeadingSectionId', () => {
  beforeEach(() => {
    __resetHeadingCollapseStateForTests();
  });

  it('is deterministic per-pos', () => {
    expect(getHeadingSectionId(0)).toBe('heading-0');
    expect(getHeadingSectionId(42)).toBe('heading-42');
    expect(getHeadingSectionId(0)).toBe(getHeadingSectionId(0));
  });

  it('differs across positions', () => {
    expect(getHeadingSectionId(1)).not.toBe(getHeadingSectionId(2));
  });
});

describe('heading-collapse PM plugin decorations', () => {
  beforeEach(() => {
    __resetHeadingCollapseStateForTests();
  });

  it('produces no decorations when all sections are expanded', () => {
    const doc = docFromMarkdownLike();
    const plugin = createHeadingCollapsePlugin();
    const state = EditorState.create({ doc, plugins: [plugin] });
    const ps = headingCollapsePluginKey.getState(state);
    expect(ps).toBeDefined();
    // empty expanded set means everything is collapsed — after a reset,
    // expanded starts empty, so we expect SOME decorations by default.
    // Flip to verify: set all-expanded, rebuild via meta tx.
    const headings: number[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name === 'heading') headings.push(pos);
      return false;
    });
    __setHeadingCollapseExpandedForTests(
      headings.map((p) => getHeadingSectionId(p)),
    );
    const tr = state.tr.setMeta('heading-collapse-bump', 1);
    const next = state.apply(tr);
    const nps = headingCollapsePluginKey.getState(next);
    expect(nps).toBeDefined();
    // With every heading expanded, decorationSet should have 0 decos.
    // DecorationSet exposes .find() to list decorations in a range.
    const decos = nps!.decorations
      .find(0, doc.content.size)
      .filter((d) => (d as any).type.attrs?.class?.includes('section-collapsed'));
    expect(decos.length).toBe(0);
  });

  it('hides blocks under collapsed headings up to next same-or-higher level', () => {
    const doc = docFromMarkdownLike();
    const plugin = createHeadingCollapsePlugin();
    // Collapse only the first H1.
    const headings: { pos: number; level: number }[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name === 'heading') {
        headings.push({ pos, level: n.attrs.level });
      }
      return false;
    });
    // Expanded set: all headings EXCEPT first H1. Known set: all headings
    // (so the first-H1's id is known — otherwise it would default to expanded).
    const allIds = headings.map((h) => getHeadingSectionId(h.pos));
    const expanded = headings
      .filter((_, i) => i !== 0)
      .map((h) => getHeadingSectionId(h.pos));
    __setHeadingCollapseExpandedForTests(expanded, allIds);

    const state = EditorState.create({ doc, plugins: [plugin] });
    const ps = headingCollapsePluginKey.getState(state);
    expect(ps).toBeDefined();
    const decos = ps!.decorations
      .find(0, doc.content.size)
      .filter((d) => (d as any).type.attrs?.class?.includes('section-collapsed'));
    // Should decorate: para1, H2, para2 (everything until next H1b at index 4).
    expect(decos.length).toBe(3);
  });
});
