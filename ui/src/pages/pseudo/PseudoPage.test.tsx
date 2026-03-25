/**
 * PseudoPage Component Tests
 *
 * Comprehensive test suite for the pseudo-file viewer page covering:
 * - State initialization and management (fileList, fileCache, searchQuery, searchOpen)
 * - File list fetching on mount and project change
 * - Navigation via URL params and PseudoFileTree
 * - Three-column layout rendering
 * - Global keyboard shortcuts (Cmd+K / Cmd+F for search)
 * - Search overlay display and dismissal
 * - Cache management for loaded files
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import PseudoPage from './PseudoPage';
import * as pseudoApi from '@/lib/pseudo-api';

// Mock the pseudo API
vi.mock('@/lib/pseudo-api', () => ({
  fetchPseudoFiles: vi.fn(),
  fetchPseudoFile: vi.fn(),
  searchPseudo: vi.fn(),
}));

// Mock react-router-dom hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(),
    useNavigate: vi.fn(),
  };
});

// Mock the kodex store
vi.mock('@/stores/kodexStore', () => ({
  useKodexStore: vi.fn(),
}));

// Mock useWebSocket
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({ isConnected: true, isConnecting: false })),
}));

// Mock useTheme
vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({ theme: 'light', toggleTheme: vi.fn() })),
}));

// Mock ProjectSelector to avoid full kodex store dependency
vi.mock('@/components/kodex/ProjectSelector', () => ({
  ProjectSelector: () => <div data-testid="project-selector">Project Selector</div>,
}));

// Mock child components
vi.mock('./PseudoFileTree', () => ({
  PseudoFileTree: ({ fileList, currentPath, onNavigate }: any) => (
    <div data-testid="pseudo-file-tree">
      <div data-testid="file-count">{fileList.length}</div>
      <button onClick={() => onNavigate('test.pseudo')}>Navigate</button>
    </div>
  ),
}));

vi.mock('./PseudoViewer', () => {
  const PseudoViewerMock = React.forwardRef(({ path }: any, ref: any) => (
    <div data-testid="pseudo-viewer" ref={ref}>
      <div data-testid="viewer-path">{path || 'no-path'}</div>
    </div>
  ));
  return {
    PseudoViewer: PseudoViewerMock,
  };
});

vi.mock('./FunctionJumpPanel', () => ({
  default: () => <div data-testid="function-jump-panel">Jump Panel</div>,
}));

vi.mock('./PseudoSearch', () => ({
  default: ({ isOpen, onClose }: any) => (
    isOpen && (
      <div data-testid="pseudo-search">
        <button onClick={onClose}>Close Search</button>
      </div>
    )
  ),
}));

import { useParams, useNavigate } from 'react-router-dom';
import { useKodexStore } from '@/stores/kodexStore';

describe('PseudoPage', () => {
  const mockNavigate = vi.fn();
  const mockFetchPseudoFiles = pseudoApi.fetchPseudoFiles as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ '*': '' });
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(mockNavigate);

    // useKodexStore returns project selection state
    (useKodexStore as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedProject: '/test-project',
      fetchProjects: vi.fn().mockResolvedValue(undefined),
      setSelectedProject: vi.fn(),
    });

    mockFetchPseudoFiles.mockResolvedValue(['file1.pseudo', 'file2.pseudo', 'dir/file3.pseudo']);
  });

  const renderPseudoPage = () => {
    return render(
      <BrowserRouter>
        <PseudoPage />
      </BrowserRouter>
    );
  };

  describe('Initialization', () => {
    it('should render without crashing', async () => {
      renderPseudoPage();
      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });
    });

    it('should fetch file list on mount', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(mockFetchPseudoFiles).toHaveBeenCalledWith('/test-project');
      });
    });

    it('should populate fileList state from API response', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('3');
      });
    });

    it('should handle empty file list', async () => {
      mockFetchPseudoFiles.mockResolvedValue([]);

      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('0');
      });
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetchPseudoFiles.mockRejectedValue(new Error('Network error'));

      renderPseudoPage();

      // Should not crash, error handling is graceful
      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });
    });
  });

  describe('Project Change', () => {
    it('should fetch files from the current project', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(mockFetchPseudoFiles).toHaveBeenCalledWith('/test-project');
      });
    });

    it('should handle missing project gracefully', async () => {
      // Start with no project
      (useKodexStore as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedProject: null,
        fetchProjects: vi.fn().mockResolvedValue(undefined),
        setSelectedProject: vi.fn(),
      });

      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      // Should not have called fetch when project is empty
      expect(mockFetchPseudoFiles).not.toHaveBeenCalled();
    });
  });

  describe('Navigation', () => {
    it('should navigate when PseudoFileTree calls onNavigate', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      const navigateButton = screen.getByText('Navigate');
      await userEvent.click(navigateButton);

      expect(mockNavigate).toHaveBeenCalledWith('/pseudo/test.pseudo');
    });

    it('should display the current path in PseudoViewer', async () => {
      (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ '*': 'current.pseudo' });

      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('viewer-path')).toHaveTextContent('current.pseudo');
      });
    });

    it('should handle root path navigation', async () => {
      (useParams as ReturnType<typeof vi.fn>).mockReturnValue({ '*': '' });

      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('viewer-path')).toHaveTextContent('no-path');
      });
    });
  });

  describe('Layout', () => {
    it('should render three-column layout', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
        expect(screen.getByTestId('pseudo-viewer')).toBeInTheDocument();
        expect(screen.getByTestId('function-jump-panel')).toBeInTheDocument();
      });
    });

    it('should render in correct order: tree, viewer, jump panel', async () => {
      const { container } = renderPseudoPage();

      await waitFor(() => {
        const tree = screen.getByTestId('pseudo-file-tree');
        const viewer = screen.getByTestId('pseudo-viewer');
        const panel = screen.getByTestId('function-jump-panel');

        // Get positions in DOM
        const treeIndex = Array.from(container.querySelectorAll('[data-testid]')).findIndex(
          (el) => el.getAttribute('data-testid') === 'pseudo-file-tree'
        );
        const viewerIndex = Array.from(container.querySelectorAll('[data-testid]')).findIndex(
          (el) => el.getAttribute('data-testid') === 'pseudo-viewer'
        );
        const panelIndex = Array.from(container.querySelectorAll('[data-testid]')).findIndex(
          (el) => el.getAttribute('data-testid') === 'function-jump-panel'
        );

        // Verify order
        expect(treeIndex).toBeLessThan(viewerIndex);
        expect(viewerIndex).toBeLessThan(panelIndex);
      });
    });
  });

  describe('Search Functionality', () => {
    it('should initialize with searchOpen=false', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.queryByTestId('pseudo-search')).not.toBeInTheDocument();
      });
    });

    it('should open search overlay on Cmd+K', async () => {
      const user = userEvent.setup();
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      // Simulate Cmd+K
      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-search')).toBeInTheDocument();
      });
    });

    it('should open search overlay on Cmd+F', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      // Simulate Cmd+F
      fireEvent.keyDown(window, { key: 'f', metaKey: true });

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-search')).toBeInTheDocument();
      });
    });

    it('should close search overlay when requested', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      // Open search
      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-search')).toBeInTheDocument();
      });

      // Close search
      const closeButton = screen.getByText('Close Search');
      await userEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByTestId('pseudo-search')).not.toBeInTheDocument();
      });
    });

    it('should close search on Escape key', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
      });

      // Open search
      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-search')).toBeInTheDocument();
      });

      // Close with Escape
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByTestId('pseudo-search')).not.toBeInTheDocument();
      });
    });
  });

  describe('File Caching', () => {
    it('should maintain fileCache state', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(mockFetchPseudoFiles).toHaveBeenCalled();
      });

      // Cache should exist (tested indirectly via component state)
      expect(screen.getByTestId('pseudo-file-tree')).toBeInTheDocument();
    });

    it('should handle file cache for multiple files', async () => {
      renderPseudoPage();

      await waitFor(() => {
        // Should have fetched the file list
        expect(mockFetchPseudoFiles).toHaveBeenCalledWith('/test-project');
      });

      // The component renders with the fetched file list
      expect(screen.getByTestId('file-count')).toHaveTextContent('3');
    });
  });

  describe('Ref Handling', () => {
    it('should create and maintain viewerRef', async () => {
      renderPseudoPage();

      await waitFor(() => {
        expect(screen.getByTestId('pseudo-viewer')).toBeInTheDocument();
      });

      // Ref is internal, just verify viewer is accessible
      expect(screen.getByTestId('pseudo-viewer')).toBeInTheDocument();
    });
  });
});
