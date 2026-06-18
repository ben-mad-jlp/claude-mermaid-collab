/**
 * Header Component Tests - Session label rendering
 *
 * The project/session `<select>` dropdowns were replaced with plain static
 * labels (commit 683456e2 "header labels"). The Header no longer renders a
 * session dropdown that listed each session's `displayName` as a
 * "Status: <name>" line — the current session's *name* is shown in a static
 * `header-session-label` and that is the only session-identity surface.
 *
 * These tests assert that current contract:
 *  - the current session's name renders in the static label,
 *  - there is no session-selector dropdown,
 *  - displayName / "Status:" / "Phase:" lines are not rendered by the Header.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Header } from '../Header';
import { useSessionStore } from '@/stores/sessionStore';
import type { Session } from '@/types';

function renderHeader(props: Parameters<typeof Header>[0]) {
  return render(
    <MemoryRouter>
      <Header {...props} />
    </MemoryRouter>
  );
}

describe('Header - session label rendering', () => {
  const mockSessions: Session[] = [
    { project: '/test/project', name: 'session-1', displayName: 'Exploring' },
    { project: '/test/project', name: 'session-2', displayName: 'Designing' },
    { project: '/test/project', name: 'session-3', displayName: undefined },
  ];

  beforeEach(() => {
    useSessionStore.setState({ currentSession: null, sessions: [] });
  });

  describe('static session label', () => {
    it('shows the current session name in the static session label', () => {
      useSessionStore.setState({
        currentSession: mockSessions[0],
        sessions: mockSessions,
      });

      renderHeader({
        sessions: mockSessions,
        registeredProjects: ['/test/project'],
      });

      const label = screen.getByTestId('header-session-label');
      expect(label.textContent).toContain('session-1');
    });

    it('falls back to a placeholder when there is no current session', () => {
      useSessionStore.setState({ currentSession: null, sessions: mockSessions });

      renderHeader({
        sessions: mockSessions,
        registeredProjects: ['/test/project'],
      });

      const label = screen.getByTestId('header-session-label');
      expect(label.textContent).toContain('—');
    });

    it('updates the label when the current session changes', () => {
      useSessionStore.setState({
        currentSession: mockSessions[0],
        sessions: mockSessions,
      });

      const { rerender } = renderHeader({
        sessions: mockSessions,
        registeredProjects: ['/test/project'],
      });

      expect(screen.getByTestId('header-session-label').textContent).toContain(
        'session-1'
      );

      useSessionStore.setState({ currentSession: mockSessions[1] });
      rerender(
        <MemoryRouter>
          <Header sessions={mockSessions} registeredProjects={['/test/project']} />
        </MemoryRouter>
      );

      expect(screen.getByTestId('header-session-label').textContent).toContain(
        'session-2'
      );
    });
  });

  describe('removed session dropdown', () => {
    it('does not render a session-selector dropdown', () => {
      useSessionStore.setState({
        currentSession: mockSessions[0],
        sessions: mockSessions,
      });

      renderHeader({
        sessions: mockSessions,
        registeredProjects: ['/test/project'],
      });

      expect(screen.queryByTestId('session-selector')).toBeNull();
    });

    it('does not render displayName "Status:"/"Phase:" lines', () => {
      useSessionStore.setState({
        currentSession: mockSessions[0],
        sessions: mockSessions,
      });

      renderHeader({
        sessions: mockSessions,
        registeredProjects: ['/test/project'],
      });

      // The simplified Header surfaces only the session name, not any
      // per-session displayName/status lines.
      expect(screen.queryAllByText(/Status:/).length).toBe(0);
      expect(screen.queryAllByText(/Phase:/).length).toBe(0);
      expect(screen.queryByText('Exploring')).toBeNull();
      expect(screen.queryByText('Designing')).toBeNull();
    });
  });
});
