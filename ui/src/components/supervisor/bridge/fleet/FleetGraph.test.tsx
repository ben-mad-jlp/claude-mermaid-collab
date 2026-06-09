/**
 * FleetGraph (G8) — clicking a todo NODE surfaces that todo's detail in the left
 * instrument panel via the onSelectTodo callback. We mock @xyflow/react so each
 * node renders as a plain button that forwards the click through onNodeClick —
 * this exercises the real onNodeClick resolution (node.id → full SessionTodo)
 * without the ReactFlow canvas, which doesn't lay out / hit-test in jsdom.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FleetNode } from './types';

// Render each computed node as a testable button that forwards onNodeClick.
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReactFlow: () => ({ fitView: () => {} }),
  ReactFlow: ({
    nodes,
    onNodeClick,
  }: {
    nodes: FleetNode[];
    onNodeClick: (e: unknown, n: FleetNode) => void;
  }) => (
    <div>
      {nodes.map((n) => (
        <button key={n.id} data-testid={`node-${n.id}`} onClick={(e) => onNodeClick(e, n)}>
          {n.id}
        </button>
      ))}
    </div>
  ),
}));

import { FleetGraph } from './FleetGraph';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.title ?? p.id,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    ...p,
  } as SessionTodo;
}

describe('FleetGraph G8 — todo node click', () => {
  it('calls onSelectTodo with the full resolved todo when a todo node is clicked', () => {
    const onSelectTodo = vi.fn();
    const todos = [todo({ id: 'L1', title: 'Ship the thing' })];
    render(<FleetGraph todos={todos} onSelectTodo={onSelectTodo} />);

    fireEvent.click(screen.getByTestId('node-L1'));

    expect(onSelectTodo).toHaveBeenCalledTimes(1);
    const arg = onSelectTodo.mock.calls[0][0] as SessionTodo;
    expect(arg.id).toBe('L1');
    expect(arg.title).toBe('Ship the thing'); // the title the detail card renders
  });
});
