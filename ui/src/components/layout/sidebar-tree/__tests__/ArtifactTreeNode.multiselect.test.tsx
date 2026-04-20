import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ArtifactTreeNode } from '../ArtifactTreeNode';
import type { TreeNode } from '../getActionsForNode';

function makeNode(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    id: 'a',
    kind: 'artifact',
    artifactType: 'diagram',
    name: 'Hello',
    ...overrides,
  };
}

describe('ArtifactTreeNode multi-selection', () => {
  it('renders ring classes when isInMultiSelection is true', () => {
    const { getByRole } = render(
      <ArtifactTreeNode node={makeNode()} isInMultiSelection />,
    );
    const item = getByRole('treeitem');
    expect(item.className).toContain('ring-2');
    expect(item.className).toContain('ring-accent-500');
  });

  it('does NOT render ring when isInMultiSelection is false/omitted', () => {
    const { getByRole, rerender } = render(
      <ArtifactTreeNode node={makeNode()} />,
    );
    let item = getByRole('treeitem');
    expect(item.className).not.toContain('ring-2');
    expect(item.className).not.toContain('ring-accent-500');

    rerender(<ArtifactTreeNode node={makeNode()} isInMultiSelection={false} />);
    item = getByRole('treeitem');
    expect(item.className).not.toContain('ring-2');
    expect(item.className).not.toContain('ring-accent-500');
  });

  it('applies both selected and multi-selection classes together', () => {
    const { getByRole } = render(
      <ArtifactTreeNode node={makeNode()} selected isInMultiSelection />,
    );
    const item = getByRole('treeitem');
    expect(item.className).toContain('bg-accent-100');
    expect(item.className).toContain('ring-2');
    expect(item.className).toContain('ring-accent-500');
  });

  it('onClick receives MouseEvent with ctrlKey=true', () => {
    const spy = vi.fn();
    const { getByRole } = render(
      <ArtifactTreeNode node={makeNode()} onClick={spy} />,
    );
    fireEvent.click(getByRole('treeitem'), { ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0];
    expect(evt.ctrlKey).toBe(true);
  });

  it('onContextMenu receives event with shiftKey=true', () => {
    const spy = vi.fn();
    const { getByRole } = render(
      <ArtifactTreeNode node={makeNode()} onContextMenu={spy} />,
    );
    fireEvent.contextMenu(getByRole('treeitem'), { shiftKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const evt = spy.mock.calls[0][0];
    expect(evt.shiftKey).toBe(true);
  });
});
