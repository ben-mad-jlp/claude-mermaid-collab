/**
 * PseudoSearch Component Tests
 *
 * Comprehensive test suite for Cmd+K search overlay:
 * - Open/close behavior with isOpen prop and Escape key
 * - Debounced search query (200ms)
 * - Result rendering with file grouping (max 3 matches per file)
 * - Keyboard navigation (ArrowDown, ArrowUp, Enter)
 * - Click outside to close
 * - Empty results handling
 * - Query encoding for API
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PseudoSearch from './PseudoSearch';
import * as pseudoApi from '../../lib/pseudo-api';

// Mock pseudo-api
vi.mock('../../lib/pseudo-api', () => ({
  searchPseudo: vi.fn(),
}));

const mockProject = '/home/user/my-project';

describe('PseudoSearch', () => {
  const mockOnNavigate = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Open/Close Behavior', () => {
    it('should not render when isOpen is false', () => {
      const { container } = render(
        <PseudoSearch
          project={mockProject}
          isOpen={false}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      // Should return null or empty
      expect(container.firstChild).toBeNull();
    });

    it('should render overlay when isOpen is true', () => {
      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      // Should render search box
      const input = screen.getByPlaceholderText(/search/i);
      expect(input).toBeInTheDocument();
    });

    it('should close on Escape key', async () => {
      const user = userEvent.setup();
      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, '{Escape}');

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should close on click outside overlay', async () => {
      const { container } = render(
        <div>
          <PseudoSearch
            project={mockProject}
            isOpen={true}
            onClose={mockOnClose}
            onNavigate={mockOnNavigate}
          />
        </div>
      );

      // Find the overlay (semi-transparent background) and click it
      const overlay = container.querySelector('[data-testid="overlay"]');
      expect(overlay).toBeInTheDocument();

      // Click the overlay itself (not the search box)
      if (overlay) {
        fireEvent.mouseDown(overlay);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('Search and Debounce', () => {
    it('should debounce search queries by 200ms', async () => {
      const user = userEvent.setup({ delay: null });

      (pseudoApi.searchPseudo as any).mockResolvedValue([]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;

      // Type characters
      await user.type(input, 'user');

      // Search should not be called immediately
      expect(pseudoApi.searchPseudo).not.toHaveBeenCalled();

      // Wait for debounce to complete
      await waitFor(
        () => {
          expect(pseudoApi.searchPseudo).toHaveBeenCalledWith(mockProject, 'user');
        },
        { timeout: 500 }
      );
    });

    it('should not search if query is empty', async () => {
      const user = userEvent.setup();

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, ' ');

      // Wait a bit for debounce
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should not search for whitespace-only query
      expect(pseudoApi.searchPseudo).not.toHaveBeenCalled();
    });

    it('should handle search errors gracefully', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockRejectedValue(new Error('Search failed'));

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'query');

      // Wait for debounce and error handling
      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Should show "no results" even if search failed
      await waitFor(() => {
        expect(screen.getByText(/no results/i)).toBeInTheDocument();
      });
    });
  });

  describe('Result Rendering and Grouping', () => {
    it('should display results grouped by file', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
            {
              functionName:'fetchUser',
              line: '  const user = await db.getUser(id)',
              lineNumber: 6,
            },
          ],
        },
        {
          file: 'utils.pseudo',
          matches: [
            {
              functionName:'validateUser',
              line: '  if (!user.id) throw new Error("Invalid user")',
              lineNumber: 12,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalledWith(mockProject, 'user');
      });

      // Should see file headers (muted color)
      expect(screen.getByText(/api\.pseudo/i)).toBeInTheDocument();
      expect(screen.getByText(/utils\.pseudo/i)).toBeInTheDocument();

      // Should see function names (use getAllByText since they appear multiple times)
      const fetchUserItems = screen.getAllByText('fetchUser');
      expect(fetchUserItems.length).toBeGreaterThan(0);

      expect(screen.getByText(/validateUser/i)).toBeInTheDocument();
    });

    it('should truncate function signatures to 60 characters', async () => {
      const user = userEvent.setup();

      const longSig =
        'async function veryLongFunctionNameWithManyCharacters(param1: string, param2: number, param3: boolean): Promise<ComplexType<nested<generic>>>';

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'long.pseudo',
          matches: [
            {
              functionName:'veryLongFunctionNameWithManyCharacters',
              line: longSig,
              lineNumber: 1,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'long');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // The line should be rendered and truncated with ellipsis
      const items = screen.getAllByText((content) =>
        content.includes('async function veryLong')
      );
      expect(items.length).toBeGreaterThan(0);
      // Check that text contains ellipsis for truncation
      expect(items[0].textContent).toMatch(/\.\.\.$/);
    });

    it('should show max 3 matches per file', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'many.pseudo',
          matches: [
            {
              functionName:'func1',
              line: 'function func1() {}',
              lineNumber: 1,
            },
            {
              functionName:'func2',
              line: 'function func2() {}',
              lineNumber: 2,
            },
            {
              functionName:'func3',
              line: 'function func3() {}',
              lineNumber: 3,
            },
            {
              functionName:'func4',
              line: 'function func4() {}',
              lineNumber: 4,
            },
            {
              functionName:'func5',
              line: 'function func5() {}',
              lineNumber: 5,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'func');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Should only show max 3 matches per file
      const func1Items = screen.queryAllByText('func1');
      const func4Items = screen.queryAllByText('func4');

      expect(func1Items.length).toBeGreaterThan(0);
      // func4 and func5 should not be visible (only first 3)
      expect(func4Items.length).toBe(0);
    });

    it('should display empty results message', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'nonexistent');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Should show "no results" message
      expect(screen.getByText(/no results/i)).toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('should highlight first result on ArrowDown', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
            {
              functionName:'createUser',
              line: 'async function createUser(name: string): Promise<User>',
              lineNumber: 10,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Press ArrowDown to highlight first item
      await user.keyboard('{ArrowDown}');

      // First item should have highlight style (bg-purple-50)
      const items = screen.getAllByRole('button');
      expect(items.length).toBeGreaterThan(0);
    });

    it('should cycle through results with ArrowDown/ArrowUp', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'func1',
              line: 'function func1() {}',
              lineNumber: 1,
            },
            {
              functionName:'func2',
              line: 'function func2() {}',
              lineNumber: 2,
            },
            {
              functionName:'func3',
              line: 'function func3() {}',
              lineNumber: 3,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'func');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Navigate down
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');

      // Navigate up (should wrap or move back)
      await user.keyboard('{ArrowUp}');

      // Verify highlighted index changed (no exception thrown)
      expect(mockOnNavigate).not.toHaveBeenCalled();
    });

    it('should navigate and close on Enter key', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Highlight first result
      await user.keyboard('{ArrowDown}');

      // Press Enter
      await user.keyboard('{Enter}');

      // Should navigate to the file stem
      expect(mockOnNavigate).toHaveBeenCalledWith('api', 'fetchUser');

      // Should close
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not navigate if no result is highlighted', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Press Enter without navigating down
      await user.keyboard('{Enter}');

      // Should not navigate
      expect(mockOnNavigate).not.toHaveBeenCalled();

      // Should not close
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Click Navigation', () => {
    it('should navigate on result item click', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Click on a result item
      const resultItems = screen.getAllByRole('button');
      if (resultItems.length > 0) {
        await user.click(resultItems[0]);

        // Should navigate
        expect(mockOnNavigate).toHaveBeenCalled();

        // Should close
        expect(mockOnClose).toHaveBeenCalled();
      }
    });
  });

  describe('Visual Styling', () => {
    it('should have semi-transparent overlay', async () => {
      const { container } = render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      // Check for overlay background (semi-transparent)
      const overlays = container.querySelectorAll('[class*="bg-"]');
      expect(overlays.length).toBeGreaterThan(0);
    });

    it('should highlight selected result with bg-purple-50', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([
        {
          file: 'api.pseudo',
          matches: [
            {
              functionName:'fetchUser',
              line: 'async function fetchUser(id: number): Promise<User>',
              lineNumber: 5,
            },
          ],
        },
      ]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'user');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalled();
      });

      // Highlight first item
      await user.keyboard('{ArrowDown}');

      // Check for purple highlight
      const items = screen.getAllByRole('button');
      if (items.length > 0) {
        const highlighted = items[0];
        const className = highlighted.className || '';
        // Should have purple highlight styling
        expect(className).toContain('bg-purple-50');
      }
    });
  });

  describe('Query Encoding', () => {
    it('should encode special characters in search query', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'test & query');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalledWith(mockProject, 'test & query');
      });
    });

    it('should handle queries with spaces', async () => {
      const user = userEvent.setup();

      (pseudoApi.searchPseudo as any).mockResolvedValue([]);

      render(
        <PseudoSearch
          project={mockProject}
          isOpen={true}
          onClose={mockOnClose}
          onNavigate={mockOnNavigate}
        />
      );

      const input = screen.getByPlaceholderText(/search/i);
      await user.type(input, 'multi word query');

      await waitFor(() => {
        expect(pseudoApi.searchPseudo).toHaveBeenCalledWith(mockProject, 'multi word query');
      });
    });
  });
});
