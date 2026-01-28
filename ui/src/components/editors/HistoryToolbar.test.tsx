/**
 * HistoryToolbar Component Tests
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryToolbar } from './HistoryToolbar';

// Mock useSession hook
const mockCurrentSession = {
  project: '/test/project',
  name: 'test-session',
};

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    currentSession: mockCurrentSession,
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HistoryToolbar', () => {
  const defaultProps = {
    documentId: 'test-doc',
    currentContent: 'Current content',
    onVersionSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the toolbar when session context exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
      });
    });

    it('renders prev/next buttons', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T10:00:00Z', content: 'v1' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-prev-btn')).toBeInTheDocument();
        expect(screen.getByTestId('history-next-btn')).toBeInTheDocument();
      });
    });

    it('renders dropdown button', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-btn')).toBeInTheDocument();
      });
    });

    it('shows "Current" label with timestamp when at current version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T10:00:00Z', content: 'v1' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        // Current label now includes timestamp
        expect(screen.getByText(/Current/)).toBeInTheDocument();
      });
    });
  });

  describe('navigation buttons', () => {
    it('disables prev button when at oldest version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-prev-btn')).toBeDisabled();
      });
    });

    it('disables next button when at current version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T10:00:00Z', content: 'v1' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-next-btn')).toBeDisabled();
      });
    });

    it('enables prev button when history exists (at least 2 entries)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T09:00:00Z', content: 'v1' },
              { timestamp: '2024-01-15T10:00:00Z', content: 'v2' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-prev-btn')).not.toBeDisabled();
      });
    });

    it('navigates to previous version when prev clicked (skips most recent)', async () => {
      const onVersionSelect = vi.fn();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              original: 'original content',
              changes: [
                { timestamp: '2024-01-15T09:00:00Z', content: 'v1' },
                { timestamp: '2024-01-15T10:00:00Z', content: 'v2' },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: 'version 1 content' }),
        });

      render(<HistoryToolbar {...defaultProps} onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-prev-btn')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('history-prev-btn'));

      // Clicking prev from Current should go to index 1 (skip index 0 which is most recent)
      // Index 1 = second newest = oldest in this case = 2024-01-15T09:00:00Z
      await waitFor(() => {
        expect(onVersionSelect).toHaveBeenCalledWith(
          '2024-01-15T09:00:00Z',
          'version 1 content',
          undefined // No previous version before this
        );
      });
    });
  });

  describe('dropdown', () => {
    it('opens dropdown on click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T09:00:00Z', content: 'v1' },
              { timestamp: '2024-01-15T10:00:00Z', content: 'v2' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-btn')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('history-dropdown-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-menu')).toBeInTheDocument();
      });
    });

    it('shows historical versions in dropdown (skipping most recent which is shown as Current)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T10:00:00Z', content: 'v1' },
              { timestamp: '2024-01-15T11:00:00Z', content: 'v2' },
            ],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-btn')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('history-dropdown-btn'));

      await waitFor(() => {
        const menu = screen.getByTestId('history-dropdown-menu');
        // Should have Current + 1 older version (most recent is shown as "Current")
        expect(menu.querySelectorAll('button').length).toBe(2);
      });
    });

    it('selects version from dropdown', async () => {
      const onVersionSelect = vi.fn();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              original: 'original content',
              changes: [
                { timestamp: '2024-01-15T09:00:00Z', content: 'v1' },
                { timestamp: '2024-01-15T10:00:00Z', content: 'v2' },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: 'historical content' }),
        });

      render(<HistoryToolbar {...defaultProps} onVersionSelect={onVersionSelect} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-btn')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('history-dropdown-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-menu')).toBeInTheDocument();
      });

      // Click on the historical version (second button after Current - index 1)
      // With 2 changes, dropdown shows: Current (most recent), then older version
      const buttons = screen.getByTestId('history-dropdown-menu').querySelectorAll('button');
      fireEvent.click(buttons[1]); // Older version

      await waitFor(() => {
        expect(onVersionSelect).toHaveBeenCalled();
      });
    });

    it('closes dropdown on outside click', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [
              { timestamp: '2024-01-15T09:00:00Z', content: 'v1' },
              { timestamp: '2024-01-15T10:00:00Z', content: 'v2' },
            ],
          }),
      });

      render(
        <div>
          <div data-testid="outside">Outside</div>
          <HistoryToolbar {...defaultProps} />
        </div>
      );

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-btn')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByTestId('history-dropdown-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('history-dropdown-menu')).toBeInTheDocument();
      });

      fireEvent.mouseDown(screen.getByTestId('outside'));

      await waitFor(() => {
        expect(screen.queryByTestId('history-dropdown-menu')).not.toBeInTheDocument();
      });
    });
  });

  describe('no history', () => {
    it('disables all buttons when no history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            original: 'original content',
            changes: [],
          }),
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-prev-btn')).toBeDisabled();
        expect(screen.getByTestId('history-next-btn')).toBeDisabled();
        expect(screen.getByTestId('history-dropdown-btn')).toBeDisabled();
      });
    });
  });

  describe('loading states', () => {
    it('shows loading state while fetching history', async () => {
      let resolvePromise: () => void;
      const fetchPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(
        fetchPromise.then(() => ({
          ok: true,
          json: () =>
            Promise.resolve({
              original: 'original content',
              changes: [],
            }),
        }))
      );

      render(<HistoryToolbar {...defaultProps} />);

      // Should show loading initially
      expect(screen.getByTestId('history-dropdown-btn')).toBeDisabled();

      // Resolve the fetch
      resolvePromise!();

      await waitFor(() => {
        expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('handles fetch error gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<HistoryToolbar {...defaultProps} />);

      // Should render toolbar even on error
      await waitFor(() => {
        expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
      });

      // Buttons should be disabled since no history loaded
      expect(screen.getByTestId('history-prev-btn')).toBeDisabled();
      expect(screen.getByTestId('history-dropdown-btn')).toBeDisabled();
    });

    it('handles 404 response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      render(<HistoryToolbar {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
      });

      expect(screen.getByTestId('history-dropdown-btn')).toBeDisabled();
    });
  });
});

describe('HistoryToolbar without session', () => {
  beforeEach(() => {
    // Reset the mock to return null session
    vi.resetModules();
  });

  it('renders but is disabled when no session context', async () => {
    // Re-mock with null session
    vi.doMock('@/hooks/useSession', () => ({
      useSession: () => ({
        currentSession: null,
      }),
    }));

    // Need to re-import component after mock change
    const { HistoryToolbar: HistoryToolbarNoSession } = await import('./HistoryToolbar');

    render(
      <HistoryToolbarNoSession
        documentId="test-doc"
        currentContent="content"
        onVersionSelect={vi.fn()}
      />
    );

    // Component should render but be disabled
    expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('history-prev-btn')).toBeDisabled();
    expect(screen.getByTestId('history-dropdown-btn')).toBeDisabled();
    expect(screen.getByTestId('history-next-btn')).toBeDisabled();
    expect(screen.getByTestId('history-dropdown-btn')).toHaveAttribute('title', 'No session');
  });
});
