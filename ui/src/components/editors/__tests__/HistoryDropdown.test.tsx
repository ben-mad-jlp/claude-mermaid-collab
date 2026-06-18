/**
 * HistoryDropdown Component Tests
 *
 * Test coverage includes:
 * - Button disabled when no history
 * - Button enabled when history exists
 * - Dropdown opens/closes on button click
 * - Click outside closes dropdown
 * - Items show relative time formatting
 * - Click on item calls onVersionSelect with timestamp and content
 * - Loading state during version fetch
 * - History items displayed in reverse chronological order (newest first)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HistoryDropdown } from '../HistoryDropdown';

// Mock useDocumentHistory hook
const mockGetVersionAt = vi.fn();
const mockHistory = {
  original: '# Original content',
  changes: [
    {
      timestamp: '2024-01-15T10:00:00Z',
      diff: { oldString: 'old1', newString: 'new1' },
    },
    {
      timestamp: '2024-01-15T10:30:00Z',
      diff: { oldString: 'old2', newString: 'new2' },
    },
    {
      timestamp: '2024-01-15T11:00:00Z',
      diff: { oldString: 'old3', newString: 'new3' },
    },
  ],
};

vi.mock('@/hooks/useDocumentHistory', () => ({
  useDocumentHistory: vi.fn(() => ({
    history: mockHistory,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    getVersionAt: mockGetVersionAt,
  })),
}));

// Import after mock to get the mocked version
import { useDocumentHistory } from '@/hooks/useDocumentHistory';
const mockUseDocumentHistory = useDocumentHistory as ReturnType<typeof vi.fn>;

/**
 * Mirror of the component's `formatTimestamp` (HistoryDropdown.tsx). The
 * component renders absolute clock times (not relative "Xm ago"), so the test
 * derives the expected label the same way to stay timezone-independent.
 */
