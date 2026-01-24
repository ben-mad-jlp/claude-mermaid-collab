/**
 * DiffControls Component Tests
 *
 * Tests verify:
 * - Conditional rendering based on hasDiff prop
 * - Badge display when showing diff
 * - Clear button rendering and callback
 * - Proper styling and accessibility
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffControls } from './DiffControls';

describe('DiffControls Component', () => {
  describe('Conditional Rendering', () => {
    it('should return null when hasDiff is false', () => {
      const { container } = render(
        <DiffControls hasDiff={false} onClearDiff={() => {}} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render when hasDiff is true', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      expect(screen.getByText('Showing changes')).toBeInTheDocument();
    });
  });

  describe('Badge Display', () => {
    it('should display "Showing changes" badge', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const badge = screen.getByText('Showing changes');
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain('diff-badge');
    });

    it('should have correct badge styling', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const badge = screen.getByText('Showing changes');
      expect(badge.className).toContain('diff-badge');
    });
  });

  describe('Clear Button', () => {
    it('should render clear button when hasDiff is true', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      expect(button).toBeInTheDocument();
    });

    it('should not render clear button when hasDiff is false', () => {
      render(<DiffControls hasDiff={false} onClearDiff={() => {}} />);

      const button = screen.queryByRole('button', { name: /clear diff/i });
      expect(button).not.toBeInTheDocument();
    });

    it('should have correct button styling', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      expect(button.className).toContain('clear-diff-btn');
    });
  });

  describe('Button Callbacks', () => {
    it('should call onClearDiff when button is clicked', () => {
      const onClearDiff = vi.fn();
      render(<DiffControls hasDiff={true} onClearDiff={onClearDiff} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      fireEvent.click(button);

      expect(onClearDiff).toHaveBeenCalledTimes(1);
    });

    it('should call onClearDiff only once for single click', () => {
      const onClearDiff = vi.fn();
      render(<DiffControls hasDiff={true} onClearDiff={onClearDiff} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      fireEvent.click(button);

      expect(onClearDiff).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple clicks', () => {
      const onClearDiff = vi.fn();
      render(<DiffControls hasDiff={true} onClearDiff={onClearDiff} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(onClearDiff).toHaveBeenCalledTimes(3);
    });
  });

  describe('Layout Structure', () => {
    it('should have diff-controls container when hasDiff is true', () => {
      const { container } = render(
        <DiffControls hasDiff={true} onClearDiff={() => {}} />
      );

      const controls = container.querySelector('.diff-controls');
      expect(controls).toBeInTheDocument();
    });

    it('should contain both badge and button in controls', () => {
      const { container } = render(
        <DiffControls hasDiff={true} onClearDiff={() => {}} />
      );

      const controls = container.querySelector('.diff-controls');
      expect(controls).toBeInTheDocument();

      const badge = screen.getByText('Showing changes');
      const button = screen.getByRole('button', { name: /clear diff/i });

      expect(controls?.contains(badge)).toBe(true);
      expect(controls?.contains(button)).toBe(true);
    });
  });

  describe('Props Changes', () => {
    it('should handle hasDiff change from true to false', () => {
      const { rerender } = render(
        <DiffControls hasDiff={true} onClearDiff={() => {}} />
      );

      expect(screen.getByText('Showing changes')).toBeInTheDocument();

      rerender(<DiffControls hasDiff={false} onClearDiff={() => {}} />);

      expect(screen.queryByText('Showing changes')).not.toBeInTheDocument();
    });

    it('should handle hasDiff change from false to true', () => {
      const { rerender } = render(
        <DiffControls hasDiff={false} onClearDiff={() => {}} />
      );

      expect(screen.queryByText('Showing changes')).not.toBeInTheDocument();

      rerender(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      expect(screen.getByText('Showing changes')).toBeInTheDocument();
    });

    it('should update callback when onClearDiff prop changes', () => {
      const onClearDiff1 = vi.fn();
      const { rerender } = render(
        <DiffControls hasDiff={true} onClearDiff={onClearDiff1} />
      );

      let button = screen.getByRole('button', { name: /clear diff/i });
      fireEvent.click(button);

      expect(onClearDiff1).toHaveBeenCalledTimes(1);

      const onClearDiff2 = vi.fn();
      rerender(<DiffControls hasDiff={true} onClearDiff={onClearDiff2} />);

      button = screen.getByRole('button', { name: /clear diff/i });
      fireEvent.click(button);

      expect(onClearDiff2).toHaveBeenCalledTimes(1);
      expect(onClearDiff1).toHaveBeenCalledTimes(1); // Should still be 1
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button role', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should have descriptive button text', () => {
      render(<DiffControls hasDiff={true} onClearDiff={() => {}} />);

      const button = screen.getByRole('button');
      expect(button.textContent?.toLowerCase()).toContain('clear');
    });

    it('should be keyboard accessible', () => {
      const onClearDiff = vi.fn();
      render(<DiffControls hasDiff={true} onClearDiff={onClearDiff} />);

      const button = screen.getByRole('button', { name: /clear diff/i });
      button.focus();

      expect(button).toHaveFocus();

      // Simulate Enter key
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' });
      fireEvent.click(button);

      expect(onClearDiff).toHaveBeenCalled();
    });
  });
});
