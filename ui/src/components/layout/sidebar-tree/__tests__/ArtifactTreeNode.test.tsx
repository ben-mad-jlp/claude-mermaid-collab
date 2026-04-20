import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('ArtifactTreeNode', () => {
  it('renders name and treeitem role', () => {
    render(<ArtifactTreeNode node={makeNode()} />);
    const item = screen.getByRole('treeitem');
    expect(item).toBeTruthy();
    expect(item.textContent).toContain('Hello');
  });

  it('aria-selected reflects selected prop', () => {
    render(<ArtifactTreeNode node={makeNode()} selected />);
    const item = screen.getByRole('treeitem');
    expect(item.getAttribute('aria-selected')).toBe('true');
    expect(item.className).toContain('bg-accent-100');
  });

  it('onClick fires on click', () => {
    const spy = vi.fn();
    render(<ArtifactTreeNode node={makeNode()} onClick={spy} />);
    fireEvent.click(screen.getByRole('treeitem'));
    expect(spy).toHaveBeenCalled();
  });

  it('onDoubleClick fires on dblclick', () => {
    const spy = vi.fn();
    render(<ArtifactTreeNode node={makeNode()} onDoubleClick={spy} />);
    fireEvent.doubleClick(screen.getByRole('treeitem'));
    expect(spy).toHaveBeenCalled();
  });

  it('onContextMenu fires on contextMenu', () => {
    const spy = vi.fn();
    render(<ArtifactTreeNode node={makeNode()} onContextMenu={spy} />);
    fireEvent.contextMenu(screen.getByRole('treeitem'));
    expect(spy).toHaveBeenCalled();
  });

  it('onKeyDown fires on keyDown', () => {
    const spy = vi.fn();
    render(<ArtifactTreeNode node={makeNode()} onKeyDown={spy} />);
    fireEvent.keyDown(screen.getByRole('treeitem'), { key: 'Enter' });
    expect(spy).toHaveBeenCalled();
  });

  it('snippet shows </> icon', () => {
    render(
      <ArtifactTreeNode node={makeNode({ artifactType: 'snippet' })} />,
    );
    expect(screen.getByText('</>')).toBeTruthy();
  });

  it('deprecated applies line-through', () => {
    render(<ArtifactTreeNode node={makeNode({ deprecated: true })} />);
    const item = screen.getByRole('treeitem');
    expect(item.className).toContain('line-through');
  });

  it('pinned indicator renders when pinned', () => {
    render(<ArtifactTreeNode node={makeNode({ pinned: true })} />);
    expect(screen.getByTestId('pin-indicator')).toBeTruthy();
  });

  it('data attributes set', () => {
    render(<ArtifactTreeNode node={makeNode()} />);
    const item = screen.getByRole('treeitem');
    expect(item.getAttribute('data-node-id')).toBe('a');
    expect(item.getAttribute('data-node-kind')).toBe('artifact');
  });
});
