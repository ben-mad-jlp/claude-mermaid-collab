import { create } from 'zustand';
import { projectsApi, type Project } from '@/lib/projects-api';

export interface KodexState {
  // State
  selectedProject: string | null;     // Absolute path to selected project
  projects: Project[];                // List of all registered projects
  isLoadingProjects: boolean;         // Loading state
  projectsError: string | null;       // Error message if any

  // Setters
  setSelectedProject: (path: string | null) => void;
  setProjects: (projects: Project[]) => void;
  setLoadingProjects: (loading: boolean) => void;
  setProjectsError: (error: string | null) => void;

  // Actions
  fetchProjects: () => Promise<void>;
  addProject: (path: string) => Promise<boolean>;
  removeProject: (path: string) => Promise<boolean>;
  reset: () => void;
}

export const useKodexStore = create<KodexState>((set, get) => ({
  // Initial state
  selectedProject: null,
  projects: [],
  isLoadingProjects: false,
  projectsError: null,

  // Setters
  setSelectedProject: (path) => {
    set({
      selectedProject: path,
      projectsError: null,
    });
  },

  setProjects: (projects) => {
    set({
      projects,
      projectsError: null,
    });
  },

  setLoadingProjects: (loading) => {
    set({ isLoadingProjects: loading });
  },

  setProjectsError: (error) => {
    set({ projectsError: error });
  },

  // Actions
  fetchProjects: async () => {
    set({ isLoadingProjects: true });
    try {
      const projects = await projectsApi.list();
      set({
        projects,
        projectsError: null,
        isLoadingProjects: false,
      });
    } catch (error) {
      set({
        projectsError: error instanceof Error ? error.message : 'Failed to fetch projects',
        isLoadingProjects: false,
      });
    }
  },

  addProject: async (path: string) => {
    try {
      const result = await projectsApi.register(path);
      if (!result.success) {
        set({
          projectsError: result.error || 'Failed to register project',
        });
        return false;
      }

      // Refresh the projects list
      await get().fetchProjects();

      // Auto-select the new project
      set({ selectedProject: path });

      return true;
    } catch (error) {
      set({
        projectsError: error instanceof Error ? error.message : 'Failed to add project',
      });
      return false;
    }
  },

  removeProject: async (path: string) => {
    try {
      const result = await projectsApi.unregister(path);
      if (!result.success) {
        set({
          projectsError: 'Failed to remove project',
        });
        return false;
      }

      // Clear selection if it was the removed project
      const currentState = get();
      if (currentState.selectedProject === path) {
        set({ selectedProject: null });
      }

      // Refresh the projects list
      await get().fetchProjects();

      return true;
    } catch (error) {
      set({
        projectsError: error instanceof Error ? error.message : 'Failed to remove project',
      });
      return false;
    }
  },

  reset: () => {
    set({
      selectedProject: null,
      projects: [],
      isLoadingProjects: false,
      projectsError: null,
    });
  },
}));
