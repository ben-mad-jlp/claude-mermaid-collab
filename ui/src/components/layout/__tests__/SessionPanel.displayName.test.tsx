/**
 * SessionPanel Component Tests - displayName Rendering
 *
 * Test coverage includes:
 * - Rendering displayName when available
 * - Status label display instead of Phase label
 * - Fallback when displayName is not available
 * - Proper styling of displayName badge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionPanel } from '../SessionPanel';
import type { Session } from '@/types';

describe('SessionPanel - displayName Rendering', () => {
  const mockSession: Session = {
    project: '/test/project',
    name: 'test-session',
  };

  const mockDiagrams = [];
  const mockDocuments = [];

  beforeEach(() => {
    // Reset any global state
  });

  describe('displayName Rendering', () => {
    it('should render displayName when available', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      render(
        <SessionPanel
          session={sessionWithDisplay}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      expect(screen.getByText('Exploring')).toBeDefined();
    });

    it('should use Status label instead of Phase', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Designing',
      };

      render(
        <SessionPanel
          session={sessionWithDisplay}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      // Should have "Status:" label
      const statusLabels = screen.getAllByText('Status:');
      expect(statusLabels.length).toBeGreaterThan(0);

      // Should NOT have "Phase:" label
      const phaseLabels = screen.queryAllByText('Phase:');
      expect(phaseLabels.length).toBe(0);
    });

    it('should not render status section when displayName is not available', () => {
      const sessionWithoutDisplay: Session = {
        ...mockSession,
        displayName: undefined,
      };

      render(
        <SessionPanel
          session={sessionWithoutDisplay}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      // Should NOT have "Status:" label
      const statusLabels = screen.queryAllByText('Status:');
      expect(statusLabels.length).toBe(0);
    });

    it('should display user-friendly display names correctly', () => {
      const displayNames = [
        'Starting',
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
      ];

      displayNames.forEach((displayName) => {
        const { unmount } = render(
          <SessionPanel
            session={{ ...mockSession, displayName }}
            diagrams={mockDiagrams}
            documents={mockDocuments}
          />
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

      render(
        <SessionPanel
          session={sessionWithDisplay}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      const displayNameElement = screen.getByText('Exploring');
      expect(displayNameElement).toBeDefined();
      expect(displayNameElement.className).toContain('px-1.5');
      expect(displayNameElement.className).toContain('py-0.5');
      expect(displayNameElement.className).toContain('text-xs');
      expect(displayNameElement.className).toContain('font-medium');
    });
  });

  describe('fallback behavior', () => {
    it('should handle phase field if displayName is not present', () => {
      const sessionWithPhase: Session = {
        ...mockSession,
        phase: 'brainstorming',
        displayName: undefined,
      };

      render(
        <SessionPanel
          session={sessionWithPhase}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      // Should not render status if displayName is missing, even if phase exists
      const statusLabels = screen.queryAllByText('Status:');
      expect(statusLabels.length).toBe(0);
    });

    it('should render status when session is present', () => {
      const sessionWithDisplay: Session = {
        ...mockSession,
        displayName: 'Exploring',
      };

      const { rerender } = render(
        <SessionPanel
          session={sessionWithDisplay}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      expect(screen.getByText('Exploring')).toBeDefined();

      // Re-render with different displayName
      rerender(
        <SessionPanel
          session={{ ...sessionWithDisplay, displayName: 'Designing' }}
          diagrams={mockDiagrams}
          documents={mockDocuments}
        />
      );

      expect(screen.getByText('Designing')).toBeDefined();
      expect(screen.queryByText('Exploring')).toBeNull();
    });
  });
});
