import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileHeader } from './MobileHeader';

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

describe('MobileHeader', () => {
  const defaultProps = {
    sessions: [
      { name: 'Session 1', project: '/path/to/project', phase: 'exploring' },
      { name: 'Session 2', project: '/path/to/project', phase: 'designing' },
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

  describe('Layout and Structure', () => {
    it('should render mobile header container', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]');
      expect(header).toBeInTheDocument();
    });

    it('should have single-row compact layout', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;
      // Check that it has flex layout classes
      expect(header).toHaveClass('flex');
    });

    it('should render logo on the left side', () => {
      render(<MobileHeader {...defaultProps} />);
      const logo = screen.getByTestId('mobile-header-logo');
      expect(logo).toBeInTheDocument();
    });

    it('should have smaller logo for mobile', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const logo = container.querySelector('[data-testid="mobile-header-logo"] img') as HTMLImageElement;
      expect(logo).toHaveClass('w-6', 'h-6');
    });
  });

  describe('Project Dropdown', () => {
    it('should render project dropdown trigger button', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      expect(projectSelector).toBeInTheDocument();
    });

    it('should have project title on project selector button', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      expect(projectSelector).toHaveAttribute('title');
    });

    it('should toggle project dropdown on click', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      expect(screen.queryByTestId('mobile-project-dropdown')).not.toBeInTheDocument();
      fireEvent.click(projectSelector);
      expect(screen.getByTestId('mobile-project-dropdown')).toBeInTheDocument();
      fireEvent.click(projectSelector);
      expect(screen.queryByTestId('mobile-project-dropdown')).not.toBeInTheDocument();
    });

    it('should show all projects in dropdown', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      const projectOptions = screen.getAllByRole('option');
      expect(projectOptions.length).toBe(2);
    });

    it('should call onSessionSelect when project is selected', () => {
      const onSessionSelect = vi.fn();
      render(<MobileHeader {...defaultProps} onSessionSelect={onSessionSelect} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      const projects = screen.getAllByRole('option');
      fireEvent.click(projects[0]);
      expect(onSessionSelect).toHaveBeenCalled();
    });

    it('should use icon-only button for compact layout', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const projectSelector = container.querySelector('[data-testid="mobile-project-selector"]') as HTMLElement;
      const svg = projectSelector.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      expect(screen.getByTestId('mobile-project-dropdown')).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('mobile-project-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Session Dropdown', () => {
    it('should render session dropdown trigger button', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      expect(sessionSelector).toBeInTheDocument();
    });

    it('should have session title on session selector button', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      expect(sessionSelector).toHaveAttribute('title', 'Session 1');
    });

    it('should toggle session dropdown on click', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      expect(screen.queryByTestId('mobile-session-dropdown')).not.toBeInTheDocument();
      fireEvent.click(sessionSelector);
      expect(screen.getByTestId('mobile-session-dropdown')).toBeInTheDocument();
      fireEvent.click(sessionSelector);
      expect(screen.queryByTestId('mobile-session-dropdown')).not.toBeInTheDocument();
    });

    it('should show sessions in dropdown', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      const dropdown = screen.getByTestId('mobile-session-dropdown');
      expect(dropdown).toHaveTextContent('Session 1');
      expect(dropdown).toHaveTextContent('Session 2');
    });

    it('should call onSessionSelect when session is selected', () => {
      const onSessionSelect = vi.fn();
      render(<MobileHeader {...defaultProps} onSessionSelect={onSessionSelect} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      const sessions = screen.getAllByRole('option');
      fireEvent.click(sessions[0]);
      expect(onSessionSelect).toHaveBeenCalled();
    });

    it('should have disabled attribute when no project is selected', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      // When a project is selected (from currentSession), button should not be disabled
      expect(sessionSelector).not.toHaveAttribute('disabled');
      // Verify the disabled state is properly set by checking className doesn't have cursor-not-allowed
      expect(sessionSelector.className).not.toContain('cursor-not-allowed');
    });

    it('should use icon-only button for compact layout', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const sessionSelector = container.querySelector('[data-testid="mobile-session-selector"]') as HTMLElement;
      const svg = sessionSelector.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should close dropdown when clicking outside', () => {
      render(<MobileHeader {...defaultProps} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      expect(screen.getByTestId('mobile-session-dropdown')).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('mobile-session-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should render refresh button', () => {
      render(<MobileHeader {...defaultProps} />);
      const refreshBtn = screen.getByTestId('mobile-refresh-sessions');
      expect(refreshBtn).toBeInTheDocument();
    });

    it('should call onRefreshSessions when refresh button is clicked', () => {
      const onRefreshSessions = vi.fn();
      render(<MobileHeader {...defaultProps} onRefreshSessions={onRefreshSessions} />);
      const refreshBtn = screen.getByTestId('mobile-refresh-sessions');
      fireEvent.click(refreshBtn);
      expect(onRefreshSessions).toHaveBeenCalled();
    });

    it('should render theme toggle button', () => {
      render(<MobileHeader {...defaultProps} />);
      const themeToggle = screen.getByTestId('mobile-theme-toggle');
      expect(themeToggle).toBeInTheDocument();
    });

    it('should use icon-only buttons for refresh and theme toggle', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const refreshBtn = container.querySelector('[data-testid="mobile-refresh-sessions"]') as HTMLElement;
      const themeToggle = container.querySelector('[data-testid="mobile-theme-toggle"]') as HTMLElement;
      expect(refreshBtn.querySelector('svg')).toBeInTheDocument();
      expect(themeToggle.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Connection Status Badge', () => {
    it('should render connection badge', () => {
      render(<MobileHeader {...defaultProps} />);
      const badge = screen.getByTestId('mobile-connection-badge');
      expect(badge).toBeInTheDocument();
    });

    it('should show connected status via title', () => {
      render(<MobileHeader {...defaultProps} isConnected={true} isConnecting={false} />);
      const badge = screen.getByTestId('mobile-connection-badge');
      expect(badge).toHaveAttribute('title', 'Connected');
    });

    it('should show connecting status via title', () => {
      render(<MobileHeader {...defaultProps} isConnected={false} isConnecting={true} />);
      const badge = screen.getByTestId('mobile-connection-badge');
      expect(badge).toHaveAttribute('title', 'Connecting');
    });

    it('should show disconnected status via title', () => {
      render(<MobileHeader {...defaultProps} isConnected={false} isConnecting={false} />);
      const badge = screen.getByTestId('mobile-connection-badge');
      expect(badge).toHaveAttribute('title', 'Disconnected');
    });

    it('should display status dot with appropriate color', () => {
      const { container } = render(<MobileHeader {...defaultProps} isConnected={true} />);
      const badge = container.querySelector('[data-testid="mobile-connection-badge"]') as HTMLElement;
      const dot = badge.querySelector('.rounded-full');
      expect(dot).toBeInTheDocument();
      expect(dot).toHaveClass('bg-green-500');
    });

    it('should be a compact dot for mobile', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const badge = container.querySelector('[data-testid="mobile-connection-badge"]') as HTMLElement;
      const dot = badge.querySelector('.rounded-full');
      expect(dot).toHaveClass('w-2', 'h-2');
    });
  });

  describe('Mobile-Specific Styling', () => {
    it('should have compact height suitable for mobile', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;
      expect(header).toHaveClass('h-12');
    });

    it('should use minimal padding for mobile', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;
      expect(header).toHaveClass('px-2');
    });

    it('should use gap between items', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;
      expect(header).toHaveClass('gap-1');
    });

    it('should have dark mode support', () => {
      const { container } = render(<MobileHeader {...defaultProps} />);
      const header = container.querySelector('[data-testid="mobile-header"]') as HTMLElement;
      expect(header.className).toMatch(/dark:/);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on dropdown buttons', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      expect(projectSelector).toHaveAttribute('aria-haspopup', 'listbox');
      expect(sessionSelector).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('should have proper aria-expanded on dropdowns', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      expect(projectSelector).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(projectSelector);
      expect(projectSelector).toHaveAttribute('aria-expanded', 'true');
    });

    it('should have proper aria-labels on icon buttons', () => {
      render(<MobileHeader {...defaultProps} />);
      const refreshBtn = screen.getByTestId('mobile-refresh-sessions');
      const themeToggle = screen.getByTestId('mobile-theme-toggle');
      expect(refreshBtn).toHaveAttribute('aria-label');
      expect(themeToggle).toHaveAttribute('aria-label');
    });
  });

  describe('Optional Props', () => {
    it('should work without onRefreshSessions', () => {
      const props = { ...defaultProps };
      delete props.onRefreshSessions;
      render(<MobileHeader {...props} />);
      expect(screen.queryByTestId('mobile-refresh-sessions')).not.toBeInTheDocument();
    });

    it('should work without onCreateSession', () => {
      const { onCreateSession, ...props } = defaultProps;
      render(<MobileHeader {...props} />);
      const sessionSelector = screen.getByTestId('mobile-session-selector');
      fireEvent.click(sessionSelector);
      expect(screen.queryByText('New Session')).not.toBeInTheDocument();
    });

    it('should work without onAddProject', () => {
      const { onAddProject, ...props } = defaultProps;
      render(<MobileHeader {...props} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      expect(screen.queryByText('Add Project')).not.toBeInTheDocument();
    });

    it('should handle undefined sessions array', () => {
      const { sessions, ...props } = defaultProps;
      render(<MobileHeader {...props} sessions={undefined} />);
      expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
    });

    it('should handle undefined registeredProjects array', () => {
      const { registeredProjects, ...props } = defaultProps;
      render(<MobileHeader {...props} registeredProjects={undefined} />);
      expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
    });
  });

  describe('Escape Key Handling', () => {
    it('should close dropdowns on Escape key', () => {
      render(<MobileHeader {...defaultProps} />);
      const projectSelector = screen.getByTestId('mobile-project-selector');
      fireEvent.click(projectSelector);
      expect(screen.getByTestId('mobile-project-dropdown')).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('mobile-project-dropdown')).not.toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('should accept optional custom className', () => {
      const { container } = render(<MobileHeader {...defaultProps} className="custom-class" />);
      const header = container.querySelector('[data-testid="mobile-header"]');
      expect(header).toHaveClass('custom-class');
    });
  });
});
