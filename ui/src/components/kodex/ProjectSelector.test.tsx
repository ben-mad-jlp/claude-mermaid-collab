/**
 * ProjectSelector Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Dropdown toggle behavior
 * - Project selection
 * - Add project callback
 * - Remove project flow
 * - Error handling and display
 * - Loading states
 * - Empty state
 * - Keyboard navigation
 * - Accessibility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSelector } from './ProjectSelector';
import { useKodexStore } from '@/stores/kodexStore';

// Mock the useKodexStore hook
vi.mock('@/stores/kodexStore', () => ({
  useKodexStore: vi.fn(),
}));

const mockUseKodexStore = vi.mocked(useKodexStore);

describe('ProjectSelector', () => {
  const mockProjects = [
    { path: '/home/user/projects/project1', name: 'project1', lastAccess: '2026-01-25T00:00:00Z' },
    { path: '/home/user/projects/project2', name: 'project2', lastAccess: '2026-01-24T00:00:00Z' },
    { path: '/home/user/projects/my-special-project', name: 'my-special-project', lastAccess: '2026-01-23T00:00:00Z' },
  ];

  let mockRemoveProject: ReturnType<typeof vi.fn>;
  let mockSetSelectedProject: ReturnType<typeof vi.fn>;
  let mockOnAddProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRemoveProject = vi.fn().mockResolvedValue(true);
    mockSetSelectedProject = vi.fn();
    mockOnAddProject = vi.fn();

    mockUseKodexStore.mockReturnValue({
      selectedProject: null,
      projects: mockProjects,
      isLoadingProjects: false,
      projectsError: null,
      setSelectedProject: mockSetSelectedProject,
      setProjects: vi.fn(),
      setLoadingProjects: vi.fn(),
      setProjectsError: vi.fn(),
      fetchProjects: vi.fn(),
      addProject: vi.fn(),
      removeProject: mockRemoveProject,
      reset: vi.fn(),
    });
  });

  describe('Rendering', () => {
    it('should render the component', () => {
      render(<ProjectSelector />);
      expect(screen.getByTestId('project-selector-button')).toBeDefined();
    });

    it('should render dropdown button with "Select Project" when no project selected', () => {
      render(<ProjectSelector />);
      expect(screen.getByText('Select Project')).toBeDefined();
    });

    it('should render dropdown button with selected project name', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        selectedProject: '/home/user/projects/project1',
      });

      render(<ProjectSelector />);
      expect(screen.getByText('project1')).toBeDefined();
    });

    it('should show loading spinner when isLoadingProjects is true', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      expect(screen.getByTestId('project-selector-loading')).toBeDefined();
    });

    it('should apply custom className to wrapper', () => {
      render(<ProjectSelector className="custom-class" />);
      // Find the inner div with the relative position that has the className
      const wrapperDiv = screen.getByTestId('project-selector-button').closest('div.relative.flex-1');
      expect(wrapperDiv?.className).toContain('custom-class');
    });
  });

  describe('Dropdown Toggle', () => {
    it('should open dropdown on button click', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();
    });

    it('should toggle dropdown on button click', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');

      // Initially closed
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();

      // Open dropdown
      await user.click(button);

      // Wait for it to appear
      await waitFor(() => {
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();
      });
    });

    it('should display all projects in dropdown', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByText('project1')).toBeDefined();
      expect(screen.getByText('project2')).toBeDefined();
      expect(screen.getByText('my-special-project')).toBeDefined();
    });

    it('should show full path as tooltip', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const project1Option = screen.getByTestId('project-option-/home/user/projects/project1');
      expect(project1Option.getAttribute('title')).toBe('/home/user/projects/project1');
    });

    it('should close dropdown on Escape key', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);
      expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      });
    });

    it('should close dropdown on click outside', async () => {
      render(
        <div>
          <ProjectSelector />
          <div data-testid="outside">Outside</div>
        </div>
      );

      const button = screen.getByTestId('project-selector-button');
      await userEvent.click(button);
      expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();

      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside);

      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      });
    });
  });

  describe('Project Selection', () => {
    it('should call setSelectedProject when a project is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const project1Option = screen.getByTestId('project-option-/home/user/projects/project1');
      await user.click(project1Option);

      expect(mockSetSelectedProject).toHaveBeenCalledWith('/home/user/projects/project1');
    });

    it('should close dropdown after selecting a project', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const project1Option = screen.getByTestId('project-option-/home/user/projects/project1');
      await user.click(project1Option);

      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      });
    });

    it('should highlight selected project in dropdown', async () => {
      const user = userEvent.setup();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        selectedProject: '/home/user/projects/project1',
      });

      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const selectedProject = screen.getByTestId('project-option-/home/user/projects/project1');
      expect(selectedProject.getAttribute('aria-selected')).toBe('true');
    });

    it('should not highlight non-selected projects in dropdown', async () => {
      const user = userEvent.setup();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        selectedProject: '/home/user/projects/project1',
      });

      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const nonSelectedProject = screen.getByTestId('project-option-/home/user/projects/project2');
      expect(nonSelectedProject.getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('Add Project Flow', () => {
    it('should show add project button in dropdown when onAddProject is provided', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector onAddProject={mockOnAddProject} />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByTestId('add-project-button')).toBeDefined();
    });

    it('should not show add project button when onAddProject is not provided', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.queryByTestId('add-project-button')).toBeNull();
    });

    it('should call onAddProject when add button is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector onAddProject={mockOnAddProject} />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      expect(mockOnAddProject).toHaveBeenCalled();
    });

    it('should close dropdown when add button is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector onAddProject={mockOnAddProject} />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      });
    });
  });

  describe('Remove Project Flow', () => {
    it('should show remove button (x) on each project in dropdown', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByTestId('remove-project-/home/user/projects/project1')).toBeDefined();
      expect(screen.getByTestId('remove-project-/home/user/projects/project2')).toBeDefined();
    });

    it('should show confirmation dialog when remove button is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      expect(screen.getByTestId('remove-confirm-modal')).toBeDefined();
      expect(screen.getByText(/Remove project1 from project list/)).toBeDefined();
    });

    it('should call removeProject on confirmation', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      const confirmButton = screen.getByTestId('remove-confirm-submit');
      await user.click(confirmButton);

      expect(mockRemoveProject).toHaveBeenCalledWith('/home/user/projects/project1');
    });

    it('should close confirmation on cancel', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      const cancelButton = screen.getByTestId('remove-confirm-cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByTestId('remove-confirm-modal')).toBeNull();
      });
    });

    it('should close confirmation on Escape key', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      expect(screen.getByTestId('remove-confirm-modal')).toBeDefined();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByTestId('remove-confirm-modal')).toBeNull();
      });
    });
  });

  describe('Loading State', () => {
    it('should disable button during loading', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button).toHaveProperty('disabled', true);
    });

    it('should show Loading... text during loading', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      expect(screen.getByText('Loading...')).toBeDefined();
    });

    it('should not open dropdown when loading', async () => {
      const user = userEvent.setup();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
    });
  });

  describe('Empty State', () => {
    it('should show "No projects available" when projects list is empty', async () => {
      const user = userEvent.setup();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projects: [],
      });

      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByText('No projects available')).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should display error message when projectsError is set', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projectsError: 'Failed to load projects',
      });

      render(<ProjectSelector />);
      expect(screen.getByText('Failed to load projects')).toBeDefined();
    });
  });

  describe('Accessibility', () => {
    it('should have aria-expanded attribute on dropdown button', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-expanded')).toBeDefined();
    });

    it('should have aria-haspopup attribute on dropdown button', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    });

    it('should have role=listbox on dropdown menu', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const dropdown = screen.getByTestId('project-selector-dropdown');
      expect(dropdown.getAttribute('role')).toBe('listbox');
    });

    it('should have role=option on each project item', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const project1Option = screen.getByTestId('project-option-/home/user/projects/project1');
      expect(project1Option.getAttribute('role')).toBe('option');
    });

    it('should have aria-label on dropdown button', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-label')).toContain('Select project');
    });
  });
});