function expectedLabel(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  if (isToday) return timeStr;
  if (isYesterday) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays < 7) {
    const dayName = date.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// Labels for the three default mockHistory changes (computed at module load,
// matching the fake system time set in beforeEach).
const TS_NEWEST = '2024-01-15T11:00:00Z';
const TS_MIDDLE = '2024-01-15T10:30:00Z';

describe('HistoryDropdown', () => {
  const mockOnVersionSelect = vi.fn();
  const defaultProps = {
    documentId: 'test-doc-123',
    currentContent: '# Current content',
    onVersionSelect: mockOnVersionSelect,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Set current time for relative time calculations
    vi.setSystemTime(new Date('2024-01-15T11:05:00Z'));
    mockGetVersionAt.mockResolvedValue('# Historical content');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('should render History button', () => {
      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <HistoryDropdown {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should have relative positioning for dropdown container', () => {
      const { container } = render(<HistoryDropdown {...defaultProps} />);

      expect(container.firstChild).toHaveClass('relative');
    });
  });

  describe('Button State', () => {
    it('should disable button when history is null', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toBeDisabled();
    });

    it('should disable button when history changes array is empty', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: { original: 'content', changes: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toBeDisabled();
    });

    it('should disable button when isLoading is true', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toBeDisabled();
    });

    it('should enable button when history has changes', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).not.toBeDisabled();
    });

    it('should show "No history available" tooltip when disabled', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toHaveAttribute(
        'title',
        'No history available'
      );
    });

    it('should show "View history" tooltip when enabled', () => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.getByRole('button', { name: /history/i })).toHaveAttribute(
        'title',
        'View history'
      );
    });
  });

  describe('Dropdown Toggle', () => {
    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should not show dropdown initially', () => {
      render(<HistoryDropdown {...defaultProps} />);

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('should open dropdown on button click', () => {
      render(<HistoryDropdown {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      // Find dropdown items - use exact match
      expect(screen.getByText(expectedLabel(TS_NEWEST))).toBeInTheDocument();
    });

    it('should close dropdown on second button click', () => {
      render(<HistoryDropdown {...defaultProps} />);
      const button = screen.getByRole('button', { name: /history/i });

      fireEvent.click(button);
      expect(screen.getByText(expectedLabel(TS_NEWEST))).toBeInTheDocument();

      fireEvent.click(button);
      expect(screen.queryByText(expectedLabel(TS_NEWEST))).not.toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', async () => {
      render(
        <div>
          <HistoryDropdown {...defaultProps} />
          <button data-testid="outside">Outside</button>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(screen.getByText(expectedLabel(TS_NEWEST))).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByText(expectedLabel(TS_NEWEST))).not.toBeInTheDocument();
    });
  });

  describe('Timestamp Formatting', () => {
    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should show the clock time for a today timestamp', () => {
      vi.setSystemTime(new Date('2024-01-15T11:00:30Z')); // same day

      const historyWithRecent = {
        ...mockHistory,
        changes: [{ timestamp: '2024-01-15T11:00:00Z', diff: { oldString: '', newString: '' } }],
      };
      mockUseDocumentHistory.mockReturnValue({
        history: historyWithRecent,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const label = expectedLabel('2024-01-15T11:00:00Z');
      // Today timestamps render as a plain clock time (h:mm:ss AM/PM), not relative.
      expect(label).toMatch(/\d{1,2}:\d{2}:\d{2}\s?(AM|PM)/i);
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('should render each same-day change as its clock time', () => {
      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      expect(screen.getByText(expectedLabel(TS_NEWEST))).toBeInTheDocument();
      expect(screen.getByText(expectedLabel(TS_MIDDLE))).toBeInTheDocument();
    });

    it('should show "Yesterday" for timestamps 1 day ago', () => {
      const historyWithYesterday = {
        ...mockHistory,
        changes: [{ timestamp: '2024-01-14T11:00:00Z', diff: { oldString: '', newString: '' } }],
      };
      mockUseDocumentHistory.mockReturnValue({
        history: historyWithYesterday,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      expect(screen.getByText(/Yesterday/i)).toBeInTheDocument();
    });

    it('should show the weekday for timestamps < 7 days ago', () => {
      const historyWithDaysAgo = {
        ...mockHistory,
        changes: [{ timestamp: '2024-01-12T11:00:00Z', diff: { oldString: '', newString: '' } }],
      };
      mockUseDocumentHistory.mockReturnValue({
        history: historyWithDaysAgo,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      // 2024-01-12 was a Friday; component renders "<weekday> <time>".
      expect(screen.getByText(expectedLabel('2024-01-12T11:00:00Z'))).toBeInTheDocument();
    });

    it('should show date for timestamps >= 7 days ago', () => {
      const historyWithOld = {
        ...mockHistory,
        changes: [{ timestamp: '2024-01-01T11:00:00Z', diff: { oldString: '', newString: '' } }],
      };
      mockUseDocumentHistory.mockReturnValue({
        history: historyWithOld,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      // Older entries render as "<Mon> <day>, <time>" (e.g. "Jan 1, 11:00 AM").
      const label = expectedLabel('2024-01-01T11:00:00Z');
      expect(label).toMatch(/Jan 1,/);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  describe('History Items Order', () => {
    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should display history items in reverse chronological order (newest first)', () => {
      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const buttons = screen.getAllByRole('button').filter(
        (btn) => btn.textContent && !btn.textContent.match(/^History$/i)
      );

      // Newest (11:00) should be first, middle (10:30) second.
      expect(buttons[0]).toHaveTextContent(expectedLabel(TS_NEWEST));
      expect(buttons[1]).toHaveTextContent(expectedLabel(TS_MIDDLE));
    });
  });

  describe('Version Selection', () => {
    // Use a single-entry history for cleaner tests
    const singleEntryHistory = {
      original: '# Original content',
      changes: [
        {
          timestamp: '2024-01-15T11:00:00Z',
          diff: { oldString: 'old', newString: 'new' },
        },
      ],
    };

    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: singleEntryHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should call getVersionAt when clicking a history item', async () => {
      vi.useRealTimers();
      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const buttons = screen.getAllByRole('button');
      const historyItem = buttons.find((btn) => btn.textContent && !btn.textContent.match(/^History$/i));

      await act(async () => {
        fireEvent.click(historyItem!);
      });

      expect(mockGetVersionAt).toHaveBeenCalledWith('2024-01-15T11:00:00Z');
    });

    it('should call onVersionSelect with timestamp and content when version is fetched', async () => {
      // Use real timers for async tests
      vi.useRealTimers();
      mockGetVersionAt.mockResolvedValue('# Historical content at 11:00');

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      // Need to get the button by filtering since time formatting depends on system time
      const buttons = screen.getAllByRole('button');
      const historyItem = buttons.find((btn) => btn.textContent && !btn.textContent.match(/^History$/i));

      await act(async () => {
        fireEvent.click(historyItem!);
      });

      await waitFor(() => {
        expect(mockOnVersionSelect).toHaveBeenCalledWith(
          '2024-01-15T11:00:00Z',
          '# Historical content at 11:00'
        );
      });
    });

    it('should close dropdown after successful selection', async () => {
      // Use real timers for async tests
      vi.useRealTimers();
      mockGetVersionAt.mockResolvedValue('# Historical content');

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const buttons = screen.getAllByRole('button');
      const historyItem = buttons.find((btn) => btn.textContent && !btn.textContent.match(/^History$/i));

      await act(async () => {
        fireEvent.click(historyItem!);
      });

      await waitFor(() => {
        // After selection, the dropdown should close
        const remainingButtons = screen.getAllByRole('button');
        // Should only have History button
        expect(remainingButtons).toHaveLength(1);
        expect(remainingButtons[0]).toHaveTextContent('History');
      });
    });

    it('should not call onVersionSelect if getVersionAt returns null', async () => {
      // Use real timers for async tests
      vi.useRealTimers();
      mockGetVersionAt.mockResolvedValue(null);

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const buttons = screen.getAllByRole('button');
      const historyItem = buttons.find((btn) => btn.textContent && !btn.textContent.match(/^History$/i));

      await act(async () => {
        fireEvent.click(historyItem!);
      });

      await waitFor(() => {
        expect(mockGetVersionAt).toHaveBeenCalled();
      });

      expect(mockOnVersionSelect).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should show "Loading..." while fetching version content', async () => {
      // Create a promise that we can control
      let resolvePromise: (value: string | null) => void;
      const pendingPromise = new Promise<string | null>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetVersionAt.mockReturnValue(pendingPromise);

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const historyItem = screen.getByText(expectedLabel(TS_NEWEST));
      fireEvent.click(historyItem);

      // Should show loading state
      expect(screen.getByText('Loading...')).toBeInTheDocument();

      // Resolve the promise
      await act(async () => {
        resolvePromise!('# Content');
        await pendingPromise;
      });
    });

    it('should disable the loading item while fetching', async () => {
      let resolvePromise: (value: string | null) => void;
      const pendingPromise = new Promise<string | null>((resolve) => {
        resolvePromise = resolve;
      });
      mockGetVersionAt.mockReturnValue(pendingPromise);

      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const historyItem = screen.getByText(expectedLabel(TS_NEWEST));
      fireEvent.click(historyItem);

      const loadingButton = screen.getByText('Loading...');
      expect(loadingButton).toBeDisabled();

      // Cleanup
      await act(async () => {
        resolvePromise!('# Content');
        await pendingPromise;
      });
    });
  });

  describe('Styling', () => {
    beforeEach(() => {
      mockUseDocumentHistory.mockReturnValue({
        history: mockHistory,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        getVersionAt: mockGetVersionAt,
      });
    });

    it('should have proper button styling', () => {
      render(<HistoryDropdown {...defaultProps} />);

      const button = screen.getByRole('button', { name: /history/i });
      expect(button).toHaveClass('px-2', 'py-1', 'text-xs');
    });

    it('should have proper dropdown styling when open', () => {
      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      // Find the dropdown container (the parent div of history items)
      const dropdown = screen.getByText(expectedLabel(TS_NEWEST)).closest('div');
      expect(dropdown).toHaveClass('absolute', 'right-0', 'z-50');
    });

    it('should have max-height with overflow scroll', () => {
      render(<HistoryDropdown {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));

      const dropdown = screen.getByText(expectedLabel(TS_NEWEST)).closest('div');
      expect(dropdown).toHaveClass('max-h-64', 'overflow-auto');
    });
  });
});
