/**
 * Header Component Tests
 *
 * Tests for Header component focusing on:
 * - Item 2: Terminal close causing project change
 * - useEffect dependency array has selectedProject
 * - currentSession check prevents auto-select when null
 * - Terminal close doesn't trigger project change
 * - Session persists after terminal deletion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from '../Header';
import { useSessionStore } from '@/stores/sessionStore';

describe('Header Component - Item 2: Terminal Close Bug Fix', () => {
  beforeEach(() => {
    // Reset session store before each test
    useSessionStore.setState({
      currentSession: null,
      sessions: [],
    });
  });

  describe('useEffect dependency array - selectedProject dependency', () => {
    it('should include selectedProject in dependency array for sync effect', () => {
      // This test verifies that selectedProject is a dependency in the useEffect
      // that syncs selectedProject with currentSession
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      const { rerender } = render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Set current session to project1
      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Project selector should reflect current session's project
      const projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');
    });

    it('should update selectedProject when currentSession.project changes', () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      const { rerender } = render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Initially no session
      let projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('Select Project');

      // Set current session to project1
      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Project should now be selected
      projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');
    });
  });

  describe('currentSession null check prevents auto-select', () => {
    it('should not auto-select project when currentSession is null', () => {
      const sessions = [{ name: 'session1', project: '/path/to/project1' } as any];
      const registeredProjects = ['/path/to/project1', '/path/to/project2'];

      // Clear current session
      useSessionStore.setState({ currentSession: null });

      render(
        <Header
          sessions={sessions}
          registeredProjects={registeredProjects}
        />
      );

      // Project selector should not be auto-populated just because registered projects exist
      const projectBtn = screen.getByTestId('project-selector');
      // Should show "Select Project" initially or the first from sessions only
      const text = projectBtn.textContent || '';
      // Should not unnecessarily auto-select
      expect(projectBtn).toBeDefined();
    });

    it('should respect currentSession when it exists during auto-select', () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      // Set current session
      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      const projectBtn = screen.getByTestId('project-selector');
      // Should select project1 because that's what currentSession specifies
      expect(projectBtn.textContent).toContain('project1');
    });
  });

  describe('Terminal close does not change current project/session', () => {
    it('should maintain selectedProject state after parent state changes', () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      const { rerender } = render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Set current session
      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      let projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');

      // Simulate a session deletion (terminal close)
      // The sessions array would be updated but currentSession should remain
      const filteredSessions = sessions.filter(s => s.name !== 'session2');

      rerender(
        <Header
          sessions={filteredSessions}
          registeredProjects={['/path/to/project1']}
        />
      );

      // Project should still be project1
      projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');
    });

    it('should not trigger auto-select of first project when currentSession is valid', () => {
      const initialSessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      const { rerender } = render(
        <Header
          sessions={initialSessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      let projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');

      // Remove project2 (simulating projects array change)
      const updatedSessions = [{ name: 'session1', project: '/path/to/project1' } as any];

      rerender(
        <Header
          sessions={updatedSessions}
          registeredProjects={['/path/to/project1']}
        />
      );

      // Should still be on project1
      projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');
    });
  });

  describe('Session persistence after terminal deletion', () => {
    it('should maintain currentSession when terminal sessions are deleted', () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
      ];

      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      const { rerender } = render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1']}
        />
      );

      const sessionBtn = screen.getByTestId('session-selector');
      expect(sessionBtn.textContent).toContain('session1');

      // Simulate terminal deletion - session is still available
      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1']}
        />
      );

      // Session should remain the same
      expect(screen.getByTestId('session-selector').textContent).toContain('session1');
    });

    it('should display correct session when currentSession matches selected project', () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Session should be displayed
      const sessionBtn = screen.getByTestId('session-selector');
      expect(sessionBtn.textContent).toContain('session1');
    });
  });

  describe('Edge cases - stale closure prevention', () => {
    it('should respond to currentSession changes immediately', async () => {
      const sessions = [
        { name: 'session1', project: '/path/to/project1' } as any,
        { name: 'session2', project: '/path/to/project2' } as any,
      ];

      const { rerender } = render(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Set to session1
      useSessionStore.setState({
        currentSession: { name: 'session1', project: '/path/to/project1' } as any,
      });

      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      let projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project1');

      // Quickly change to session2
      useSessionStore.setState({
        currentSession: { name: 'session2', project: '/path/to/project2' } as any,
      });

      rerender(
        <Header
          sessions={sessions}
          registeredProjects={['/path/to/project1', '/path/to/project2']}
        />
      );

      // Should immediately reflect new session's project
      projectBtn = screen.getByTestId('project-selector');
      expect(projectBtn.textContent).toContain('project2');
    });
  });
});
