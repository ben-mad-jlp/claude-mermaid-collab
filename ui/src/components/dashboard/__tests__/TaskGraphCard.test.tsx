/**
 * TaskGraphCard Component Tests
 *
 * Tests for:
 * - Rendering diagram when data present
 * - Loading state display
 * - Error state display
 * - Close button functionality
 * - Empty state display
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskGraphCard } from '../TaskGraphCard';
import * as useTaskGraphModule from '@/hooks/useTaskGraph';

// Mock the useTaskGraph hook
vi.mock('@/hooks/useTaskGraph');

const mockUseTaskGraph = vi.mocked(useTaskGraphModule.useTaskGraph);

describe('TaskGraphCard', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'test-session';
  const mockDiagram = 'graph TD; A-->B; B-->C';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should display spinner and loading label when loading', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: null,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: true,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.getAllByText('Loading task graph...')).toHaveLength(2);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when error occurs', () => {
      const mockError = new Error('Failed to fetch diagram');
      mockUseTaskGraph.mockReturnValue({
        diagram: null,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: mockError,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.getByText('Failed to load task graph')).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch diagram')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should display empty state message when no diagram', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: null,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.getByText('No tasks available')).toBeInTheDocument();
    });
  });

  describe('diagram display', () => {
    it('should render diagram when data present', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.getByTestId('diagram-embed')).toBeInTheDocument();
      expect(screen.getByText('Task Execution Graph')).toBeInTheDocument();
    });

    it('should pass diagram content to DiagramEmbed', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      const diagramContainer = screen.getByTestId('diagram-embed-diagram');
      expect(diagramContainer).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('should render close button when onClose provided', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      const mockOnClose = vi.fn();
      render(
        <TaskGraphCard
          project={mockProject}
          session={mockSession}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByLabelText('Close task graph')).toBeInTheDocument();
    });

    it('should call onClose callback when close button clicked', async () => {
      const user = userEvent.setup();
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      const mockOnClose = vi.fn();
      render(
        <TaskGraphCard
          project={mockProject}
          session={mockSession}
          onClose={mockOnClose}
        />
      );

      const closeButton = screen.getByLabelText('Close task graph');
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not render close button when onClose not provided', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.queryByLabelText('Close task graph')).not.toBeInTheDocument();
    });
  });

  describe('card title', () => {
    it('should always display card title', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: mockDiagram,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(screen.getByText('Task Execution Graph')).toBeInTheDocument();
    });
  });

  describe('hook integration', () => {
    it('should call useTaskGraph with correct parameters', () => {
      mockUseTaskGraph.mockReturnValue({
        diagram: null,
        batches: [],
        completedTasks: [],
        pendingTasks: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <TaskGraphCard project={mockProject} session={mockSession} />
      );

      expect(mockUseTaskGraph).toHaveBeenCalledWith(mockProject, mockSession);
    });
  });
});
