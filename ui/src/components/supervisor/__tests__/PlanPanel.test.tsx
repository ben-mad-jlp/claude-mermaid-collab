import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { FleetNode } from '../bridge/fleet/types';

// Mock @xyflow/react so each node renders as a testable button (same pattern as FleetGraph.test.tsx)
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

import PlanPanel from '../PlanPanel';
import { useSupervisorStore } from '@/stores/supervisorStore';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
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
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

describe('PlanPanel list mode', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      todosByProject: {
        '/p': [
          todo({ id: 'M', title: 'Converge X', kind: 'mission' }),
          todo({ id: 'A', title: 'Regular task', kind: 'leaf' }),
        ],
      },
    });
  });

  it('excludes mission rows from the list view', () => {
    render(<PlanPanel serverId="local" project="/p" />);
    fireEvent.click(screen.getByText('List'));
    expect(screen.queryByText('Converge X')).toBeNull();
    expect(screen.getByText('Regular task')).toBeTruthy();
    // Footer count (PlanPanel.tsx:406, `{todos.length} items`) is derived from the
    // same excludeMissions(todosByProject[project]) call as the rendered rows
    // (PlanPanel.tsx:136) — 1 item, not 2, proves the mission never entered `todos`.
    expect(screen.getByText(/1 items/)).toBeTruthy();
  });

  it('excludes mission rows from the kanban view (default mode)', () => {
    render(<PlanPanel serverId="local" project="/p" />);
    // Default mode is 'kanban' (PlanPanel.tsx:138) — no click needed.
    expect(screen.queryByText('Converge X')).toBeNull();
    expect(screen.getByText('Regular task')).toBeTruthy();
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1);
  });
});

describe('PlanPanel graph mode with epic targeting', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      todosByProject: {
        '/p': [
          todo({ id: 'E1', title: 'Epic-E1', kind: 'epic' }),
          todo({ id: 'E1a', status: 'ready', parentId: 'E1' }),
          todo({ id: 'E2', title: 'Epic-E2', kind: 'epic' }),
          todo({ id: 'E2a', status: 'ready', parentId: 'E2' }),
        ],
      },
    });
  });

  it('opening the epic graph control from the kanban lane focuses the graph on that epic, not the first epic', () => {
    render(<PlanPanel serverId="local" project="/p" />);
    // Default mode is kanban — click the open-epic-graph button on E2's lane
    const e2Lane = screen.getByTestId('epic-lane-E2');
    const openGraphBtn = within(e2Lane).getByTestId('open-epic-graph');
    fireEvent.click(openGraphBtn);
    // After clicking, mode should be 'graph' and graphEpicId should be 'E2'
    // The graph should render nodes for E2 and E2a, but not E1a
    expect(screen.getByTestId('node-E2')).toBeInTheDocument();
    expect(screen.getByTestId('node-E2a')).toBeInTheDocument();
    expect(screen.queryByTestId('node-E1a')).toBeNull();
  });
});
