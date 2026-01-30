import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { Sidebar } from '../Sidebar';
import * as useSessionStoreModule from '@/stores/sessionStore';
import * as useDataLoaderModule from '@/hooks/useDataLoader';

/**
 * Test suite for Sidebar component
 */
describe('Sidebar', () => {
  // Mock the session store
  const mockUseSessionStore = vi.spyOn(useSessionStoreModule, 'useSessionStore');
  // Mock the data loader hook
  const mockUseDataLoader = vi.spyOn(useDataLoaderModule, 'useDataLoader');

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useDataLoader
    mockUseDataLoader.mockReturnValue({
      selectDiagramWithContent: vi.fn(),
      selectDocumentWithContent: vi.fn(),
      selectWireframeWithContent: vi.fn(),
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
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: { project: '/test', name: 'test-session' } as any,
        collabState: {
          state: 'execute-batch',
          displayName: 'Executing',
          currentItem: 1,
          completedTasks: [],
          pendingTasks: ['task-1'],
        } as any,
      } as any)
    );

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
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: { project: '/test', name: 'test-session' } as any,
      } as any)
    );

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const searchInput = screen.getByTestId('sidebar-search');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Search items...');
  });

  /**
   * Test that Kodex link is still rendered
   */
  it('should render Kodex link', () => {
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: { project: '/test', name: 'test-session' } as any,
      } as any)
    );

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const kodexLink = screen.getByText('Kodex');
    expect(kodexLink).toBeInTheDocument();
    expect(kodexLink.closest('a')).toHaveAttribute('href', '/kodex');
  });

  /**
   * Test that sidebar renders properly when no session is selected
   */
  it('should show empty state when no session is selected', () => {
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: null,
      } as any)
    );

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('Select a session to view items')).toBeInTheDocument();
  });

  /**
   * Test that sidebar has correct data-testid
   */
  it('should have sidebar data-testid', () => {
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: { project: '/test', name: 'test-session' } as any,
      } as any)
    );

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
    mockUseSessionStore.mockImplementation((selector) =>
      selector({
        diagrams: [],
        documents: [],
        wireframes: [],
        selectedDiagramId: null,
        selectedDocumentId: null,
        selectedWireframeId: null,
        currentSession: { project: '/test', name: 'test-session' } as any,
      } as any)
    );

    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const aside = container.querySelector('aside[data-testid="sidebar"]');
    expect(aside).toHaveClass('flex', 'flex-col', 'w-72');
  });

  /**
   * Test Task Graph entry display during implementation phase
   */
  describe('Task Graph Entry', () => {
    it('should show Task Graph entry when in execute-batch state', () => {
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: false,
          currentSession: { project: '/test', name: 'test-session' } as any,
          collabState: { state: 'execute-batch' } as any,
          selectTaskGraph: vi.fn(),
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.getByTestId('task-graph-entry')).toBeInTheDocument();
      expect(screen.getByText('Task Graph')).toBeInTheDocument();
    });

    it('should show Task Graph entry when in ready-to-implement state', () => {
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: false,
          currentSession: { project: '/test', name: 'test-session' } as any,
          collabState: { state: 'ready-to-implement' } as any,
          selectTaskGraph: vi.fn(),
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.getByTestId('task-graph-entry')).toBeInTheDocument();
    });

    it('should NOT show Task Graph entry when not in implementation phase', () => {
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: false,
          currentSession: { project: '/test', name: 'test-session' } as any,
          collabState: { state: 'brainstorming' } as any,
          selectTaskGraph: vi.fn(),
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.queryByTestId('task-graph-entry')).not.toBeInTheDocument();
    });

    it('should NOT show Task Graph entry when no session is selected', () => {
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: false,
          currentSession: null,
          collabState: { state: 'execute-batch' } as any,
          selectTaskGraph: vi.fn(),
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      expect(screen.queryByTestId('task-graph-entry')).not.toBeInTheDocument();
    });

    it('should highlight Task Graph entry when selected', () => {
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: true,
          currentSession: { project: '/test', name: 'test-session' } as any,
          collabState: { state: 'execute-batch' } as any,
          selectTaskGraph: vi.fn(),
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      const taskGraphEntry = screen.getByTestId('task-graph-entry');
      expect(taskGraphEntry).toHaveClass('bg-accent-100');
    });

    it('should call selectTaskGraph when clicked', () => {
      const mockSelectTaskGraph = vi.fn();
      mockUseSessionStore.mockImplementation((selector) =>
        selector({
          diagrams: [],
          documents: [],
          wireframes: [],
          selectedDiagramId: null,
          selectedDocumentId: null,
          selectedWireframeId: null,
          taskGraphSelected: false,
          currentSession: { project: '/test', name: 'test-session' } as any,
          collabState: { state: 'execute-batch' } as any,
          selectTaskGraph: mockSelectTaskGraph,
        } as any)
      );

      render(
        <BrowserRouter>
          <Sidebar />
        </BrowserRouter>
      );

      const taskGraphEntry = screen.getByTestId('task-graph-entry');
      taskGraphEntry.click();

      expect(mockSelectTaskGraph).toHaveBeenCalled();
    });
  });
});
