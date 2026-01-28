/**
 * SessionStatusPanel tests
 *
 * Tests for the SessionStatusPanel component covering:
 * - Default (sidebar) variant with stacked layout
 * - Inline (header) variant with horizontal layout
 * - Progress bar rendering (tasks and items)
 * - Timestamp and item indicator display
 * - Dark mode class support
 * - Graceful handling of missing state
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionStatusPanel } from './SessionStatusPanel';
import type { SessionStatusPanelProps } from './SessionStatusPanel';

// Mock the session store
const mockSessionStoreState = {
  currentSession: { project: '/path/to/project', name: 'test-session' },
  sessions: [],
  diagrams: [],
  documents: [],
  selectedDiagramId: null,
  selectedDocumentId: null,
  collabState: null,
  pendingDiff: null,
  isLoading: false,
  error: null,
  setSessions: vi.fn(),
  setCurrentSession: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setDiagrams: vi.fn(),
  addDiagram: vi.fn(),
  updateDiagram: vi.fn(),
  removeDiagram: vi.fn(),
  selectDiagram: vi.fn(),
  getSelectedDiagram: vi.fn(() => undefined),
  setDocuments: vi.fn(),
  addDocument: vi.fn(),
  updateDocument: vi.fn(),
  removeDocument: vi.fn(),
  selectDocument: vi.fn(),
  getSelectedDocument: vi.fn(() => undefined),
  setCollabState: vi.fn(),
  setPendingDiff: vi.fn(),
  clearPendingDiff: vi.fn(),
  clearSession: vi.fn(),
  reset: vi.fn(),
};

vi.mock('@/stores/sessionStore', () => ({
  useSessionStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockSessionStoreState);
    }
    return mockSessionStoreState;
  }),
}));

describe('SessionStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to no collab state
    mockSessionStoreState.collabState = null;
  });

  describe('Null state handling', () => {
    it('should return null when no collabState exists', () => {
      mockSessionStoreState.collabState = null;
      const { container } = render(<SessionStatusPanel />);
      expect(container.firstChild).toBeNull();
    });

    it('should return null for inline variant when no collabState exists', () => {
      mockSessionStoreState.collabState = null;
      const { container } = render(<SessionStatusPanel variant="inline" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Default variant (sidebar)', () => {
    beforeEach(() => {
      mockSessionStoreState.collabState = {
        state: 'rough-draft-interface',
        displayName: 'Designing Interface',
        currentItem: 1,
        lastActivity: new Date(Date.now() - 5 * 60000).toISOString(), // 5 minutes ago
        completedTasks: ['task1'],
        pendingTasks: ['task2', 'task3'],
        totalItems: 3,
        documentedItems: 1,
      };
    });

    it('should render phase badge with correct text', () => {
      render(<SessionStatusPanel />);
      expect(screen.getByText('Designing Interface')).toBeInTheDocument();
    });

    it('should render phase badge with correct color classes', () => {
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Designing Interface');
      expect(badge).toHaveClass('bg-amber-100', 'dark:bg-amber-900/30', 'text-amber-700', 'dark:text-amber-300');
    });

    it('should render timestamp in relative format', () => {
      render(<SessionStatusPanel />);
      expect(screen.getByText('5m ago')).toBeInTheDocument();
    });

    it('should render current item indicator', () => {
      render(<SessionStatusPanel />);
      expect(screen.getByText(/Item 1/)).toBeInTheDocument();
    });

    it('should render progress bar with labels', () => {
      render(<SessionStatusPanel />);
      expect(screen.getByText('Items')).toBeInTheDocument();
      expect(screen.getByText('1/3')).toBeInTheDocument();
    });

    it('should render progress bar container with correct styles', () => {
      const { container } = render(<SessionStatusPanel />);
      const progressBar = container.querySelector('.h-1\\.5.bg-gray-200.dark\\:bg-gray-700');
      expect(progressBar).toBeInTheDocument();
    });

    it('should render filled progress bar with correct percentage', () => {
      const { container } = render(<SessionStatusPanel />);
      const filledBar = container.querySelector('.bg-blue-500.dark\\:bg-blue-400');
      expect(filledBar).toBeInTheDocument();
      // 1/3 = ~33%
      const filledElement = filledBar as HTMLElement;
      expect(filledElement.style.width).toBe('33%');
    });

    it('should render with border-top and gray background', () => {
      const { container } = render(<SessionStatusPanel />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('border-t', 'border-gray-200', 'dark:border-gray-700', 'bg-gray-50', 'dark:bg-gray-800/50');
    });

    it('should support custom className prop', () => {
      const { container } = render(<SessionStatusPanel className="custom-class" />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('custom-class');
    });

    it('should not render timestamp if lastActivity is missing', () => {
      mockSessionStoreState.collabState!.lastActivity = undefined;
      render(<SessionStatusPanel />);
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });

    it('should not render item indicator if currentItem is null', () => {
      mockSessionStoreState.collabState!.currentItem = null;
      render(<SessionStatusPanel />);
      expect(screen.queryByText(/·\s*Item/)).not.toBeInTheDocument();
    });

    it('should not render progress bar if no progress data', () => {
      mockSessionStoreState.collabState = {
        state: 'done',
        displayName: 'Complete',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      const { container } = render(<SessionStatusPanel />);
      const progressBar = container.querySelector('.h-1\\.5');
      expect(progressBar).not.toBeInTheDocument();
    });

    it('should render "Unknown" if displayName is missing', () => {
      mockSessionStoreState.collabState!.displayName = undefined;
      render(<SessionStatusPanel />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('should use green color for execution state with task progress', () => {
      mockSessionStoreState.collabState = {
        state: 'execute-batch',
        displayName: 'Executing',
        currentItem: 2,
        lastActivity: new Date(Date.now() - 2 * 60000).toISOString(),
        completedTasks: ['task1', 'task2'],
        pendingTasks: ['task3'],
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const filledBar = document.querySelector('.bg-green-500.dark\\:bg-green-400');
      expect(filledBar).toBeInTheDocument();
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('2/3')).toBeInTheDocument();
    });
  });

  describe('Inline variant (header)', () => {
    beforeEach(() => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring Requirements',
        currentItem: 2,
        lastActivity: new Date(Date.now() - 1 * 60000).toISOString(), // 1 minute ago
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: 5,
        documentedItems: 2,
      };
    });

    it('should render phase badge', () => {
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.getByText('Exploring Requirements')).toBeInTheDocument();
    });

    it('should render in horizontal flex layout', () => {
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('flex', 'items-center', 'gap-2', 'text-xs');
    });

    it('should render timestamp in relative format', () => {
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.getByText('1m ago')).toBeInTheDocument();
    });

    it('should render current item indicator', () => {
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.getByText(/Item 2/)).toBeInTheDocument();
    });

    it('should render inline progress bar with fixed width', () => {
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const progressBar = container.querySelector('.w-20.h-1\\.5');
      expect(progressBar).toBeInTheDocument();
    });

    it('should render progress count label next to progress bar', () => {
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.getByText('2/5')).toBeInTheDocument();
    });

    it('should render filled progress bar with correct percentage', () => {
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const filledBar = container.querySelector('.bg-blue-500.dark\\:bg-blue-400');
      expect(filledBar).toBeInTheDocument();
      // 2/5 = 40%
      const filledElement = filledBar as HTMLElement;
      expect(filledElement.style.width).toBe('40%');
    });

    it('should use blue color for brainstorming variant', () => {
      render(<SessionStatusPanel variant="inline" />);
      const filledBar = document.querySelector('.bg-blue-500.dark\\:bg-blue-400');
      expect(filledBar).toBeInTheDocument();
    });

    it('should support custom className prop', () => {
      const { container } = render(<SessionStatusPanel variant="inline" className="header-status" />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('header-status');
    });

    it('should not render timestamp if lastActivity is missing', () => {
      mockSessionStoreState.collabState!.lastActivity = undefined;
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });

    it('should not render item indicator if currentItem is null', () => {
      mockSessionStoreState.collabState!.currentItem = null;
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.queryByText(/·\s*Item/)).not.toBeInTheDocument();
    });

    it('should not render progress bar if no progress data', () => {
      mockSessionStoreState.collabState = {
        state: 'done',
        displayName: 'Complete',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const progressBar = container.querySelector('.w-20');
      expect(progressBar).not.toBeInTheDocument();
    });

    it('should render with task progress for execution state', () => {
      mockSessionStoreState.collabState = {
        state: 'execute-batch',
        displayName: 'Executing Plan',
        currentItem: 3,
        lastActivity: new Date().toISOString(),
        completedTasks: ['task1', 'task2', 'task3'],
        pendingTasks: ['task4', 'task5'],
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel variant="inline" />);
      expect(screen.getByText('3/5')).toBeInTheDocument();
      const filledBar = document.querySelector('.bg-green-500');
      expect(filledBar).toBeInTheDocument();
    });

    it('should render progress count with whitespace-nowrap', () => {
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const countLabel = screen.getByText('2/5');
      expect(countLabel).toHaveClass('whitespace-nowrap');
    });
  });

  describe('Phase color mapping', () => {
    it('should apply blue color for brainstorming phase', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Exploring');
      expect(badge).toHaveClass('bg-blue-100', 'dark:bg-blue-900/30');
    });

    it('should apply amber color for rough-draft phase', () => {
      mockSessionStoreState.collabState = {
        state: 'rough-draft-pseudocode',
        displayName: 'Writing Pseudocode',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Writing Pseudocode');
      expect(badge).toHaveClass('bg-amber-100', 'dark:bg-amber-900/30');
    });

    it('should apply green color for execution phase', () => {
      mockSessionStoreState.collabState = {
        state: 'execute-batch',
        displayName: 'Executing',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: [],
        pendingTasks: [],
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Executing');
      expect(badge).toHaveClass('bg-green-100', 'dark:bg-green-900/30');
    });

    it('should apply red color for debugging phase', () => {
      mockSessionStoreState.collabState = {
        state: 'systematic-debugging',
        displayName: 'Debugging',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Debugging');
      expect(badge).toHaveClass('bg-red-100', 'dark:bg-red-900/30');
    });

    it('should apply emerald color for done phase', () => {
      mockSessionStoreState.collabState = {
        state: 'done',
        displayName: 'Complete',
        currentItem: null,
        lastActivity: undefined,
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      const badge = screen.getByText('Complete');
      expect(badge).toHaveClass('bg-emerald-100', 'dark:bg-emerald-900/30');
    });
  });

  describe('Progress bar edge cases', () => {
    it('should show 0% progress with no completed items', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: 1,
        lastActivity: new Date().toISOString(),
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: 5,
        documentedItems: 0,
      };
      const { container } = render(<SessionStatusPanel />);
      const filledBar = container.querySelector('.bg-blue-500') as HTMLElement;
      expect(filledBar?.style.width).toBe('0%');
    });

    it('should show 100% progress with all items completed', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: 5,
        lastActivity: new Date().toISOString(),
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: 5,
        documentedItems: 5,
      };
      const { container } = render(<SessionStatusPanel />);
      const filledBar = container.querySelector('.bg-blue-500') as HTMLElement;
      expect(filledBar?.style.width).toBe('100%');
    });

    it('should handle single task completion', () => {
      mockSessionStoreState.collabState = {
        state: 'execute-batch',
        displayName: 'Executing',
        currentItem: 1,
        lastActivity: new Date().toISOString(),
        completedTasks: ['task1'],
        pendingTasks: [],
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('should calculate progress correctly with tasks', () => {
      mockSessionStoreState.collabState = {
        state: 'execute-batch',
        displayName: 'Executing',
        currentItem: 2,
        lastActivity: new Date().toISOString(),
        completedTasks: ['t1', 't2'],
        pendingTasks: ['t3', 't4', 't5', 't6'],
        totalItems: undefined,
        documentedItems: undefined,
      };
      const { container } = render(<SessionStatusPanel />);
      const filledBar = container.querySelector('.bg-green-500') as HTMLElement;
      // 2/6 = 33%
      expect(filledBar?.style.width).toBe('33%');
    });
  });

  describe('Timestamp formatting', () => {
    it('should show "just now" for recent timestamps', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: null,
        lastActivity: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      expect(screen.getByText('just now')).toBeInTheDocument();
    });

    it('should show "Xh ago" for timestamps from hours past', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: null,
        lastActivity: new Date(Date.now() - 3 * 3600000).toISOString(), // 3 hours ago
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      expect(screen.getByText('3h ago')).toBeInTheDocument();
    });

    it('should show "Xd ago" for timestamps from days past', () => {
      mockSessionStoreState.collabState = {
        state: 'brainstorm-exploring',
        displayName: 'Exploring',
        currentItem: null,
        lastActivity: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: undefined,
        documentedItems: undefined,
      };
      render(<SessionStatusPanel />);
      expect(screen.getByText('2d ago')).toBeInTheDocument();
    });
  });

  describe('Variant prop', () => {
    beforeEach(() => {
      mockSessionStoreState.collabState = {
        state: 'rough-draft-interface',
        displayName: 'Designing',
        currentItem: 1,
        lastActivity: new Date().toISOString(),
        completedTasks: undefined,
        pendingTasks: undefined,
        totalItems: 3,
        documentedItems: 1,
      };
    });

    it('should default to default variant', () => {
      const { container } = render(<SessionStatusPanel />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('border-t');
    });

    it('should render inline variant when specified', () => {
      const { container } = render(<SessionStatusPanel variant="inline" />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('flex', 'items-center', 'gap-2');
      expect(root).not.toHaveClass('border-t');
    });

    it('should render default variant when explicitly specified', () => {
      const { container } = render(<SessionStatusPanel variant="default" />);
      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('border-t');
      expect(root).not.toHaveClass('flex');
    });
  });
});
