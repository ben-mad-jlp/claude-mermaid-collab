/**
 * CallsLink Component Tests
 *
 * Comprehensive test suite for the CallsLink component covering:
 * - Link rendering with orange styling
 * - Hover behavior with delayed popover display
 * - Click navigation
 * - Popover positioning and visibility
 * - Timer management (hover delay and grace period)
 * - Mouse leave grace period
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CallsLink from './CallsLink';

describe('CallsLink', () => {
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render link text as "name (fileStem)"', () => {
      render(
        <CallsLink
          name="validateInput"
          fileStem="validators"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      expect(screen.getByText('validateInput (validators)')).toBeInTheDocument();
    });

    it('should apply orange text color and underline', () => {
      const { container } = render(
        <CallsLink
          name="helper"
          fileStem="utils"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = container.querySelector('[data-testid="calls-link"]');
      expect(link).toHaveClass('text-orange-600');
      expect(link).toHaveClass('underline');
    });

    it('should apply cursor-pointer and text-sm', () => {
      const { container } = render(
        <CallsLink
          name="process"
          fileStem="processor"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = container.querySelector('[data-testid="calls-link"]');
      expect(link).toHaveClass('cursor-pointer');
      expect(link).toHaveClass('text-sm');
    });
  });

  describe('Click Navigation', () => {
    it('should call onNavigate with fileStem on click', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="handler"
          fileStem="handlers"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('handler (handlers)');
      await user.click(link);

      expect(mockOnNavigate).toHaveBeenCalledWith('handlers');
      expect(mockOnNavigate).toHaveBeenCalledTimes(1);
    });

    it('should navigate immediately on click without waiting for timers', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="helper"
          fileStem="utils"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('helper (utils)');
      await user.click(link);

      expect(mockOnNavigate).toHaveBeenCalledWith('utils');
    });
  });

  describe('Hover Behavior', () => {
    it('should not show popover immediately on mouse enter', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="validate"
          fileStem="validators"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('validate (validators)');
      await user.hover(link);

      // Popover should not be visible yet
      expect(screen.queryByTestId('calls-popover')).not.toBeInTheDocument();
    });

    it('should show popover after 400ms hover delay', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="format"
          fileStem="utils"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('format (utils)');
      await user.hover(link);

      // Wait for 400ms hover delay
      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('should clear hover timer when mouse leaves before 400ms', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="process"
          fileStem="processor"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('process (processor)');
      await user.hover(link);

      // Leave quickly (before 400ms)
      await user.unhover(link);

      // Wait to ensure popover doesn't appear
      await new Promise(resolve => setTimeout(resolve, 500));

      // Popover should not appear
      expect(screen.queryByTestId('calls-popover')).not.toBeInTheDocument();
    });
  });

  describe('Grace Period', () => {
    it('should keep popover visible during grace period after mouse leave', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="helper"
          fileStem="helpers"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('helper (helpers)');

      // Hover and wait for popover to appear
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Leave the link
      await user.unhover(link);

      // Popover should still be visible (within grace period)
      expect(screen.getByTestId('calls-popover')).toBeInTheDocument();

      // Wait for grace period to pass
      await new Promise(resolve => setTimeout(resolve, 350));

      // Now popover should be hidden
      expect(screen.queryByTestId('calls-popover')).not.toBeInTheDocument();
    });

    it('should hide popover after 300ms grace period', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="validate"
          fileStem="validators"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('validate (validators)');

      // Hover and wait for popover
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Leave link
      await user.unhover(link);

      // Wait for grace period (300ms) + buffer
      await new Promise(resolve => setTimeout(resolve, 350));

      // Popover should be hidden
      expect(screen.queryByTestId('calls-popover')).not.toBeInTheDocument();
    });

    it('should reset grace timer if mouse re-enters during grace period', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="process"
          fileStem="processor"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('process (processor)');

      // Hover and wait for popover
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Leave link
      await user.unhover(link);

      // Wait 200ms (within grace period)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Re-enter link
      await user.hover(link);

      // Grace timer should be cleared, popover still visible
      expect(screen.getByTestId('calls-popover')).toBeInTheDocument();

      // Wait 200ms more
      await new Promise(resolve => setTimeout(resolve, 200));

      // Popover should still be visible (timer was reset)
      expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
    });
  });

  describe('Popover Content', () => {
    it('should render CallsPopover when visible', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="helper"
          fileStem="utils"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('helper (utils)');
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('should pass correct props to CallsPopover', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="validate"
          fileStem="validators"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('validate (validators)');
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Check that popover has expected attributes
      const popover = screen.getByTestId('calls-popover');
      expect(popover).toHaveAttribute('data-file-stem', 'validators');
    });
  });

  describe('Positioning', () => {
    it('should position popover based on anchor element', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="handler"
          fileStem="handlers"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('handler (handlers)');
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Verify popover has fixed positioning
      const popover = screen.getByTestId('calls-popover');
      const style = window.getComputedStyle(popover);
      expect(style.position).toBe('fixed');
    });
  });

  describe('State Management', () => {
    it('should maintain popover state across multiple hovers', async () => {
      const user = userEvent.setup();
      render(
        <CallsLink
          name="helper"
          fileStem="helpers"
          project="/test-project"
          onNavigate={mockOnNavigate}
        />
      );

      const link = screen.getByText('helper (helpers)');

      // First hover
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );

      // Leave and let grace period pass
      await user.unhover(link);
      await new Promise(resolve => setTimeout(resolve, 350));

      expect(screen.queryByTestId('calls-popover')).not.toBeInTheDocument();

      // Second hover
      await user.hover(link);

      await waitFor(
        () => {
          expect(screen.getByTestId('calls-popover')).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });
  });
});
