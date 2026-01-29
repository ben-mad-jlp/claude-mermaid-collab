/**
 * WorkItemsList Component Tests
 *
 * Tests for:
 * - Rendering work items
 * - Showing "View Task Graph" button only in implementation phase
 * - Toggling task graph visibility
 * - Close callback functionality
 * - Empty state
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkItemsList } from '../WorkItemsList';
import * as sessionStoreModule from '@/stores/sessionStore';

// Mock the sessionStore
vi.mock('@/stores/sessionStore');

// Mock TaskGraphCard
vi.mock('../TaskGraphCard', () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="task-graph-card">
      <button onClick={onClose}>Close Graph</button>
      Task Graph Card
    </div>
  ),
}));

const mockUseSessionStore = vi.mocked(sessionStoreModule.useSessionStore);

describe('WorkItemsList', () => {
  const mockItems = [
    { id: '1', label: 'Task 1', completed: false },
    { id: '2', label: 'Task 2', completed: true },
    { id: '3', label: 'Task 3', completed: false },
  ];

  const mockProject = '/path/to/project';
  const mockSession = 'test-session';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('work items display', () => {
    it('should render work items list', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'brainstorm',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
      expect(screen.getByText('Task 3')).toBeInTheDocument();
    });

    it('should show empty state when no items', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'brainstorm',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={[]} />);

      expect(screen.getByText('No work items available')).toBeInTheDocument();
    });

    it('should mark completed items visually', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'brainstorm',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      const task2Span = screen.getByText('Task 2');
      expect(task2Span).toHaveClass('line-through');
    });
  });

  describe('task graph button visibility', () => {
    it('should not show button when phase is not implementation', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'brainstorm',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.queryByText('View Task Graph')).not.toBeInTheDocument();
    });

    it('should show button when phase is execute-batch', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.getByText('View Task Graph')).toBeInTheDocument();
    });

    it('should show button when phase is ready-to-implement', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'ready-to-implement',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.getByText('View Task Graph')).toBeInTheDocument();
    });

    it('should not show button when missing project', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: undefined,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.queryByText('View Task Graph')).not.toBeInTheDocument();
    });

    it('should not show button when missing session', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: undefined,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      expect(screen.queryByText('View Task Graph')).not.toBeInTheDocument();
    });
  });

  describe('task graph toggle', () => {
    it('should toggle task graph visibility on button click', async () => {
      const user = userEvent.setup();
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      // Initially, task graph should not be visible
      expect(screen.queryByTestId('task-graph-card')).not.toBeInTheDocument();

      // Click button to show
      const button = screen.getByText('View Task Graph');
      await user.click(button);

      // Task graph should now be visible
      expect(screen.getByTestId('task-graph-card')).toBeInTheDocument();
      expect(screen.getByText('Hide Task Graph')).toBeInTheDocument();

      // Click again to hide
      await user.click(screen.getByText('Hide Task Graph'));

      // Task graph should be hidden
      expect(screen.queryByTestId('task-graph-card')).not.toBeInTheDocument();
      expect(screen.getByText('View Task Graph')).toBeInTheDocument();
    });

    it('should pass correct props to TaskGraphCard', async () => {
      const user = userEvent.setup();
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(
        <WorkItemsList items={mockItems} project={mockProject} session={mockSession} />
      );

      const button = screen.getByText('View Task Graph');
      await user.click(button);

      // Component should render with correct props
      expect(screen.getByTestId('task-graph-card')).toBeInTheDocument();
    });

    it('should call onClose to hide graph when close button clicked', async () => {
      const user = userEvent.setup();
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      // Show task graph
      const button = screen.getByText('View Task Graph');
      await user.click(button);

      expect(screen.getByTestId('task-graph-card')).toBeInTheDocument();

      // Click close button
      const closeButton = screen.getByText('Close Graph');
      await user.click(closeButton);

      // Task graph should be hidden
      expect(screen.queryByTestId('task-graph-card')).not.toBeInTheDocument();
    });
  });

  describe('context handling', () => {
    it('should use props project and session when provided', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: 'store-project',
              session: 'store-session',
            },
          } as any);
        }
        return null;
      });

      const { container } = render(
        <WorkItemsList
          items={mockItems}
          project={mockProject}
          session={mockSession}
        />
      );

      // Should render without error
      expect(container.querySelector('.work-items-list')).toBeInTheDocument();
    });

    it('should fallback to store values when props not provided', () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      const { container } = render(<WorkItemsList items={mockItems} />);

      // Should render without error
      expect(container.querySelector('.work-items-list')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper aria attributes on button', async () => {
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      const button = screen.getByText('View Task Graph');
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    it('should update aria-pressed when toggled', async () => {
      const user = userEvent.setup();
      mockUseSessionStore.mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({
            collabState: {
              state: 'execute-batch',
              project: mockProject,
              session: mockSession,
            },
          } as any);
        }
        return null;
      });

      render(<WorkItemsList items={mockItems} />);

      const button = screen.getByText('View Task Graph');
      expect(button).toHaveAttribute('aria-pressed', 'false');

      await user.click(button);

      expect(button).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
