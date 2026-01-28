/**
 * SessionCard Component Tests - displayName Rendering
 *
 * Test coverage includes:
 * - Rendering displayName in status badge
 * - Status label display instead of Phase label
 * - Fallback when displayName is not available
 * - Styling of displayName badge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from '../SessionCard';
import type { Session } from '@/types';

describe('SessionCard - displayName Rendering', () => {
  const mockSession: Session = {
    project: '/test/project',
    name: 'test-session',
  };

  beforeEach(() => {
    // Reset any global state
  });

  describe('displayName Rendering', () => {
    it('should render displayName in status badge', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      render(<SessionCard session={sessionWithDisplay} />);

      expect(screen.getByText('Exploring')).toBeDefined();
    });

    it('should use Status label instead of Phase', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Designing',
      };

      render(<SessionCard session={sessionWithDisplay} />);

      // Should have "Status:" label
      expect(screen.getByText('Status:')).toBeDefined();

      // Should NOT have "Phase:" label
      expect(screen.queryByText('Phase:')).toBeNull();
    });

    it('should not render status badge when displayName is not available', () => {
      const sessionWithoutDisplay: Session = {
        ...mockSession,
        displayName: undefined,
      };

      render(<SessionCard session={sessionWithoutDisplay} />);

      // Should NOT have "Status:" label
      expect(screen.queryByText('Status:')).toBeNull();
    });

    it('should display all user-friendly display names correctly', () => {
      const displayNames = [
        'Starting',
        'Gathering Goals',
        'Exploring',
        'Clarifying',
        'Designing',
        'Validating',
        'Investigating',
        'Planning Task',
        'Defining Interfaces',
        'Writing Pseudocode',
        'Building Skeleton',
        'Building Tasks',
        'Preparing Handoff',
        'Ready',
        'Executing',
        'Finishing',
        'Cleaning Up',
        'Done',
        'Context Check',
      ];

      displayNames.forEach((displayName) => {
        const { unmount } = render(
          <SessionCard session={{ ...mockSession, displayName }} />
        );

        expect(screen.getByText(displayName)).toBeDefined();
        unmount();
      });
    });

    it('should properly style displayName badge', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      render(<SessionCard session={sessionWithDisplay} />);

      const displayNameElement = screen.getByText('Exploring');
      expect(displayNameElement).toBeDefined();
      expect(displayNameElement.className).toContain('px-2');
      expect(displayNameElement.className).toContain('py-1');
      expect(displayNameElement.className).toContain('text-xs');
      expect(displayNameElement.className).toContain('font-medium');
      expect(displayNameElement.className).toContain('rounded');
    });

    it('should update displayName badge styling when selected', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      const { rerender } = render(
        <SessionCard session={sessionWithDisplay} isSelected={false} />
      );

      let displayNameElement = screen.getByText('Exploring');
      expect(
        displayNameElement.className.includes('bg-gray-100')
      ).toBeTruthy();

      // Render again with selected state
      rerender(
        <SessionCard session={sessionWithDisplay} isSelected={true} />
      );

      displayNameElement = screen.getByText('Exploring');
      expect(
        displayNameElement.className.includes('bg-accent-100')
      ).toBeTruthy();
    });
  });

  describe('Fallback behavior', () => {
    it('should not render status badge if displayName is missing', () => {
      const sessionWithoutDisplay: Session = {
        ...mockSession,
        phase: 'brainstorming',
        displayName: undefined,
      };

      render(<SessionCard session={sessionWithoutDisplay} />);

      // Should not render status badge even though phase exists
      expect(screen.queryByText('Status:')).toBeNull();
    });

    it('should handle rapid displayName updates', () => {
      const { rerender } = render(
        <SessionCard session={{ ...mockSession, displayName: 'Exploring' }} />
      );

      expect(screen.getByText('Exploring')).toBeDefined();

      rerender(
        <SessionCard
          session={{ ...mockSession, displayName: 'Designing' }}
        />
      );

      expect(screen.getByText('Designing')).toBeDefined();
      expect(screen.queryByText('Exploring')).toBeNull();

      rerender(
        <SessionCard
          session={{ ...mockSession, displayName: 'Validating' }}
        />
      );

      expect(screen.getByText('Validating')).toBeDefined();
      expect(screen.queryByText('Designing')).toBeNull();
    });
  });

  describe('Click handling with displayName', () => {
    it('should trigger onClick callback with displayName visible', () => {
      const onClick = vi.fn();
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      const { getByTestId } = render(
        <SessionCard session={sessionWithDisplay} onClick={onClick} />
      );

      const card = getByTestId(`session-card-${sessionWithDisplay.name}`);
      fireEvent.click(card);

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
