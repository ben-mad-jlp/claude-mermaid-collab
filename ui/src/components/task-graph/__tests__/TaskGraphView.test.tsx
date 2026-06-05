/**
 * TaskGraphView Component Tests
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskGraphView } from '../TaskGraphView';

// Mock useTaskGraph hook
vi.mock('@/hooks/useTaskGraph', () => ({
  useTaskGraph: vi.fn(),
}));

// Mock FleetGraph — the shared React Flow canvas the task view now reuses.
vi.mock('@/components/supervisor/bridge/fleet/FleetGraph', () => ({
  FleetGraph: ({ todos }: { todos: unknown[] }) => (
    <div data-testid="fleet-graph">{todos.length} todos</div>
  ),
}));

// Mock UI store
vi.mock('@/stores/uiStore', () => ({
  useUIStore: () => ({
    zoomLevel: 100,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setZoomLevel: vi.fn(),
  }),
}));

import { useTaskGraph } from '@/hooks/useTaskGraph';

const mockUseTaskGraph = vi.mocked(useTaskGraph);

describe('TaskGraphView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state', () => {
    mockUseTaskGraph.mockReturnValue({
      diagram: null,
      batches: [],
      completedTasks: [],
      pendingTasks: [],
      isLoading: true,
      error: null,
      refresh: vi.fn(),
    });

    render(<TaskGraphView project="/test/project" session="test-session" />);

    expect(screen.getByText('Loading task graph...')).toBeInTheDocument();
  });

  it('should show error state with retry button', async () => {
    const mockRefresh = vi.fn();
    mockUseTaskGraph.mockReturnValue({
      diagram: null,
      batches: [],
      completedTasks: [],
      pendingTasks: [],
      isLoading: false,
      error: new Error('Test error message'),
      refresh: mockRefresh,
    });

    render(<TaskGraphView project="/test/project" session="test-session" />);

    expect(screen.getByText('Error loading task graph')).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();

    const retryButton = screen.getByText('Retry');
    retryButton.click();

    expect(mockRefresh).toHaveBeenCalled();
  });

  it('should show empty state when no diagram', () => {
    mockUseTaskGraph.mockReturnValue({
      diagram: null,
      batches: [],
      completedTasks: [],
      pendingTasks: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<TaskGraphView project="/test/project" session="test-session" />);

    expect(screen.getByText('No task graph available')).toBeInTheDocument();
    expect(screen.getByText('Task graph will appear during implementation phase')).toBeInTheDocument();
  });

  it('should render the shared FleetGraph when a task graph is present', () => {
    const testDiagram = 'graph TD; A-->B; B-->C';
    mockUseTaskGraph.mockReturnValue({
      diagram: testDiagram,
      batches: [],
      completedTasks: ['task-1'],
      pendingTasks: ['task-2'],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<TaskGraphView project="/test/project" session="test-session" />);

    expect(screen.getByTestId('fleet-graph')).toBeInTheDocument();
  });

  it('should pass correct project and session to useTaskGraph', () => {
    mockUseTaskGraph.mockReturnValue({
      diagram: null,
      batches: [],
      completedTasks: [],
      pendingTasks: [],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<TaskGraphView project="/my/project/path" session="my-session-name" />);

    expect(mockUseTaskGraph).toHaveBeenCalledWith('/my/project/path', 'my-session-name');
  });
});
