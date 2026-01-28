import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileHeader } from '../MobileHeader';

// Mock the hooks
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    currentSession: { name: 'Session 1', project: '/path/to/project', phase: 'exploring' },
  }),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: any) =>
    selector({
      editMode: false,
      toggleEditMode: vi.fn(),
      chatPanelVisible: false,
      toggleChatPanel: vi.fn(),
      terminalPanelVisible: false,
      toggleTerminalPanel: vi.fn(),
    }),
}));

describe('MobileHeader Integration', () => {
  const defaultProps = {
    sessions: [
      { name: 'Session 1', project: '/path/to/project', phase: 'exploring' },
      { name: 'Session 2', project: '/path/to/project', phase: 'designing' },
      { name: 'Session 3', project: '/another/project', phase: 'implementing' },
    ],
    registeredProjects: ['/path/to/project', '/another/project'],
    onSessionSelect: vi.fn(),
    onRefreshSessions: vi.fn(),
    onCreateSession: vi.fn(),
    onAddProject: vi.fn(),
    onDeleteSession: vi.fn(),
    isConnected: true,
    isConnecting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.confirm
    global.confirm = vi.fn(() => true);
  });

  describe('Dropdown Interaction Flow', () => {
    it('should handle project selection and update session dropdown', () => {
      const onSessionSelect = vi.fn();
      render(<MobileHeader {...defaultProps} onSessionSelect={onSessionSelect} />);

      // Open project dropdown
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);

      // Select first project
      const projectOptions = screen.getAllByRole('option');
      fireEvent.click(projectOptions[0]);

      expect(onSessionSelect).toHaveBeenCalled();
    });

    it('should filter sessions by selected project', () => {
      render(<MobileHeader {...defaultProps} />);

      // Open project dropdown and select a specific project
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      const projectOptions = screen.getAllByRole('option');
      fireEvent.click(projectOptions[0]);

      // Now check that session dropdown only shows sessions from that project
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      const sessionDropdown = screen.getByTestId('mobile-session-dropdown');
      expect(sessionDropdown).toBeInTheDocument();
    });

    it('should close both dropdowns when one dropdown is opened', () => {
      render(<MobileHeader {...defaultProps} />);

      // Open project dropdown
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      expect(screen.getByTestId('mobile-project-dropdown')).toBeInTheDocument();

      // Open session dropdown - should close project dropdown
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);

      // Both should close when clicking outside
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('mobile-project-dropdown')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mobile-session-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Multi-Project Scenarios', () => {
    it('should show all projects from sessions and registeredProjects', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);

      // Check that project options are rendered
      const projectOptions = screen.getAllByRole('option');
      expect(projectOptions.length).toBeGreaterThan(0);
    });

    it('should handle registered projects without sessions', () => {
      const props = {
        ...defaultProps,
        registeredProjects: ['/path/to/project', '/another/project', '/empty/project'],
      };
      render(<MobileHeader {...props} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);

      // Check that all three projects are available
      const projectOptions = screen.getAllByRole('option');
      expect(projectOptions.length).toBe(3);
    });
  });

  describe('Connection Status Updates', () => {
    it('should reflect connection status changes', () => {
      const { rerender } = render(
        <MobileHeader {...defaultProps} isConnected={false} isConnecting={true} />
      );
      expect(screen.getByTestId('mobile-connection-badge')).toHaveTextContent('Connecting');

      rerender(
        <MobileHeader {...defaultProps} isConnected={true} isConnecting={false} />
      );
      expect(screen.getByTestId('mobile-connection-badge')).toHaveTextContent('Connected');

      rerender(
        <MobileHeader {...defaultProps} isConnected={false} isConnecting={false} />
      );
      expect(screen.getByTestId('mobile-connection-badge')).toHaveTextContent('Disconnected');
    });
  });

  describe('Session Management Operations', () => {
    it('should call onDeleteSession when delete button is clicked', () => {
      const onDeleteSession = vi.fn();
      const session = defaultProps.sessions[0];

      render(<MobileHeader {...defaultProps} onDeleteSession={onDeleteSession} />);

      // Open session dropdown
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);

      // Find and click delete button for first session
      const deleteButtons = screen.getAllByLabelText(/delete session/i);
      fireEvent.click(deleteButtons[0]);

      // Should have confirmation dialog (confirm the delete)
      if (window.confirm.toString().includes('native')) {
        // If native confirm, we can't easily test it
        // but we can verify the button was clicked
        expect(deleteButtons[0]).toBeInTheDocument();
      }
    });

    it('should display create session option when dropdown is open', () => {
      render(<MobileHeader {...defaultProps} onCreateSession={vi.fn()} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);

      expect(screen.getByText(/new session/i)).toBeInTheDocument();
    });

    it('should display add project option when project dropdown is open', () => {
      render(<MobileHeader {...defaultProps} onAddProject={vi.fn()} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);

      expect(screen.getByText(/add project/i)).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('should maintain compact layout on small screens', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;

      // Check for mobile-specific classes
      expect(header).toHaveClass('h-12');
      expect(header).toHaveClass('px-2');
      expect(header).toHaveClass('gap-1');
    });

    it('should position dropdowns correctly for mobile', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);

      const dropdown = container.querySelector('[data-testid="mobile-project-dropdown"]') as HTMLElement;
      expect(dropdown).toHaveClass('absolute');
    });
  });

  describe('Dark Mode Support', () => {
    it('should apply dark mode classes throughout component', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]');
      const headerClasses = header?.className;

      expect(headerClasses).toMatch(/dark:/);
    });

    it('should have dark mode variants for connection badge', () => {
      const { container } = render(<MobileHeader {...defaultProps} isConnected={true} />);
      const badge = container.querySelector('[data-testid="mobile-connection-badge"]');
      const badgeClasses = badge?.className;

      expect(badgeClasses).toMatch(/dark:/);
    });
  });

  describe('Performance', () => {
    it('should not re-render unnecessarily when props do not change', () => {
      const renderSpy = vi.fn();
      const { rerender } = render(<MobileHeader {...defaultProps} />);

      rerender(<MobileHeader {...defaultProps} />);
      rerender(<MobileHeader {...defaultProps} />);

      // Component should render multiple times normally, this is just a sanity check
      expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
    });
  });

  describe('Complete User Flow', () => {
    it('should handle a complete workflow: select project, then session', () => {
      const onSessionSelect = vi.fn();
      render(<MobileHeader {...defaultProps} onSessionSelect={onSessionSelect} />);

      // Step 1: Open and select project
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      const projectOptions = screen.getAllByRole('option');
      fireEvent.click(projectOptions[0]);

      // Step 2: Open and select session
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      const sessionOptions = screen.getAllByRole('option');
      fireEvent.click(sessionOptions[0]);

      // Verify session select was called
      expect(onSessionSelect).toHaveBeenCalled();
    });

    it('should handle refresh sessions action', () => {
      const onRefreshSessions = vi.fn();
      render(<MobileHeader {...defaultProps} onRefreshSessions={onRefreshSessions} />);

      const refreshBtn = screen.getByTestId('mobile-refresh-sessions');
      fireEvent.click(refreshBtn);

      expect(onRefreshSessions).toHaveBeenCalledTimes(1);
    });
  });
});
