/**
 * Kodex Store Tests
 *
 * Tests for the Kodex project selection and management store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useKodexStore } from './kodexStore';
import { projectsApi, type Project } from '@/lib/projects-api';

// Mock the projects-api
vi.mock('@/lib/projects-api', () => ({
  projectsApi: {
    list: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

describe('Kodex Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useKodexStore.setState({
      selectedProject: null,
      projects: [],
      isLoadingProjects: false,
      projectsError: null,
    });
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with null selectedProject', () => {
      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
    });

    it('should initialize with empty projects array', () => {
      const state = useKodexStore.getState();
      expect(state.projects).toEqual([]);
    });

    it('should initialize with false isLoadingProjects', () => {
      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should initialize with null projectsError', () => {
      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });

    it('should have all required setter methods', () => {
      const state = useKodexStore.getState();
      expect(typeof state.setSelectedProject).toBe('function');
      expect(typeof state.setProjects).toBe('function');
      expect(typeof state.setLoadingProjects).toBe('function');
      expect(typeof state.setProjectsError).toBe('function');
    });

    it('should have all required action methods', () => {
      const state = useKodexStore.getState();
      expect(typeof state.fetchProjects).toBe('function');
      expect(typeof state.addProject).toBe('function');
      expect(typeof state.removeProject).toBe('function');
      expect(typeof state.reset).toBe('function');
    });
  });

  describe('setSelectedProject Setter', () => {
    it('should update selectedProject to provided path', () => {
      const store = useKodexStore.getState();
      store.setSelectedProject('/path/to/project');

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBe('/path/to/project');
    });

    it('should update selectedProject to null', () => {
      const store = useKodexStore.getState();
      store.setSelectedProject('/path/to/project');
      store.setSelectedProject(null);

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
    });

    it('should clear projectsError when setting selectedProject', () => {
      const store = useKodexStore.getState();
      useKodexStore.setState({ projectsError: 'Some error' });

      store.setSelectedProject('/path/to/project');

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });

    it('should clear projectsError when setting selectedProject to null', () => {
      const store = useKodexStore.getState();
      useKodexStore.setState({ projectsError: 'Some error' });

      store.setSelectedProject(null);

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });
  });

  describe('setProjects Setter', () => {
    it('should update projects to provided array', () => {
      const mockProjects: Project[] = [
        { path: '/project1', name: 'project1', lastAccess: '2025-01-25T00:00:00Z' },
        { path: '/project2', name: 'project2', lastAccess: '2025-01-25T00:00:00Z' },
      ];
      const store = useKodexStore.getState();
      store.setProjects(mockProjects);

      const state = useKodexStore.getState();
      expect(state.projects).toEqual(mockProjects);
    });

    it('should update projects to empty array', () => {
      const store = useKodexStore.getState();
      store.setProjects([]);

      const state = useKodexStore.getState();
      expect(state.projects).toEqual([]);
    });

    it('should clear projectsError when setting projects', () => {
      const store = useKodexStore.getState();
      useKodexStore.setState({ projectsError: 'Some error' });

      const mockProjects: Project[] = [
        { path: '/project1', name: 'project1', lastAccess: '2025-01-25T00:00:00Z' },
      ];
      store.setProjects(mockProjects);

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });
  });

  describe('setLoadingProjects Setter', () => {
    it('should update isLoadingProjects to true', () => {
      const store = useKodexStore.getState();
      store.setLoadingProjects(true);

      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(true);
    });

    it('should update isLoadingProjects to false', () => {
      const store = useKodexStore.getState();
      store.setLoadingProjects(true);
      store.setLoadingProjects(false);

      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });
  });

  describe('setProjectsError Setter', () => {
    it('should update projectsError to provided string', () => {
      const store = useKodexStore.getState();
      store.setProjectsError('An error occurred');

      const state = useKodexStore.getState();
      expect(state.projectsError).toBe('An error occurred');
    });

    it('should update projectsError to null', () => {
      const store = useKodexStore.getState();
      store.setProjectsError('An error occurred');
      store.setProjectsError(null);

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });
  });

  describe('fetchProjects Action', () => {
    it('should fetch projects from API and update state', async () => {
      const mockProjects: Project[] = [
        { path: '/project1', name: 'project1', lastAccess: '2025-01-25T00:00:00Z' },
        { path: '/project2', name: 'project2', lastAccess: '2025-01-25T00:00:00Z' },
      ];

      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.projects).toEqual(mockProjects);
      expect(projectsApi.list).toHaveBeenCalled();
    });

    it('should set isLoadingProjects to true while fetching', async () => {
      const mockProjects: Project[] = [];
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      const fetchPromise = store.fetchProjects();

      // Check loading state immediately (should be true)
      let state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(true);

      await fetchPromise;

      state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should set isLoadingProjects to false after successful fetch', async () => {
      const mockProjects: Project[] = [];
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should handle fetch error and set projectsError', async () => {
      const errorMessage = 'Failed to fetch projects';
      vi.mocked(projectsApi.list).mockRejectedValue(new Error(errorMessage));

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeDefined();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should set isLoadingProjects to false on error', async () => {
      vi.mocked(projectsApi.list).mockRejectedValue(new Error('Fetch failed'));

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should clear previous error on successful fetch', async () => {
      useKodexStore.setState({ projectsError: 'Previous error' });

      const mockProjects: Project[] = [];
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });
  });

  describe('addProject Action', () => {
    it('should register project and refresh list on success', async () => {
      const projectPath = '/path/to/new/project';
      const mockProject: Project = {
        path: projectPath,
        name: 'new-project',
        lastAccess: '2025-01-25T00:00:00Z',
      };
      const mockProjects: Project[] = [mockProject];

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: true,
        project: mockProject,
      });
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      const result = await store.addProject(projectPath);

      expect(result).toBe(true);
      expect(projectsApi.register).toHaveBeenCalledWith(projectPath);
      expect(projectsApi.list).toHaveBeenCalled();
    });

    it('should auto-select the new project on success', async () => {
      const projectPath = '/path/to/new/project';
      const mockProject: Project = {
        path: projectPath,
        name: 'new-project',
        lastAccess: '2025-01-25T00:00:00Z',
      };
      const mockProjects: Project[] = [mockProject];

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: true,
        project: mockProject,
      });
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.addProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBe(projectPath);
    });

    it('should set projects list on success', async () => {
      const projectPath = '/path/to/new/project';
      const mockProject: Project = {
        path: projectPath,
        name: 'new-project',
        lastAccess: '2025-01-25T00:00:00Z',
      };
      const mockProjects: Project[] = [mockProject];

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: true,
        project: mockProject,
      });
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.addProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.projects).toEqual(mockProjects);
    });

    it('should return false on error', async () => {
      const projectPath = '/invalid/path';
      const errorMsg = 'Invalid path';

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: false,
        error: errorMsg,
      });

      const store = useKodexStore.getState();
      const result = await store.addProject(projectPath);

      expect(result).toBe(false);
    });

    it('should set projectsError on error', async () => {
      const projectPath = '/invalid/path';
      const errorMsg = 'Invalid path';

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: false,
        error: errorMsg,
      });

      const store = useKodexStore.getState();
      await store.addProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeDefined();
    });

    it('should handle API exception on register', async () => {
      const projectPath = '/path/to/new/project';

      vi.mocked(projectsApi.register).mockRejectedValue(new Error('Network error'));

      const store = useKodexStore.getState();
      const result = await store.addProject(projectPath);

      expect(result).toBe(false);
    });

    it('should not auto-select on error', async () => {
      const projectPath = '/invalid/path';

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: false,
        error: 'Invalid path',
      });

      const store = useKodexStore.getState();
      await store.addProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
    });
  });

  describe('removeProject Action', () => {
    it('should unregister project and refresh list on success', async () => {
      const projectPath = '/path/to/project';
      const mockProjects: Project[] = [];

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: true });
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      const result = await store.removeProject(projectPath);

      expect(result).toBe(true);
      expect(projectsApi.unregister).toHaveBeenCalledWith(projectPath);
      expect(projectsApi.list).toHaveBeenCalled();
    });

    it('should clear selectedProject if it matches removed project', async () => {
      const projectPath = '/path/to/project';
      useKodexStore.setState({ selectedProject: projectPath });

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: true });
      vi.mocked(projectsApi.list).mockResolvedValue([]);

      const store = useKodexStore.getState();
      await store.removeProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
    });

    it('should not clear selectedProject if it does not match removed project', async () => {
      const removedPath = '/path/to/removed/project';
      const selectedPath = '/path/to/selected/project';
      useKodexStore.setState({ selectedProject: selectedPath });

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: true });
      vi.mocked(projectsApi.list).mockResolvedValue([]);

      const store = useKodexStore.getState();
      await store.removeProject(removedPath);

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBe(selectedPath);
    });

    it('should return false on error', async () => {
      const projectPath = '/path/to/project';

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: false });

      const store = useKodexStore.getState();
      const result = await store.removeProject(projectPath);

      expect(result).toBe(false);
    });

    it('should set projectsError on error', async () => {
      const projectPath = '/path/to/project';

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: false });

      const store = useKodexStore.getState();
      await store.removeProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeDefined();
    });

    it('should handle API exception on unregister', async () => {
      const projectPath = '/path/to/project';

      vi.mocked(projectsApi.unregister).mockRejectedValue(new Error('Network error'));

      const store = useKodexStore.getState();
      const result = await store.removeProject(projectPath);

      expect(result).toBe(false);
    });

    it('should set projects list on success', async () => {
      const projectPath = '/path/to/project';
      const remainingProject: Project = {
        path: '/path/to/other/project',
        name: 'other-project',
        lastAccess: '2025-01-25T00:00:00Z',
      };
      const mockProjects: Project[] = [remainingProject];

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: true });
      vi.mocked(projectsApi.list).mockResolvedValue(mockProjects);

      const store = useKodexStore.getState();
      await store.removeProject(projectPath);

      const state = useKodexStore.getState();
      expect(state.projects).toEqual(mockProjects);
    });
  });

  describe('reset Action', () => {
    it('should reset selectedProject to null', () => {
      useKodexStore.setState({ selectedProject: '/path/to/project' });

      const store = useKodexStore.getState();
      store.reset();

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
    });

    it('should reset projects to empty array', () => {
      const mockProjects: Project[] = [
        { path: '/project1', name: 'project1', lastAccess: '2025-01-25T00:00:00Z' },
      ];
      useKodexStore.setState({ projects: mockProjects });

      const store = useKodexStore.getState();
      store.reset();

      const state = useKodexStore.getState();
      expect(state.projects).toEqual([]);
    });

    it('should reset isLoadingProjects to false', () => {
      useKodexStore.setState({ isLoadingProjects: true });

      const store = useKodexStore.getState();
      store.reset();

      const state = useKodexStore.getState();
      expect(state.isLoadingProjects).toBe(false);
    });

    it('should reset projectsError to null', () => {
      useKodexStore.setState({ projectsError: 'Some error' });

      const store = useKodexStore.getState();
      store.reset();

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });

    it('should reset all state at once', () => {
      const mockProjects: Project[] = [
        { path: '/project1', name: 'project1', lastAccess: '2025-01-25T00:00:00Z' },
      ];
      useKodexStore.setState({
        selectedProject: '/path/to/project',
        projects: mockProjects,
        isLoadingProjects: true,
        projectsError: 'Error message',
      });

      const store = useKodexStore.getState();
      store.reset();

      const state = useKodexStore.getState();
      expect(state.selectedProject).toBeNull();
      expect(state.projects).toEqual([]);
      expect(state.isLoadingProjects).toBe(false);
      expect(state.projectsError).toBeNull();
    });
  });

  describe('Error State Management', () => {
    it('should clear error when fetchProjects succeeds after error', async () => {
      useKodexStore.setState({ projectsError: 'Previous error' });

      vi.mocked(projectsApi.list).mockResolvedValue([]);

      const store = useKodexStore.getState();
      await store.fetchProjects();

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });

    it('should clear error when addProject succeeds after error', async () => {
      useKodexStore.setState({ projectsError: 'Previous error' });

      const mockProject: Project = {
        path: '/project',
        name: 'project',
        lastAccess: '2025-01-25T00:00:00Z',
      };

      vi.mocked(projectsApi.register).mockResolvedValue({
        success: true,
        project: mockProject,
      });
      vi.mocked(projectsApi.list).mockResolvedValue([mockProject]);

      const store = useKodexStore.getState();
      await store.addProject('/project');

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });

    it('should clear error when removeProject succeeds after error', async () => {
      useKodexStore.setState({ projectsError: 'Previous error' });

      vi.mocked(projectsApi.unregister).mockResolvedValue({ success: true });
      vi.mocked(projectsApi.list).mockResolvedValue([]);

      const store = useKodexStore.getState();
      await store.removeProject('/project');

      const state = useKodexStore.getState();
      expect(state.projectsError).toBeNull();
    });
  });

  describe('Store Reactivity', () => {
    it('should notify subscribers when setSelectedProject is called', () => {
      const subscriber = vi.fn();
      const unsubscribe = useKodexStore.subscribe(subscriber);

      const store = useKodexStore.getState();
      store.setSelectedProject('/path');

      expect(subscriber).toHaveBeenCalled();
      unsubscribe();
    });

    it('should notify subscribers when fetchProjects completes', async () => {
      const subscriber = vi.fn();
      const unsubscribe = useKodexStore.subscribe(subscriber);

      vi.mocked(projectsApi.list).mockResolvedValue([]);

      const store = useKodexStore.getState();
      await store.fetchProjects();

      expect(subscriber).toHaveBeenCalled();
      unsubscribe();
    });

    it('should notify subscribers when reset is called', () => {
      const subscriber = vi.fn();
      const unsubscribe = useKodexStore.subscribe(subscriber);

      const store = useKodexStore.getState();
      store.reset();

      expect(subscriber).toHaveBeenCalled();
      unsubscribe();
    });
  });
});
