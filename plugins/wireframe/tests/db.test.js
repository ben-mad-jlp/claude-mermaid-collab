import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../src/wireframeDb.js';

describe('Wireframe Database', () => {
  beforeEach(() => {
    db.clear();
  });

  it('should build tree from flat nodes', () => {
    const nodes = [
      { type: 'col', indent: 0, modifiers: {}, children: [] },
      { type: 'Text', label: 'Hello', indent: 2, modifiers: {}, children: [] },
      { type: 'Button', label: 'Save', indent: 2, modifiers: {}, children: [] }
    ];

    db.addNodes({ viewport: 'default', nodes });
    const { tree } = db.getData();

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('col');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].type).toBe('Text');
    expect(tree[0].children[1].type).toBe('Button');
  });

  it('should handle nested containers', () => {
    const nodes = [
      { type: 'col', indent: 0, modifiers: {}, children: [] },
      { type: 'row', indent: 2, modifiers: {}, children: [] },
      { type: 'Button', label: 'Save', indent: 4, modifiers: {}, children: [] }
    ];

    db.addNodes({ viewport: 'default', nodes });
    const { tree } = db.getData();

    expect(tree[0].children[0].type).toBe('row');
    expect(tree[0].children[0].children[0].type).toBe('Button');
  });

  it('should not mutate input nodes', () => {
    const nodes = [
      { type: 'col', indent: 0, modifiers: {}, children: [] },
      { type: 'Text', label: 'Hello', indent: 2, modifiers: {}, children: [] }
    ];

    // Store original reference
    const originalFirstNode = nodes[0];
    const originalSecondNode = nodes[1];

    db.addNodes({ viewport: 'default', nodes });

    // Verify originals are unchanged
    expect(originalFirstNode.children).toHaveLength(0);
    expect(originalSecondNode.children).toHaveLength(0);
  });

  it('should protect internal state from external modifications', () => {
    const nodes = [
      { type: 'col', indent: 0, modifiers: {}, children: [] },
      { type: 'Text', label: 'Hello', indent: 2, modifiers: {}, children: [] }
    ];

    db.addNodes({ viewport: 'default', nodes });

    // Try to corrupt internal state via return value
    const { tree } = db.getData();
    tree[0].type = 'HACKED';

    // Verify internal state is unchanged
    const { tree: tree2 } = db.getData();
    expect(tree2[0].type).toBe('col');
  });
});
