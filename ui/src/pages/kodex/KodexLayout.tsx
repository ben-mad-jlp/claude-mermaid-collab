/**
 * Kodex Layout - Wrapper for all Kodex pages
 */

import React, { useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { KodexSidebar } from '@/components/kodex/KodexSidebar';
import { ProjectSelector } from '@/components/kodex/ProjectSelector';
import { useTheme } from '@/hooks/useTheme';
import { useKodexStore } from '@/stores/kodexStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useWebSocket } from '@/hooks/useWebSocket';

export const KodexLayout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { selectedProject, fetchProjects, setSelectedProject } = useKodexStore();
  const currentSession = useSessionStore((s) => s.currentSession);
  const { isConnected, isConnecting } = useWebSocket();

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // On mount: fetch projects and set default
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // On mount: set default project from session if available
  useEffect(() => {
    if (!selectedProject && currentSession?.project) {
      setSelectedProject(currentSession.project);
    }
  }, [selectedProject, currentSession?.project, setSelectedProject]);

  // Handle refresh projects
  const handleRefreshProjects = useCallback(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Handle adding a new project
  const handleAddProject = useCallback(async () => {
    const projectPath = window.prompt('Enter project path:', '/Users');

    // User cancelled or entered empty path
    if (!projectPath?.trim()) {
      return;
    }

    try {
      // Register the project via the projects API
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || 'Failed to add project');
        return;
      }

      // Refresh projects list and select the new project
      await fetchProjects();
      setSelectedProject(projectPath.trim());
    } catch (error) {
      console.error('Failed to add project:', error);
      alert('Failed to add project');
    }
  }, [fetchProjects, setSelectedProject]);

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <KodexSidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {/* Connection Status Badge */}
            <div
              data-testid="connection-badge"
              className={`
                flex items-center gap-1.5
                px-2 py-1
                text-xs font-medium
                rounded-full
                ${
                  isConnected
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    : isConnecting
                    ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                    : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                }
              `}
            >
              <span
                className={`
                  w-2 h-2 rounded-full
                  ${
                    isConnected
                      ? 'bg-green-500'
                      : isConnecting
                      ? 'bg-yellow-500 animate-pulse'
                      : 'bg-red-500'
                  }
                `}
              />
              <span>
                {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
              </span>
            </div>
            {/* Refresh Projects Button */}
            <button
              data-testid="refresh-projects"
              onClick={handleRefreshProjects}
              aria-label="Refresh projects"
              title="Refresh projects"
              className="
                p-2
                text-gray-600 dark:text-gray-300
                hover:text-gray-900 dark:hover:text-white
                hover:bg-gray-100 dark:hover:bg-gray-700
                rounded-lg
                transition-colors
              "
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
            </button>
            <ProjectSelector className="w-[400px]" onAddProject={handleAddProject} />
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
