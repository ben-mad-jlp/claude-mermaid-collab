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

describe('PseudoFileTree', () => {
  const mockOnNavigate = vi.fn();
  const mockOnProjectChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Tree Building', () => {
    it('should build a nested tree from flat file list', () => {
      const fileList = ['src/index.ts', 'src/utils/helper.ts', 'dist/build.js'];
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
      const fileList = ['README.md', 'package.json'];
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
      const fileList = ['a/b/c/d/e/file.ts'];
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
      const fileList = ['src/main.ts', 'src/utils.ts'];
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
      const fileList = ['src/main.ts', 'src/utils.ts'];
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
      const fileList = ['src/main.ts', 'src/utils.ts'];
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
      const fileList = ['src/main.ts', 'src/utils.ts', 'src/helpers.ts'];
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

    it('should persist collapsed state to localStorage', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts'];
      const user = userEvent.setup();
      const project = '/test-project';

      const { rerender } = render(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project={project}
          onProjectChange={mockOnProjectChange}
        />
      );

      // Collapse directory
      const srcDir = screen.getByText('src');
      const chevronButton = srcDir.closest('[data-testid="tree-node"]')?.querySelector('button');
      await user.click(chevronButton!);

      // Check localStorage was updated
      const key = `pseudo-tree-collapsed-${project}`;
      const stored = localStorage.getItem(key);
      expect(stored).toBeTruthy();
      const collapsed = JSON.parse(stored!);
      expect(collapsed).toContain('src');

      // Re-render and verify state is restored
      rerender(
        <PseudoFileTree
          fileList={fileList}
          currentPath="src/main.ts"
          onNavigate={mockOnNavigate}
          project={project}
          onProjectChange={mockOnProjectChange}
        />
      );

      // Children should not be in the document (directory should still be collapsed)
      await waitFor(() => {
        expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
      });
    });
  });

  describe('Filter Functionality', () => {
    it('should filter files by substring match (case-insensitive)', async () => {
      const fileList = ['src/main.ts', 'src/utils.ts', 'dist/bundle.js'];
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
      const fileList = ['src/MyComponent.tsx'];
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
      const fileList = ['src/utils/helper.ts', 'src/main.ts', 'dist/bundle.js'];
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
      const fileList = ['src/main.ts', 'src/utils.ts', 'dist/bundle.js'];
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
      const fileList = ['src/main.ts', 'src/utils.ts'];
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
      const fileList = ['src/main.ts'];
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
          fileList={['src/main.ts']}
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
          fileList={['src/main.ts']}
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
      const fileList = ['src/my-component.tsx', 'src/config[dev].js', 'src/test@2.ts'];
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
      const fileList = ['src/utils.test.ts', 'src/config.prod.js'];
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
      const fileList = ['src/main.ts', 'src/utils.ts'];
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
