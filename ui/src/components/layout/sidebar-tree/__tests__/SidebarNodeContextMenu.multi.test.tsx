/**
 * Tests for SidebarNodeContextMenu with single-node and multi-selection support.
 *
 * Verifies:
 *  - Single-node title + node actions
 *  - Multi-selection title + intersection actions
 *  - Mixed-kind selection shows a disabled noop placeholder
 *  - Clicking actions invokes onAction(actionId, targetNodes) and onClose()
 *  - Single-node click forwards a 1-element array to onAction
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarNodeContextMenu } from '../SidebarNodeContextMenu';
import type { TreeNode } from '../getActionsForNode';

const TITLE_TESTID = 'sidebar-node-context-menu-title';

describe('SidebarNodeContextMenu - single node', () => {
  it('renders single-node title (node.name) and node actions', () => {
    const node: TreeNode = {
      kind: 'artifact',
      id: 'a1',
      name: 'Diagram One',
      artifactType: 'diagram',
    };
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        node={node}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId(TITLE_TESTID)).toHaveTextContent('Diagram One');
    expect(screen.getByTestId('menu-item-delete')).toBeInTheDocument();
  });
});

describe('SidebarNodeContextMenu - multi-selection', () => {
  it('renders multi-selection title and intersection actions for same-kind nodes', () => {
    const nodes: TreeNode[] = [
      { kind: 'artifact', id: 'a1', name: 'D1', artifactType: 'diagram' },
      { kind: 'artifact', id: 'a2', name: 'D2', artifactType: 'diagram' },
      { kind: 'artifact', id: 'a3', name: 'D3', artifactType: 'diagram' },
    ];
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        nodes={nodes}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId(TITLE_TESTID)).toHaveTextContent('3 items selected');
    expect(screen.getByTestId('menu-item-delete')).toBeInTheDocument();
  });

  it('mixed-kind selection with empty intersection shows disabled noop placeholder', () => {
    const nodes: TreeNode[] = [
      { kind: 'artifact', id: 'a1', name: 'Art', artifactType: 'diagram' },
      { kind: 'task-graph', id: 't1', name: 'Task' },
      { kind: 'blueprint', id: 'b1', name: 'BP' },
    ];
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        nodes={nodes}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId(TITLE_TESTID)).toHaveTextContent('3 items selected');
    const noop = screen.getByTestId('menu-item-noop');
    expect(noop).toBeInTheDocument();
    expect(noop).toBeDisabled();
  });

  it('clicking an action invokes onAction with (id, targetNodes) and calls onClose once', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const n1: TreeNode = { kind: 'artifact', id: 'a1', name: 'D1', artifactType: 'diagram' };
    const n2: TreeNode = { kind: 'artifact', id: 'a2', name: 'D2', artifactType: 'diagram' };
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        nodes={[n1, n2]}
        onAction={onAction}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('menu-item-delete'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('delete', [n1, n2]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SidebarNodeContextMenu - single-node click forwarding', () => {
  it('forwards a 1-element array of the node to onAction', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const node: TreeNode = {
      kind: 'artifact',
      id: 'a1',
      name: 'Diagram One',
      artifactType: 'diagram',
    };
    render(
      <SidebarNodeContextMenu
        x={0}
        y={0}
        node={node}
        onAction={onAction}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('menu-item-delete'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('delete', [node]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
