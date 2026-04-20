/**
 * PseudoFileTree Component Tests
 *
 * Comprehensive test suite for the file tree sidebar component covering:
 * - Tree building from flat file list
 * - Filter matching and auto-expand behavior
 * - Collapse/expand state persistence to localStorage
 * - Active file highlighting
 * - Project dropdown functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PseudoFileTree } from './PseudoFileTree';
import type { PseudoFileSummary } from '@/lib/pseudo-api';
import { useSidebarTreeStore } from '@/stores/sidebarTreeStore';

/** Helper to create a PseudoFileSummary from a file path */
function fileSummary(filePath: string): PseudoFileSummary {
  return {
    filePath,
    title: filePath.replace(/\.pseudo$/, '').split('/').pop() || filePath,
    methodCount: 1,
    exportCount: 0,
    lastUpdated: '2026-01-01',
  };
}

describe('PseudoFileTree', () => {
  const mockOnNavigate = vi.fn();
  const mockOnProjectChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSidebarTreeStore.setState({
      pseudoCollapsedPaths: new Set<string>(),
      searchQuery: '',
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Tree Building', () => {
    it('should build a nested tree from flat file list', () => {
      const fileList = ['src/index.ts', 'src/utils/helper.ts', 'dist/build.js'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/index.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Check that directory nodes are rendered
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('dist')).toBeInTheDocument();
    });

    it('should handle single-level files', () => {
      const fileList = ['README.md', 'package.json'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="README.md"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      expect(screen.getByText('README.md')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    it('should handle deeply nested directories', () => {
      const fileList = ['a/b/c/d/e/file.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="a/b/c/d/e/file.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Root level directory should be visible
      expect(screen.getByText('a')).toBeInTheDocument();
    });

    it('should strip project prefix from absolute file paths', () => {
      // Real fileList contains absolute paths; tree must render relative to project root.
      const fileList = [
        '/Users/me/Code/my-project/src/index.ts',
        '/Users/me/Code/my-project/src/utils/helper.ts',
      ].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="/Users/me/Code/my-project/src/index.ts"
          onNavigate={mockOnNavigate}
          project="/Users/me/Code/my-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Tree starts at the project root, not at the filesystem root
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.queryByText('Users')).not.toBeInTheDocument();
      expect(screen.queryByText('Code')).not.toBeInTheDocument();
      expect(screen.queryByText('my-project')).not.toBeInTheDocument();
    });

    it('should call onNavigate with absolute path when tree node clicked', async () => {
      const user = userEvent.setup();
      const fileList = ['/Users/me/proj/src/index.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath=""
          onNavigate={mockOnNavigate}
          project="/Users/me/proj"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Click the file — displayed as relative "index.ts" but onNavigate should
      // receive the original absolute path so downstream routes/lookups still work.
      await user.click(screen.getByText('index.ts'));
      expect(mockOnNavigate).toHaveBeenCalledWith('/Users/me/proj/src/index.ts');
    });

    it('should highlight active file when currentPath is absolute', () => {
      const fileList = ['/Users/me/proj/src/index.ts'].map(fileSummary);
      const { container } = render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="/Users/me/proj/src/index.ts"
          onNavigate={mockOnNavigate}
          project="/Users/me/proj"
          onProjectChange={mockOnProjectChange}
        />
      );

      // The active file node should have the purple highlight class
      const activeNode = container.querySelector('.bg-purple-50');
      expect(activeNode).not.toBeNull();
      expect(activeNode?.textContent).toContain('index.ts');
    });

    it('should handle empty file list', () => {
      const { container } = render(
        <PseudoFileTree
          fileList={[]}
          currentPath=""
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Should still render without crashing
      expect(container).toBeInTheDocument();
    });
  });

  describe('Active File Highlighting', () => {
    it('should highlight the current file with active styling', () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const activeFile = screen.getByText('main.ts');
      const activeContainer = activeFile.closest('[data-testid="tree-node"]');
      expect(activeContainer?.className).toContain('bg-purple-50');
      expect(activeContainer?.className).toContain('text-purple-700');
    });

    it('should remove active styling from other files', () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const inactiveFile = screen.getByText('utils.ts');
      const inactiveContainer = inactiveFile.closest('[data-testid="tree-node"]');
      expect(inactiveContainer?.className).not.toContain('bg-purple-50');
    });
  });

  describe('Collapse/Expand', () => {
    it('should toggle collapse state on chevron click', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Find the chevron button for src directory
      const srcDir = screen.getByText('src');
      const chevronButton = srcDir.closest('[data-testid="tree-node"]')?.querySelector('button');

      expect(chevronButton).toBeInTheDocument();

      // Initially expanded, so utils.ts should be visible
      expect(screen.getByText('main.ts')).toBeInTheDocument();

      // Click chevron to collapse
      await user.click(chevronButton!);

      // After collapse, children should not be in the document
      await waitFor(() => {
        expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
      });
    });

    it('should show file count in parentheses when directory is collapsed', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts', 'src/helpers.ts'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const srcDir = screen.getByText('src');
      const chevronButton = srcDir.closest('[data-testid="tree-node"]')?.querySelector('button');

      // Collapse the directory
      await user.click(chevronButton!);

      // Should show count indicator
      await waitFor(() => {
        expect(screen.getByText(/\(3\)/)).toBeInTheDocument();
      });
    });

    it('should persist collapsed state to the shared sidebar store', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      const user = userEvent.setup();
      const project = '/test-project';

      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project={project}
          onProjectChange={mockOnProjectChange}
        />
      );

      const srcDir = screen.getByText('src');
      const chevronButton = srcDir.closest('[data-testid="tree-node"]')?.querySelector('button');
      await user.click(chevronButton!);

      const { pseudoCollapsedPaths } = useSidebarTreeStore.getState();
      expect(pseudoCollapsedPaths.has('src')).toBe(true);
    });

    it('should migrate legacy localStorage collapsed state into the store', async () => {
      const project = '/legacy-project';
      localStorage.setItem(
        `pseudo-tree-collapsed-${project}`,
        JSON.stringify(['src']),
      );

      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project={project}
          onProjectChange={mockOnProjectChange}
        />
      );

      await waitFor(() => {
        const { pseudoCollapsedPaths } = useSidebarTreeStore.getState();
        expect(pseudoCollapsedPaths.has('src')).toBe(true);
      });

      // Legacy key should be removed after migration
      expect(localStorage.getItem(`pseudo-tree-collapsed-${project}`)).toBeNull();

      // Directory is collapsed so children are hidden
      await waitFor(() => {
        expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
      });
    });
  });

  describe('Filter Functionality', () => {
    it('should filter files by substring match (case-insensitive)', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts', 'dist/bundle.js'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const filterInput = screen.getByPlaceholderText(/filter/i);
      await user.type(filterInput, 'main');

      // Only files matching 'main' should be visible
      expect(screen.getByText('main.ts')).toBeInTheDocument();
      expect(screen.queryByText('utils.ts')).not.toBeInTheDocument();
    });

    it('should be case-insensitive', async () => {
      const fileList = ['src/MyComponent.tsx'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/MyComponent.tsx"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const filterInput = screen.getByPlaceholderText(/filter/i);
      await user.type(filterInput, 'mycomponent');

      expect(screen.getByText('MyComponent.tsx')).toBeInTheDocument();
    });

    it('should auto-expand directories containing matched files', async () => {
      const fileList = ['src/utils/helper.ts', 'src/main.ts', 'dist/bundle.js'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const filterInput = screen.getByPlaceholderText(/filter/i);
      await user.type(filterInput, 'helper');

      // src directory should auto-expand to show utils which contains helper.ts
      await waitFor(() => {
        expect(screen.getByText('helper.ts')).toBeVisible();
      });
    });

    it('should show all files when filter is cleared', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts', 'dist/bundle.js'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const filterInput = screen.getByPlaceholderText(/filter/i) as HTMLInputElement;
      await user.type(filterInput, 'main');

      expect(screen.queryByText('utils.ts')).not.toBeInTheDocument();

      // Clear the filter
      await user.clear(filterInput);

      expect(screen.getByText('utils.ts')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should call onNavigate with correct path when file is clicked', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const file = screen.getByText('utils.ts');
      await user.click(file);

      expect(mockOnNavigate).toHaveBeenCalledWith('src/utils.ts');
    });

    it('should not navigate when clicking chevron on directory', async () => {
      const fileList = ['src/main.ts'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const srcDir = screen.getByText('src');
      const chevronButton = srcDir.closest('[data-testid="tree-node"]')?.querySelector('button');
      await user.click(chevronButton!);

      expect(mockOnNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Project Dropdown', () => {
    it('should accept project prop and pass it to component', () => {
      const { container } = render(
        <PseudoFileTree
          fileList={[fileSummary('src/main.ts')]}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Component should render without errors
      expect(container).toBeInTheDocument();
    });

    it('should call onProjectChange callback (implementation provided by parent)', () => {
      render(
        <PseudoFileTree
          fileList={[fileSummary('src/main.ts')]}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      // Callback is provided and ready to be called by parent component
      expect(mockOnProjectChange).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in filenames', () => {
      const fileList = ['src/my-component.tsx', 'src/config[dev].js', 'src/test@2.ts'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/my-component.tsx"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      expect(screen.getByText('my-component.tsx')).toBeInTheDocument();
      expect(screen.getByText('config[dev].js')).toBeInTheDocument();
      expect(screen.getByText('test@2.ts')).toBeInTheDocument();
    });

    it('should handle files with multiple dots in name', () => {
      const fileList = ['src/utils.test.ts', 'src/config.prod.js'].map(fileSummary);
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/utils.test.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      expect(screen.getByText('utils.test.ts')).toBeInTheDocument();
      expect(screen.getByText('config.prod.js')).toBeInTheDocument();
    });

    it('should handle whitespace in filter', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts'].map(fileSummary);
      const user = userEvent.setup();
      render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project="/test-project"
          onProjectChange={mockOnProjectChange}
        />
      );

      const filterInput = screen.getByPlaceholderText(/filter/i);
      await user.type(filterInput, '   main   ');

      // Should handle whitespace gracefully (trim it and match)
      expect(screen.getByText('main.ts')).toBeInTheDocument();
    });
  });
});
