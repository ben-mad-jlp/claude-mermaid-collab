/**
 * Header Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Logo and title display
 * - Theme toggle functionality
 * - Project selector dropdown behavior
 * - Session selector dropdown behavior
 * - Session selection callbacks
 * - Keyboard navigation (Escape to close)
 * - Click outside to close dropdown
 * - Responsive design elements
 * - Accessibility features
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from '../Header';
import { useUIStore } from '@/stores/uiStore';
import { Session } from '@/types';

// Mock the useSession hook
vi.mock('@/hooks/useSession', () => ({
  useSession: vi.fn(() => ({
    currentSession: null,
    isLoading: false,
    error: null,
    diagrams: [],
    documents: [],
    selectedDiagramId: null,
    selectedDocumentId: null,
  })),
}));

// Import the mocked hook for manipulation
import { useSession } from '@/hooks/useSession';
const mockUseSession = vi.mocked(useSession);

describe('Header', () => {
  const mockSessions: Session[] = [
    { project: '/project1', name: 'session-1', phase: 'brainstorming' },
    { project: '/project1', name: 'session-1b', phase: 'design' },
    { project: '/project2', name: 'session-2', phase: 'implementation' },
    { project: '/project3', name: 'session-3' },
  ];

  let mockOnSessionSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    useUIStore.getState().reset();
    mockOnSessionSelect = vi.fn();
    mockUseSession.mockReturnValue({
      currentSession: null,
      isLoading: false,
      error: null,
      diagrams: [],
      documents: [],
      selectedDiagramId: null,
      selectedDocumentId: null,
      selectedDiagram: undefined,
      selectedDocument: undefined,
      collabState: null,
      setCurrentSession: vi.fn(),
      setLoading: vi.fn(),
      setError: vi.fn(),
      addDiagram: vi.fn(),
      updateDiagram: vi.fn(),
      removeDiagram: vi.fn(),
      selectDiagram: vi.fn(),
      addDocument: vi.fn(),
      updateDocument: vi.fn(),
      removeDocument: vi.fn(),
      selectDocument: vi.fn(),
      setCollabState: vi.fn(),
      clearSession: vi.fn(),
      reset: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the header', () => {
      render(<Header />);
      expect(screen.getByTestId('header')).toBeDefined();
    });

    it('should render the logo', () => {
      render(<Header />);
      expect(screen.getByTestId('header-logo')).toBeDefined();
    });

    it('should render the application title', () => {
      render(<Header />);
      expect(screen.getByText('Mermaid Collab')).toBeDefined();
    });

    it('should render the theme toggle button', () => {
      render(<Header />);
      expect(screen.getByTestId('theme-toggle')).toBeDefined();
    });

    it('should apply custom className', () => {
      render(<Header className="custom-header" />);
      const header = screen.getByTestId('header');
      expect(header.className).toContain('custom-header');
    });

    it('should render project selector', () => {
      render(<Header sessions={mockSessions} />);
      expect(screen.getByTestId('project-selector')).toBeDefined();
    });

    it('should render session selector', () => {
      render(<Header sessions={mockSessions} />);
      expect(screen.getByTestId('session-selector')).toBeDefined();
    });
  });

  describe('Theme Toggle', () => {
    it('should toggle theme from light to dark', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ theme: 'light' });

      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');

      await user.click(toggleButton);

      expect(useUIStore.getState().theme).toBe('dark');
    });

    it('should toggle theme from dark to light', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ theme: 'dark' });

      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');

      await user.click(toggleButton);

      expect(useUIStore.getState().theme).toBe('light');
    });

    it('should have accessible label for theme toggle', () => {
      useUIStore.setState({ theme: 'light' });
      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');
      expect(toggleButton.getAttribute('aria-label')).toContain('dark');
    });

    it('should update label when theme changes', () => {
      useUIStore.setState({ theme: 'dark' });
      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');
      expect(toggleButton.getAttribute('aria-label')).toContain('light');
    });
  });

  describe('Project Selector', () => {
    it('should show "Select Project" when no sessions provided', () => {
      render(<Header sessions={[]} />);
      expect(screen.getByText('Select Project')).toBeDefined();
    });

    it('should auto-select first project when sessions are provided', () => {
      render(<Header sessions={mockSessions} />);
      // Should auto-select the first project (project1)
      expect(screen.getByText('project1')).toBeDefined();
    });

    it('should open project dropdown on click', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      const selector = screen.getByTestId('project-selector');
      await user.click(selector);

      expect(screen.getByTestId('project-dropdown')).toBeDefined();
    });

    it('should display unique projects in dropdown', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      const selector = screen.getByTestId('project-selector');
      await user.click(selector);

      const dropdown = screen.getByTestId('project-dropdown');
      // Should show 3 project options
      const options = dropdown.querySelectorAll('button[role="option"]');
      expect(options.length).toBe(3);
    });

    it('should close project dropdown on Escape key', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      const selector = screen.getByTestId('project-selector');
      await user.click(selector);

      expect(screen.getByTestId('project-dropdown')).toBeDefined();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByTestId('project-dropdown')).toBeNull();
      });
    });

    it('should have aria-expanded attribute', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      const selector = screen.getByTestId('project-selector');
      expect(selector.getAttribute('aria-expanded')).toBe('false');

      await user.click(selector);
      expect(selector.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('Session Selector', () => {
    it('should show "Select Session" when no session is selected', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // First select a project - click within the dropdown
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const dropdown = screen.getByTestId('project-dropdown');
      await user.click(dropdown.querySelector('button[role="option"]')!);

      expect(screen.getByText('Select Session')).toBeDefined();
    });

    it('should show current session name when selected', () => {
      mockUseSession.mockReturnValue({
        ...mockUseSession(),
        currentSession: mockSessions[0],
      });

      render(<Header sessions={mockSessions} />);
      // Session selector should show just the session name
      expect(screen.getByText('session-1')).toBeDefined();
    });

    it('should open session dropdown on click', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // First select a project - click within the dropdown
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      expect(screen.getByTestId('session-dropdown')).toBeDefined();
    });

    it('should display sessions filtered by project', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // Select project1 which has 2 sessions
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      // Should show sessions for project1
      expect(screen.getByText('session-1')).toBeDefined();
      expect(screen.getByText('session-1b')).toBeDefined();
    });

    it('should display phase information in dropdown', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // Select project1
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      expect(screen.getByText('Phase: brainstorming')).toBeDefined();
      expect(screen.getByText('Phase: design')).toBeDefined();
    });

    it('should call onSessionSelect when a session is clicked', async () => {
      const user = userEvent.setup();
      render(
        <Header sessions={mockSessions} onSessionSelect={mockOnSessionSelect} />
      );

      // Select project1
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      const sessionOption = screen.getByText('session-1b');
      await user.click(sessionOption);

      expect(mockOnSessionSelect).toHaveBeenCalledWith(mockSessions[1]);
    });

    it('should close session dropdown after selection', async () => {
      const user = userEvent.setup();
      render(
        <Header sessions={mockSessions} onSessionSelect={mockOnSessionSelect} />
      );

      // Select project1
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      const sessionOption = screen.getByText('session-1b');
      await user.click(sessionOption);

      expect(screen.queryByTestId('session-dropdown')).toBeNull();
    });

    it('should close dropdown on Escape key', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // Select project1
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      await user.click(sessionSelector);

      expect(screen.getByTestId('session-dropdown')).toBeDefined();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByTestId('session-dropdown')).toBeNull();
      });
    });

    it('should have aria-expanded attribute', async () => {
      const user = userEvent.setup();
      render(<Header sessions={mockSessions} />);

      // Select project1 first
      const projectSelector = screen.getByTestId('project-selector');
      await user.click(projectSelector);
      const projectDropdown = screen.getByTestId('project-dropdown');
      await user.click(projectDropdown.querySelector('button[role="option"]')!);

      const sessionSelector = screen.getByTestId('session-selector');
      expect(sessionSelector.getAttribute('aria-expanded')).toBe('false');

      await user.click(sessionSelector);
      expect(sessionSelector.getAttribute('aria-expanded')).toBe('true');
    });

    it('should have aria-haspopup attribute', () => {
      render(<Header sessions={mockSessions} />);
      const selector = screen.getByTestId('session-selector');
      expect(selector.getAttribute('aria-haspopup')).toBe('listbox');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible header element', () => {
      render(<Header />);
      const header = screen.getByTestId('header');
      expect(header.tagName).toBe('HEADER');
    });

    it('should have accessible theme toggle button', () => {
      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');
      expect(toggleButton.getAttribute('aria-label')).toBeDefined();
    });

    it('should have accessible logo image', () => {
      render(<Header />);
      const logo = screen.getByTestId('header-logo');
      const img = logo.querySelector('img');
      expect(img?.getAttribute('alt')).toBe('Mermaid Collab Logo');
    });
  });

  describe('Styling', () => {
    it('should have border styling', () => {
      render(<Header />);
      const header = screen.getByTestId('header');
      expect(header.className).toContain('border-b');
    });

    it('should have shadow styling', () => {
      render(<Header />);
      const header = screen.getByTestId('header');
      expect(header.className).toContain('shadow-sm');
    });

    it('should support dark mode classes', () => {
      render(<Header />);
      const header = screen.getByTestId('header');
      expect(header.className).toContain('dark:bg-gray-800');
    });
  });

  describe('Edit Mode Toggle', () => {
    it('should render the edit mode toggle button', () => {
      render(<Header />);
      expect(screen.getByTestId('edit-mode-toggle')).toBeDefined();
    });

    it('should always show "Edit" text regardless of editMode state', () => {
      useUIStore.setState({ editMode: false });
      const { rerender } = render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');
      expect(toggleButton.textContent).toContain('Edit');

      useUIStore.setState({ editMode: true });
      rerender(<Header />);
      expect(toggleButton.textContent).toContain('Edit');
    });

    it('should toggle editMode state when clicked', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ editMode: false });

      render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');

      expect(useUIStore.getState().editMode).toBe(false);

      await user.click(toggleButton);

      expect(useUIStore.getState().editMode).toBe(true);
    });

    it('should call toggleEditMode from the store', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ editMode: true });

      render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');

      await user.click(toggleButton);

      // Verify the state was toggled
      expect(useUIStore.getState().editMode).toBe(false);
    });

    it('should have appropriate aria-label based on editMode', () => {
      useUIStore.setState({ editMode: false });
      render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');
      expect(toggleButton.getAttribute('aria-label')).toBe('Show Edit Panel');
    });

    it('should update aria-label when editMode changes', () => {
      const { rerender } = render(<Header />);
      useUIStore.setState({ editMode: false });
      rerender(<Header />);

      const toggleButton = screen.getByTestId('edit-mode-toggle');
      expect(toggleButton.getAttribute('aria-label')).toBe('Show Edit Panel');

      useUIStore.setState({ editMode: true });
      rerender(<Header />);

      expect(toggleButton.getAttribute('aria-label')).toBe('Hide Edit Panel');
    });

    it('should have aria-pressed attribute reflecting editMode state', () => {
      useUIStore.setState({ editMode: true });
      render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');
      expect(toggleButton.getAttribute('aria-pressed')).toBe('true');
    });

    it('should change styling based on editMode', () => {
      useUIStore.setState({ editMode: true });
      const { rerender } = render(<Header />);
      const toggleButton = screen.getByTestId('edit-mode-toggle');

      // When in edit mode, should have blue color classes (matching Chat/Terminal buttons)
      expect(toggleButton.className).toContain('bg-blue');

      useUIStore.setState({ editMode: false });
      rerender(<Header />);

      // When in view mode, should have gray color classes
      expect(toggleButton.className).toContain('bg-gray');
    });

    it('should preserve other header functionality when toggling edit mode', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ editMode: false, theme: 'light' });

      render(<Header />);

      const editToggleButton = screen.getByTestId('edit-mode-toggle');
      const themeToggleButton = screen.getByTestId('theme-toggle');

      await user.click(editToggleButton);

      // Verify edit mode was toggled
      expect(useUIStore.getState().editMode).toBe(true);

      // Verify theme is still light
      expect(useUIStore.getState().theme).toBe('light');

      // Verify theme toggle still works
      await user.click(themeToggleButton);
      expect(useUIStore.getState().theme).toBe('dark');
    });
  });

  describe('Component Lifecycle', () => {
    it('should clean up event listeners on unmount', async () => {
      const user = userEvent.setup();
      const { unmount } = render(<Header sessions={mockSessions} />);

      const selector = screen.getByTestId('project-selector');
      await user.click(selector);

      expect(() => {
        unmount();
      }).not.toThrow();
    });

    it('should handle rapid theme toggles', async () => {
      const user = userEvent.setup();
      useUIStore.setState({ theme: 'light' });

      render(<Header />);
      const toggleButton = screen.getByTestId('theme-toggle');

      await user.click(toggleButton);
      await user.click(toggleButton);
      await user.click(toggleButton);

      expect(useUIStore.getState().theme).toBe('dark');
    });
  });
});
