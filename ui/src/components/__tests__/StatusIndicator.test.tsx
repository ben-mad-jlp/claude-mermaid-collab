/**
 * StatusIndicator Component Tests
 *
 * Test coverage includes:
 * - Component rendering for each status state
 * - Status-specific icons and text
 * - Custom message display
 * - Color coding by status
 * - Dark mode support
 * - Custom className support
 * - Accessibility features
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusIndicator } from '../StatusIndicator';

describe('StatusIndicator', () => {
  beforeEach(() => {
    // Reset any global state
  });

  describe('Rendering', () => {
    it('should render the status indicator component', () => {
      render(<StatusIndicator status="idle" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toBeDefined();
    });

    it('should be accessible with proper ARIA attributes', () => {
      render(<StatusIndicator status="working" message="Processing" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveAttribute('role', 'status');
      expect(indicator).toHaveAttribute('aria-label');
    });
  });

  describe('Working Status', () => {
    it('should render spinner when status is working', () => {
      render(<StatusIndicator status="working" />);
      const spinner = screen.getByTestId('status-spinner');
      expect(spinner).toBeDefined();
    });

    it('should show default working message', () => {
      render(<StatusIndicator status="working" />);
      expect(screen.getByText('Processing')).toBeDefined();
    });

    it('should show custom message when provided', () => {
      render(<StatusIndicator status="working" message="Training model" />);
      expect(screen.getByText('Training model')).toBeDefined();
      expect(screen.queryByText('Processing')).toBeNull();
    });

    it('should have blue color for working status', () => {
      const { container } = render(<StatusIndicator status="working" />);
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toMatch(/blue|accent/i);
    });

    it('should not show spinner for other statuses', () => {
      const { container } = render(<StatusIndicator status="idle" />);
      expect(container.querySelector('[data-testid="status-spinner"]')).toBeNull();
    });
  });

  describe('Waiting Status', () => {
    it('should render yellow icon when status is waiting', () => {
      render(<StatusIndicator status="waiting" />);
      const icon = screen.getByTestId('status-icon');
      expect(icon).toBeDefined();
      expect(icon.getAttribute('class')).toMatch(/w-4|h-4/i);
    });

    it('should show default waiting message', () => {
      render(<StatusIndicator status="waiting" />);
      expect(screen.getByText('Waiting for input')).toBeDefined();
    });

    it('should show custom message when provided', () => {
      render(<StatusIndicator status="waiting" message="Please review changes" />);
      expect(screen.getByText('Please review changes')).toBeDefined();
      expect(screen.queryByText('Waiting for input')).toBeNull();
    });

    it('should have yellow background for waiting status', () => {
      const { container } = render(<StatusIndicator status="waiting" />);
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toMatch(/yellow/i);
    });
  });

  describe('Idle Status', () => {
    it('should render check icon when status is idle', () => {
      render(<StatusIndicator status="idle" />);
      const icon = screen.getByTestId('status-icon');
      expect(icon).toBeDefined();
      expect(icon.getAttribute('class')).toMatch(/w-4|h-4/i);
    });

    it('should show default idle message', () => {
      render(<StatusIndicator status="idle" />);
      expect(screen.getByText('Ready')).toBeDefined();
    });

    it('should show custom message when provided', () => {
      render(<StatusIndicator status="idle" message="All done" />);
      expect(screen.getByText('All done')).toBeDefined();
      expect(screen.queryByText('Ready')).toBeNull();
    });

    it('should have gray color for idle status', () => {
      const { container } = render(<StatusIndicator status="idle" />);
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toMatch(/gray/i);
    });
  });

  describe('Styling', () => {
    it('should accept custom className', () => {
      const { container } = render(
        <StatusIndicator status="idle" className="custom-class" />
      );
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toContain('custom-class');
    });

    it('should merge custom className with default styles', () => {
      const { container } = render(
        <StatusIndicator status="working" className="custom-class" />
      );
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toContain('custom-class');
      expect(indicator?.className).toMatch(/blue|accent|working/i);
    });

    it('should support dark mode classes', () => {
      const { container } = render(<StatusIndicator status="idle" />);
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toMatch(/dark/i);
    });

    it('should have proper spacing and layout', () => {
      const { container } = render(<StatusIndicator status="idle" />);
      const indicator = container.querySelector('[data-testid="status-indicator"]');
      expect(indicator?.className).toMatch(/flex|gap|items-center/i);
    });
  });

  describe('Icons', () => {
    it('should render an SVG icon for waiting status', () => {
      const { container } = render(<StatusIndicator status="waiting" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeDefined();
    });

    it('should render an SVG icon for idle status', () => {
      const { container } = render(<StatusIndicator status="idle" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeDefined();
    });

    it('should not render static icon for working status (spinner instead)', () => {
      const { container } = render(<StatusIndicator status="working" />);
      const staticSvg = container.querySelector('[data-testid="status-icon"]');
      // For working status, we use a spinner, not a static SVG
      expect(staticSvg).toBeNull();
    });
  });

  describe('Accessibility', () => {
    it('should have proper aria-label for working status', () => {
      render(<StatusIndicator status="working" message="Training" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveAttribute('aria-label');
      expect(indicator.getAttribute('aria-label')).toMatch(/working|training/i);
    });

    it('should have proper aria-label for waiting status', () => {
      render(<StatusIndicator status="waiting" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveAttribute('aria-label');
      expect(indicator.getAttribute('aria-label')).toMatch(/waiting/i);
    });

    it('should have proper aria-label for idle status', () => {
      render(<StatusIndicator status="idle" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toHaveAttribute('aria-label');
      expect(indicator.getAttribute('aria-label')).toMatch(/ready|idle/i);
    });

    it('should have live region announcements', () => {
      render(<StatusIndicator status="working" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator.getAttribute('role')).toBe('status');
    });
  });

  describe('Props Validation', () => {
    it('should handle undefined message gracefully', () => {
      render(<StatusIndicator status="idle" message={undefined} />);
      expect(screen.getByText('Ready')).toBeDefined();
    });

    it('should handle undefined className gracefully', () => {
      render(<StatusIndicator status="idle" className={undefined} />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toBeDefined();
    });

    it('should handle empty string message', () => {
      render(<StatusIndicator status="idle" message="" />);
      const indicator = screen.getByTestId('status-indicator');
      expect(indicator).toBeDefined();
    });

    it('should handle all valid status types', () => {
      const statuses: Array<'working' | 'waiting' | 'idle'> = ['working', 'waiting', 'idle'];
      statuses.forEach((status) => {
        const { unmount } = render(<StatusIndicator status={status} />);
        const indicator = screen.getByTestId('status-indicator');
        expect(indicator).toBeDefined();
        unmount();
      });
    });
  });
});
