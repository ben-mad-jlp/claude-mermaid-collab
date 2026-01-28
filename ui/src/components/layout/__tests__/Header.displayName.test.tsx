/**
 * Header Component Tests - displayName Rendering
 *
 * Test coverage includes:
 * - displayName rendering in session dropdown
 * - Status label display in dropdown
 * - Proper fallback when displayName is not available
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';
import type { Session } from '@/types';

describe('Header - displayName Rendering', () => {
  const mockSessions: Session[] = [
    {
      project: '/test/project',
      name: 'session-1',
      displayName: 'Exploring',
    },
    {
      project: '/test/project',
      name: 'session-2',
      displayName: 'Designing',
    },
    {
      project: '/test/project',
      name: 'session-3',
      displayName: undefined,
    },
  ];

  beforeEach(() => {
    // Reset any global state
  });

  describe('displayName in Session Dropdown', () => {
    it('should render displayName in session dropdown', async () => {
      render(
        <Header
          sessions={mockSessions}
          registeredProjects={['/test/project']}
        />
      );

      // Click session selector to open dropdown
      const sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      // Wait for dropdown to appear and verify displayName is shown in status line
      expect(screen.getByText(/Status: Exploring/)).toBeDefined();
      expect(screen.getByText(/Status: Designing/)).toBeDefined();
    });

    it('should use Status label instead of Phase in dropdown', async () => {
      render(
        <Header
          sessions={mockSessions}
          registeredProjects={['/test/project']}
        />
      );

      // Click session selector to open dropdown
      const sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      // Should show "Status:" labels for sessions with displayName
      const statusLines = screen.getAllByText(/Status:/);
      expect(statusLines.length).toBeGreaterThan(0);

      // Should NOT show "Phase:" labels
      const phaseLabels = screen.queryAllByText(/Phase:/);
      expect(phaseLabels.length).toBe(0);
    });

    it('should not show status line when displayName is not available', async () => {
      const sessionsWithoutDisplay: Session[] = [
        {
          project: '/test/project',
          name: 'session-1',
          displayName: 'Exploring',
        },
        {
          project: '/test/project',
          name: 'session-2',
          displayName: undefined,
        },
      ];

      render(
        <Header
          sessions={sessionsWithoutDisplay}
          registeredProjects={['/test/project']}
        />
      );

      // Click session selector to open dropdown
      const sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      // Should show status for session-1
      expect(screen.getByText(/Status: Exploring/)).toBeDefined();

      // Should not show status labels (only one "Status:" for session-1)
      const statusLabels = screen.getAllByText(/Status:/);
      expect(statusLabels.length).toBe(1);
    });

    it('should display various user-friendly display names correctly', async () => {
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
      ];

      const sessionsWithNames = displayNames.map((name, idx) => ({
        project: '/test/project',
        name: `session-${idx}`,
        displayName: name,
      }));

      const { unmount } = render(
        <Header
          sessions={sessionsWithNames}
          registeredProjects={['/test/project']}
        />
      );

      // Click session selector to open dropdown
      const sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      // Verify all display names are rendered as "Status: [name]"
      displayNames.forEach((name) => {
        expect(screen.getByText(new RegExp(`Status: ${name}`))).toBeDefined();
      });

      unmount();
    });

    it('should update displayName when session changes', async () => {
      const initialSessions: Session[] = [
        {
          project: '/test/project',
          name: 'session-1',
          displayName: 'Exploring',
        },
        {
          project: '/test/project',
          name: 'session-2',
          displayName: 'Designing',
        },
      ];

      const { rerender } = render(
        <Header
          sessions={initialSessions}
          registeredProjects={['/test/project']}
        />
      );

      let sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      expect(screen.getByText(/Status: Exploring/)).toBeDefined();

      // Re-render with updated displayName
      const updatedSessions = [
        {
          project: '/test/project',
          name: 'session-1',
          displayName: 'Clarifying',
        },
        {
          project: '/test/project',
          name: 'session-2',
          displayName: 'Designing',
        },
      ];

      rerender(
        <Header
          sessions={updatedSessions}
          registeredProjects={['/test/project']}
        />
      );

      // The dropdown should still be open, check updated name
      expect(screen.getByText(/Status: Clarifying/)).toBeDefined();
    });
  });

  describe('Fallback behavior', () => {
    it('should not display status line for sessions without displayName', async () => {
      const sessionsWithoutDisplay: Session[] = [
        {
          project: '/test/project',
          name: 'session-1',
          phase: 'brainstorming',
          // No displayName
        },
      ];

      render(
        <Header
          sessions={sessionsWithoutDisplay}
          registeredProjects={['/test/project']}
        />
      );

      // Click session selector to open dropdown
      const sessionSelector = screen.getByTestId('session-selector');
      fireEvent.click(sessionSelector);

      // Should show session name
      expect(screen.getByText('session-1')).toBeDefined();

      // Should NOT show status line (even though phase exists)
      const statusLabels = screen.queryAllByText(/Status:/);
      expect(statusLabels.length).toBe(0);
    });
  });
});
