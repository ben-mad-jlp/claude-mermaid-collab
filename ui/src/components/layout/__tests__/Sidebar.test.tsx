import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { Sidebar } from '../Sidebar';
import { useSessionStore } from '@/stores/sessionStore';
import * as useDataLoaderModule from '@/hooks/useDataLoader';

/**
 * Test suite for Sidebar component
 *
 * Uses real Zustand store state (setState) instead of spy mocks
 * so that both hook calls and direct getState() calls are covered.
 */
describe('Sidebar', () => {
  // Mock the data loader hook
  const mockUseDataLoader = vi.spyOn(useDataLoaderModule, 'useDataLoader');

  // Base state that satisfies all store consumers
  const baseState = {
    diagrams: [],
    documents: [],
    designs: [],
    spreadsheets: [],
    snippets: [],
    embeds: [],
    images: [],
    selectedDiagramId: null,
    selectedDocumentId: null,
    selectedDesignId: null,
    selectedSpreadsheetId: null,
    selectedSnippetId: null,
    collabState: null,
    currentSession: null,
    sessions: [],
    sessionTodos: [],
    sessionTodosShowCompleted: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to empty state
    useSessionStore.setState(baseState as any);

    // Mock useDataLoader
    mockUseDataLoader.mockReturnValue({
      selectDiagramWithContent: vi.fn(),
      selectDocumentWithContent: vi.fn(),
      selectDesignWithContent: vi.fn(),
      selectSpreadsheetWithContent: vi.fn(),
      isLoading: false,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test that SessionStatusPanel import is removed and component doesn't render
   */
  it('should not render SessionStatusPanel', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: { project: '/test', name: 'test-session' } as any,
      collabState: {
        state: 'execute-batch',
        displayName: 'Executing',
        currentItem: 1,
        completedTasks: [],
        pendingTasks: ['task-1'],
      } as any,
    } as any);

    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    // SessionStatusPanel should NOT be in the DOM
    expect(screen.queryByText(/executing|item \d+|tasks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/just now|[0-9]+[mhd] ago/)).not.toBeInTheDocument();
  });

  /**
   * Test that search input is still rendered
   */
  it('should render search input', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: { project: '/test', name: 'test-session' } as any,
    } as any);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const searchInput = screen.getByTestId('sidebar-search');
    expect(searchInput).toBeInTheDocument();
    // Placeholder is 'Search' in the current implementation
    expect(searchInput).toHaveAttribute('placeholder', 'Search');
  });

  /**
   * Test that sidebar renders with a session selected (no external nav links)
   */
  it('should render when session is selected', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: { project: '/test', name: 'test-session' } as any,
    } as any);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  /**
   * Test that sidebar renders properly when no session is selected
   */
  it('should show empty state when no session is selected', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: null,
    } as any);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('Select a session')).toBeInTheDocument();
  });

  /**
   * Test that sidebar has correct data-testid
   */
  it('should have sidebar data-testid', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: { project: '/test', name: 'test-session' } as any,
    } as any);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  /**
   * Test that sidebar maintains its flex layout structure
   */
  it('should have proper flex layout structure', () => {
    useSessionStore.setState({
      ...baseState,
      currentSession: { project: '/test', name: 'test-session' } as any,
    } as any);

    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const aside = container.querySelector('aside[data-testid="sidebar"]');
    expect(aside).toHaveClass('flex', 'flex-col', 'w-72');
  });

  /**
   * Test Task Graph entry display during implementation phase.
   * Implementation phase requires: collabState.batches (non-empty) AND documents with blueprint=true.
   */
  describe('Task Graph Entry', () => {
    const blueprintDoc = {
      id: 'bp1',
      name: 'feature.blueprint',
      type: 'document',
      blueprint: true,
      deprecated: false,
      content: '',
      lastModified: Date.now(),
    };

    it('should show Task Graph entry when batches exist and blueprint documents exist', () => {
      useSessionStore.setState({
        ...baseState,
        currentSession: { project: '/test', name: 'test-session' } as any,
        documents: [blueprintDoc] as any,
        collabState: { batches: [{ id: 'b1' }] } as any,
      } as any);

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      // Task Graph node should appear in the tree
      expect(screen.getByText('Task Graph')).toBeInTheDocument();
    });

    it('should NOT show Task Graph entry when no batches', () => {
      useSessionStore.setState({
        ...baseState,
        currentSession: { project: '/test', name: 'test-session' } as any,
        documents: [blueprintDoc] as any,
        collabState: { batches: [] } as any,
      } as any);

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.queryByText('Task Graph')).not.toBeInTheDocument();
    });

    it('should NOT show Task Graph entry when no blueprint documents', () => {
      useSessionStore.setState({
        ...baseState,
        currentSession: { project: '/test', name: 'test-session' } as any,
        documents: [] as any,
        collabState: { batches: [{ id: 'b1' }] } as any,
      } as any);

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.queryByText('Task Graph')).not.toBeInTheDocument();
    });

    it('should NOT show Task Graph entry when no session is selected', () => {
      useSessionStore.setState({
        ...baseState,
        currentSession: null,
        documents: [blueprintDoc] as any,
        collabState: { batches: [{ id: 'b1' }] } as any,
      } as any);

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.queryByText('Task Graph')).not.toBeInTheDocument();
    });

  });
});
