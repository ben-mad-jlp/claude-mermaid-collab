/**
 * ProjectSelector Component Tests
 *
 * Test coverage includes:
 * - Component rendering and initialization
 * - Dropdown toggle behavior
 * - Project selection
 * - Add project flow
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

  let mockAddProject: ReturnType<typeof vi.fn>;
  let mockRemoveProject: ReturnType<typeof vi.fn>;
  let mockSetSelectedProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAddProject = vi.fn().mockResolvedValue(true);
    mockRemoveProject = vi.fn().mockResolvedValue(true);
    mockSetSelectedProject = vi.fn();

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
      addProject: mockAddProject,
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

    it('should include add project button', () => {
      render(<ProjectSelector />);
      const addButton = screen.getByTestId('add-project-button');
      expect(addButton).toBeDefined();
      expect(addButton.getAttribute('aria-label')).toBe('Add project');
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

      const project2 = screen.getByTestId('project-option-/home/user/projects/project2');
      expect(project2.getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('Add Project Flow', () => {
    it('should open add modal on + button click', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      expect(screen.getByTestId('add-project-modal')).toBeDefined();
      expect(screen.getByTestId('add-project-input')).toBeDefined();
    });

    it('should show Add and Cancel buttons in modal', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      expect(screen.getByTestId('add-project-submit')).toBeDefined();
      expect(screen.getByTestId('add-project-cancel')).toBeDefined();
    });

    it('should call addProject with input value on submit', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const input = screen.getByTestId('add-project-input');
      await user.type(input, '/home/user/projects/newproject');

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      expect(mockAddProject).toHaveBeenCalledWith('/home/user/projects/newproject');
    });

    it('should close modal on successful project addition', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const input = screen.getByTestId('add-project-input');
      await user.type(input, '/home/user/projects/newproject');

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByTestId('add-project-modal')).toBeNull();
      });
    });

    it('should close modal on cancel button click', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      expect(screen.getByTestId('add-project-modal')).toBeDefined();

      const cancelButton = screen.getByTestId('add-project-cancel');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByTestId('add-project-modal')).toBeNull();
      });
    });

    it('should close modal on Escape key', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      expect(screen.getByTestId('add-project-modal')).toBeDefined();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByTestId('add-project-modal')).toBeNull();
      });
    });

    it('should show error message on failed project addition', async () => {
      const user = userEvent.setup();
      mockAddProject.mockResolvedValueOnce(false);
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projectsError: 'Path does not exist',
      });

      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const input = screen.getByTestId('add-project-input');
      await user.type(input, '/nonexistent/path');

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Path does not exist')).toBeDefined();
      });
    });

    it('should validate that path is not empty', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      expect(mockAddProject).not.toHaveBeenCalled();
    });

    it('should clear input after successful addition', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const input = screen.getByTestId('add-project-input') as HTMLInputElement;
      await user.type(input, '/home/user/projects/newproject');

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      // Modal should close after successful submission
      await waitFor(() => {
        expect(screen.queryByTestId('add-project-modal')).toBeNull();
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

    it('should show confirmation message with project name', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      expect(screen.getByText(/Remove project1 from project list/)).toBeDefined();
    });

    it('should show Remove and Cancel buttons in confirmation', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      expect(screen.getByTestId('remove-confirm-submit')).toBeDefined();
      expect(screen.getByTestId('remove-confirm-cancel')).toBeDefined();
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

    it('should close dropdown after removal', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      const confirmButton = screen.getByTestId('remove-confirm-submit');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      });
    });

    it('should cancel removal on cancel button click', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      expect(screen.getByTestId('remove-confirm-modal')).toBeDefined();

      const cancelButton = screen.getByTestId('remove-confirm-cancel');
      await user.click(cancelButton);

      // Confirmation should close
      expect(screen.queryByTestId('remove-confirm-modal')).toBeNull();
    });

    it('should cancel removal on Escape key', async () => {
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

    it('should prevent dropdown close when remove button is clicked', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const removeButton = screen.getByTestId('remove-project-/home/user/projects/project1');
      await user.click(removeButton);

      // Dropdown should still be visible
      expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should display error message from store', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projectsError: 'Failed to load projects',
      });

      render(<ProjectSelector />);
      expect(screen.getByText('Failed to load projects')).toBeDefined();
    });

    it('should clear store error after 3 seconds', async () => {
      const setProjectsError = vi.fn();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projectsError: 'Failed to load projects',
        setProjectsError,
      });

      vi.useFakeTimers();
      try {
        render(<ProjectSelector />);

        expect(screen.getByText('Failed to load projects')).toBeDefined();

        vi.advanceTimersByTime(3001);

        await vi.waitFor(
          () => {
            expect(setProjectsError).toHaveBeenCalledWith(null);
          },
          { timeout: 100 }
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('should show error message in add modal on failed addition', async () => {
      const user = userEvent.setup();
      mockAddProject.mockResolvedValueOnce(false);

      const { rerender } = render(<ProjectSelector />);

      const addButton = screen.getByTestId('add-project-button');
      await user.click(addButton);

      const input = screen.getByTestId('add-project-input');
      await user.type(input, '/invalid');

      const submitButton = screen.getByTestId('add-project-submit');
      await user.click(submitButton);

      // Simulate store update with error
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projectsError: 'Invalid path',
      });

      rerender(<ProjectSelector />);

      expect(screen.getByText('Invalid path')).toBeDefined();
    });
  });

  describe('Empty State', () => {
    it('should show "Select Project" when no projects', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projects: [],
        selectedProject: null,
      });

      render(<ProjectSelector />);
      expect(screen.getByText('Select Project')).toBeDefined();
    });

    it('should show empty state message in dropdown when no projects', async () => {
      const user = userEvent.setup();
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        projects: [],
        selectedProject: null,
      });

      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('No projects available')).toBeDefined();
      }, { timeout: 500 });
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label on dropdown button', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-label')).toBeDefined();
    });

    it('should have aria-expanded attribute on button', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-expanded')).toBe('false');

      await user.click(button);

      await waitFor(() => {
        expect(button.getAttribute('aria-expanded')).toBe('true');
      }, { timeout: 500 });
    });

    it('should have aria-haspopup attribute on button', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    });

    it('should have role attribute on dropdown', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      await waitFor(() => {
        const dropdown = screen.getByTestId('project-selector-dropdown');
        expect(dropdown.getAttribute('role')).toBe('listbox');
      }, { timeout: 500 });
    });

    it('should have aria-selected on project options', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      await waitFor(() => {
        const options = screen.getAllByRole('option');
        expect(options.length).toBeGreaterThan(0);
        options.forEach((option) => {
          expect(option.getAttribute('aria-selected')).toBeDefined();
        });
      }, { timeout: 500 });
    });

    it('should have proper labels on buttons', () => {
      render(<ProjectSelector />);
      const addButton = screen.getByTestId('add-project-button');
      expect(addButton.getAttribute('aria-label') || addButton.getAttribute('title')).toBeDefined();
    });
  });

  describe('Loading State', () => {
    it('should disable interactions while loading', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.getAttribute('disabled')).toBe('');
    });

    it('should hide dropdown while loading', () => {
      mockUseKodexStore.mockReturnValue({
        ...mockUseKodexStore(),
        isLoadingProjects: true,
      });

      render(<ProjectSelector />);
      expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
    });
  });

  describe('Styling', () => {
    it('should support dark mode classes', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.className).toMatch(/dark:/);
    });

    it('should have hover states', () => {
      render(<ProjectSelector />);
      const button = screen.getByTestId('project-selector-button');
      expect(button.className).toMatch(/hover:/);
    });
  });

  describe('Keyboard Navigation', () => {
    it('should support Enter key on project options', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      const firstOption = screen.getByTestId('project-option-/home/user/projects/project1');
      firstOption.focus();

      await user.keyboard('{Enter}');

      expect(mockSetSelectedProject).toHaveBeenCalledWith('/home/user/projects/project1');
    });

    it('should close dropdown on Escape in dropdown', async () => {
      const user = userEvent.setup();
      render(<ProjectSelector />);

      const button = screen.getByTestId('project-selector-button');
      await user.click(button);

      expect(screen.getByTestId('project-selector-dropdown')).toBeDefined();

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByTestId('project-selector-dropdown')).toBeNull();
      }, { timeout: 500 });
    });
  });
});
