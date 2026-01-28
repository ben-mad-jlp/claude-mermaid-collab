/**
 * HistoryModal Component Tests
 *
 * Test coverage includes:
 * - Modal rendering and visibility
 * - Escape key to close
 * - Backdrop click to close
 * - Close button functionality
 * - DiffView integration
 * - Relative time formatting
 * - Document name display
 * - Body scroll prevention
 * - Accessibility (aria-modal, focus management)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HistoryModal } from '../HistoryModal';

// Mock DiffView component
vi.mock('@/components/ai-ui/display/DiffView', () => ({
  DiffView: ({ before, after, fileName }: { before: string; after: string; fileName?: string }) => (
    <div data-testid="diff-view">
      <div data-testid="diff-before">{before}</div>
      <div data-testid="diff-after">{after}</div>
      {fileName && <div data-testid="diff-filename">{fileName}</div>}
    </div>
  ),
}));

describe('HistoryModal', () => {
  const mockOnClose = vi.fn();
  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    historicalContent: '# Old Content\n\nThis is the old version.',
    currentContent: '# New Content\n\nThis is the current version.',
    timestamp: '2024-01-15T10:30:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Set current time for relative time calculations
    vi.setSystemTime(new Date('2024-01-15T10:35:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    // Ensure body scroll is restored
    document.body.style.overflow = '';
  });

  describe('Rendering', () => {
    it('should render nothing when isOpen is false', () => {
      const { container } = render(
        <HistoryModal {...defaultProps} isOpen={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render modal when isOpen is true', () => {
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render with modal backdrop', () => {
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByTestId('history-modal-backdrop')).toBeInTheDocument();
    });

    it('should render header with title', () => {
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/Version History/i)).toBeInTheDocument();
    });

    it('should render relative time in header', () => {
      render(<HistoryModal {...defaultProps} />);

      // 5 minutes ago from current time
      expect(screen.getByText(/5m ago/i)).toBeInTheDocument();
    });

    it('should render close button in header', () => {
      render(<HistoryModal {...defaultProps} />);

      // There are two close buttons (header and footer), find the header one by aria-label
      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should render DiffView with correct props', () => {
      render(<HistoryModal {...defaultProps} />);

      const diffView = screen.getByTestId('diff-view');
      expect(diffView).toBeInTheDocument();
      // Text content collapses whitespace, so just check key parts
      expect(screen.getByTestId('diff-before')).toHaveTextContent('# Old Content');
      expect(screen.getByTestId('diff-after')).toHaveTextContent('# New Content');
    });

    it('should render footer with Close button', () => {
      render(<HistoryModal {...defaultProps} />);

      const footer = screen.getByTestId('history-modal-footer');
      expect(within(footer).getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('should display document name when provided', () => {
      render(<HistoryModal {...defaultProps} documentName="design.md" />);

      // Document name appears in header and DiffView
      const designMdElements = screen.getAllByText(/design\.md/);
      expect(designMdElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Close Functionality', () => {
    it('should call onClose when close button in header is clicked', () => {
      render(<HistoryModal {...defaultProps} />);

      // Header close button has aria-label="Close" (not text content)
      const headerCloseButton = screen.getByLabelText('Close');
      fireEvent.click(headerCloseButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when backdrop is clicked', () => {
      render(<HistoryModal {...defaultProps} />);

      const backdrop = screen.getByTestId('history-modal-backdrop');
      fireEvent.click(backdrop);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key is pressed', () => {
      render(<HistoryModal {...defaultProps} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when footer Close button is clicked', () => {
      render(<HistoryModal {...defaultProps} />);

      const footer = screen.getByTestId('history-modal-footer');
      const closeButton = within(footer).getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when clicking inside modal content', () => {
      render(<HistoryModal {...defaultProps} />);

      const modalContent = screen.getByTestId('history-modal-content');
      fireEvent.click(modalContent);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Body Scroll Prevention', () => {
    it('should prevent body scroll when modal opens', () => {
      render(<HistoryModal {...defaultProps} />);

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore body scroll when modal closes', () => {
      const { rerender } = render(<HistoryModal {...defaultProps} />);

      expect(document.body.style.overflow).toBe('hidden');

      rerender(<HistoryModal {...defaultProps} isOpen={false} />);

      expect(document.body.style.overflow).toBe('');
    });

    it('should restore body scroll on unmount', () => {
      const { unmount } = render(<HistoryModal {...defaultProps} />);

      expect(document.body.style.overflow).toBe('hidden');

      unmount();

      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('Keyboard Handling', () => {
    it('should add keydown listener when modal opens', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      render(<HistoryModal {...defaultProps} />);

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      addEventListenerSpy.mockRestore();
    });

    it('should remove keydown listener on cleanup', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = render(<HistoryModal {...defaultProps} />);

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });

    it('should not add listener when modal is closed', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      render(<HistoryModal {...defaultProps} isOpen={false} />);

      expect(addEventListenerSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function));
      addEventListenerSpy.mockRestore();
    });
  });

  describe('Relative Time Formatting', () => {
    it('should show "just now" for timestamps less than 60 seconds ago', () => {
      vi.setSystemTime(new Date('2024-01-15T10:30:30Z')); // 30 seconds after
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/just now/i)).toBeInTheDocument();
    });

    it('should show minutes ago for timestamps less than 60 minutes ago', () => {
      vi.setSystemTime(new Date('2024-01-15T11:00:00Z')); // 30 minutes after
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/30m ago/i)).toBeInTheDocument();
    });

    it('should show hours ago for timestamps less than 24 hours ago', () => {
      vi.setSystemTime(new Date('2024-01-15T15:30:00Z')); // 5 hours after
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/5h ago/i)).toBeInTheDocument();
    });

    it('should show days ago for timestamps more than 24 hours ago', () => {
      vi.setSystemTime(new Date('2024-01-17T10:30:00Z')); // 2 days after
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/2d ago/i)).toBeInTheDocument();
    });

    it('should show "Yesterday" for timestamps exactly 1 day ago', () => {
      vi.setSystemTime(new Date('2024-01-16T10:30:00Z')); // 1 day after
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByText(/Yesterday/i)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have aria-modal attribute', () => {
      render(<HistoryModal {...defaultProps} />);

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('should have aria-labelledby pointing to title', () => {
      render(<HistoryModal {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');

      const labelId = dialog.getAttribute('aria-labelledby');
      expect(document.getElementById(labelId!)).toBeInTheDocument();
    });

    it('should have descriptive close button label', () => {
      render(<HistoryModal {...defaultProps} />);

      // Header close button has aria-label for accessibility
      const closeButton = screen.getByLabelText('Close');
      expect(closeButton).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should have fixed positioning with proper z-index', () => {
      render(<HistoryModal {...defaultProps} />);

      const backdrop = screen.getByTestId('history-modal-backdrop');
      expect(backdrop).toHaveClass('fixed', 'inset-0', 'z-50');
    });

    it('should have semi-transparent backdrop', () => {
      render(<HistoryModal {...defaultProps} />);

      const backdrop = screen.getByTestId('history-modal-backdrop');
      expect(backdrop).toHaveClass('bg-black/50');
    });

    it('should have proper modal container styles', () => {
      render(<HistoryModal {...defaultProps} />);

      const content = screen.getByTestId('history-modal-content');
      expect(content).toHaveClass('bg-white', 'dark:bg-gray-900', 'rounded-lg', 'shadow-xl');
    });

    it('should have max-width and max-height constraints', () => {
      render(<HistoryModal {...defaultProps} />);

      const content = screen.getByTestId('history-modal-content');
      expect(content).toHaveClass('max-w-4xl', 'max-h-[90vh]');
    });
  });

  describe('Integration', () => {
    it('should pass documentName to DiffView fileName', () => {
      render(<HistoryModal {...defaultProps} documentName="README.md" />);

      expect(screen.getByTestId('diff-filename')).toHaveTextContent('README.md');
    });

    it('should handle empty content strings', () => {
      render(
        <HistoryModal
          {...defaultProps}
          historicalContent=""
          currentContent="New content"
        />
      );

      expect(screen.getByTestId('diff-view')).toBeInTheDocument();
      expect(screen.getByTestId('diff-before')).toHaveTextContent('');
    });

    it('should handle identical content (no changes)', () => {
      const content = '# Same content';
      render(
        <HistoryModal
          {...defaultProps}
          historicalContent={content}
          currentContent={content}
        />
      );

      expect(screen.getByTestId('diff-view')).toBeInTheDocument();
    });
  });
});
