/**
 * ProjectSelector Component
 *
 * A reusable dropdown component for selecting and managing projects.
 * Features:
 * - Display selected project or "Select Project" placeholder
 * - Dropdown menu showing all available projects
 * - Add new project via modal dialog
 * - Remove project with confirmation dialog
 * - Error handling and loading states
 * - Full keyboard navigation and accessibility support
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useKodexStore } from '@/stores/kodexStore';

export interface ProjectSelectorProps {
  className?: string;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    selectedProject,
    projects,
    isLoadingProjects,
    projectsError,
    addProject,
    removeProject,
    setSelectedProject,
    setProjectsError,
  } = useKodexStore();

  // Get basename from path
  const getBasename = (path: string): string => {
    return path.split('/').pop() || path;
  };

  // Get display name for selected project
  const getDisplayName = (): string => {
    if (!selectedProject) return 'Select Project';
    const project = projects.find((p) => p.path === selectedProject);
    return project ? project.name : getBasename(selectedProject);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setShowAddModal(false);
        setShowRemoveConfirm(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Clear error after 3 seconds
  useEffect(() => {
    if (projectsError) {
      const timer = setTimeout(() => {
        setProjectsError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [projectsError, setProjectsError]);

  const handleToggleDropdown = useCallback(() => {
    if (!isLoadingProjects) {
      setIsOpen((prev) => !prev);
    }
  }, [isLoadingProjects]);

  const handleSelectProject = useCallback(
    (path: string) => {
      setSelectedProject(path);
      setIsOpen(false);
    },
    [setSelectedProject]
  );

  const handleAddProjectClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAddModal(true);
  }, []);

  const handleRemoveClick = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setShowRemoveConfirm(path);
  }, []);

  const handleAddProjectSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!inputPath.trim()) {
        setLocalError('Path cannot be empty');
        return;
      }

      setLocalError(null);
      const success = await addProject(inputPath);

      if (success) {
        setInputPath('');
        setShowAddModal(false);
      }
    },
    [inputPath, addProject]
  );

  const handleAddProjectCancel = useCallback(() => {
    setShowAddModal(false);
    setInputPath('');
    setLocalError(null);
  }, []);

  const handleRemoveProjectConfirm = useCallback(
    async (path: string) => {
      const success = await removeProject(path);
      if (success) {
        setShowRemoveConfirm(null);
        setIsOpen(false);
      }
    },
    [removeProject]
  );

  const handleRemoveProjectCancel = useCallback(() => {
    setShowRemoveConfirm(null);
  }, []);

  return (
    <div className={`relative inline-flex items-center gap-2`}>
      <div className={`relative flex-1 ${className}`}>
        {/* Main Dropdown Button */}
        <button
          data-testid="project-selector-button"
          onClick={handleToggleDropdown}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={`Select project. Currently selected: ${getDisplayName()}`}
          disabled={isLoadingProjects}
          className={`
            flex items-center gap-2
            px-3 py-1.5
            text-sm font-medium
            rounded-lg
            transition-colors
            ${
              isLoadingProjects
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : `
                  text-gray-700 dark:text-gray-200
                  bg-gray-100 dark:bg-gray-700
                  hover:bg-gray-200 dark:hover:bg-gray-600
                  cursor-pointer
                `
            }
          `}
        >
        {isLoadingProjects ? (
          <>
            <svg
              data-testid="project-selector-loading"
              className="w-4 h-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span>Loading...</span>
          </>
        ) : (
          <>
            <span className="max-w-96 truncate">{getDisplayName()}</span>
            <svg
              className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </>
        )}
      </button>

      {/* Error Message */}
      {projectsError && (
        <div
          className={`
            mt-2 p-2
            text-sm text-red-700 dark:text-red-300
            bg-red-100 dark:bg-red-900/30
            rounded
            border border-red-300 dark:border-red-700
          `}
        >
          {projectsError}
        </div>
      )}

      {/* Dropdown Menu */}
      {isOpen && !isLoadingProjects && (
        <div
          ref={dropdownRef}
          data-testid="project-selector-dropdown"
          role="listbox"
          className={`
            absolute right-0 mt-2 w-80
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg
            z-50 overflow-hidden
            animate-fadeIn
          `}
        >
          {projects.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              No projects available
            </div>
          ) : (
            <ul className="max-h-60 overflow-y-auto">
              {projects.map((project) => (
                <li key={project.path}>
                  <div
                    className={`
                      flex items-center
                      hover:bg-gray-100 dark:hover:bg-gray-700
                      transition-colors
                      ${
                        selectedProject === project.path
                          ? 'bg-accent-50 dark:bg-accent-900/30'
                          : ''
                      }
                    `}
                  >
                    <button
                      data-testid={`project-option-${project.path}`}
                      role="option"
                      aria-selected={selectedProject === project.path}
                      onClick={() => handleSelectProject(project.path)}
                      title={project.path}
                      className={`
                        flex-1 px-4 py-2.5
                        text-left text-sm
                        ${
                          selectedProject === project.path
                            ? 'text-accent-700 dark:text-accent-300 font-medium'
                            : 'text-gray-700 dark:text-gray-200'
                        }
                      `}
                    >
                      <div className="truncate">{project.name}</div>
                    </button>
                    {
                      <button
                        data-testid={`remove-project-${project.path}`}
                        onClick={(e) => handleRemoveClick(e, project.path)}
                        className={`
                          p-2 mr-2
                          text-gray-400 hover:text-red-500
                          dark:text-gray-500 dark:hover:text-red-400
                          transition-colors
                        `}
                        aria-label={`Remove project ${project.name}`}
                        title={`Remove ${project.name}`}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    }
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>

      {/* Add Project Button */}
      <button
        data-testid="add-project-button"
        onClick={handleAddProjectClick}
        className={`
          p-2
          text-gray-600 dark:text-gray-300
          hover:text-gray-900 dark:hover:text-white
          hover:bg-gray-100 dark:hover:bg-gray-700
          rounded-lg
          transition-colors
        `}
        aria-label="Add project"
        title="Add project"
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Add Project Modal */}
      {showAddModal && (
        <div
          className={`
            fixed inset-0
            bg-black bg-opacity-50
            flex items-center justify-center
            z-50
          `}
        >
          <div
            data-testid="add-project-modal"
            className={`
              bg-white dark:bg-gray-800
              rounded-lg shadow-xl
              p-6
              w-96
              max-w-[calc(100vw-2rem)]
            `}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Add Project
            </h2>

            {localError && (
              <div
                className={`
                  mb-4 p-3
                  text-sm text-red-700 dark:text-red-300
                  bg-red-100 dark:bg-red-900/30
                  rounded
                  border border-red-300 dark:border-red-700
                `}
              >
                {localError}
              </div>
            )}

            <form onSubmit={handleAddProjectSubmit}>
              <input
                data-testid="add-project-input"
                type="text"
                placeholder="Enter project path"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                className={`
                  w-full
                  px-3 py-2
                  border border-gray-300 dark:border-gray-600
                  rounded
                  text-gray-900 dark:text-white
                  bg-white dark:bg-gray-700
                  placeholder-gray-400 dark:placeholder-gray-500
                  focus:outline-none focus:ring-2 focus:ring-accent-500
                  mb-4
                `}
                autoFocus
              />

              <div className="flex gap-2 justify-end">
                <button
                  data-testid="add-project-cancel"
                  type="button"
                  onClick={handleAddProjectCancel}
                  className={`
                    px-4 py-2
                    text-sm font-medium
                    text-gray-700 dark:text-gray-200
                    bg-gray-100 dark:bg-gray-700
                    hover:bg-gray-200 dark:hover:bg-gray-600
                    rounded
                    transition-colors
                  `}
                >
                  Cancel
                </button>
                <button
                  data-testid="add-project-submit"
                  type="submit"
                  className={`
                    px-4 py-2
                    text-sm font-medium
                    text-white
                    bg-accent-500 hover:bg-accent-600
                    rounded
                    transition-colors
                  `}
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {showRemoveConfirm && (
        <div
          className={`
            fixed inset-0
            bg-black bg-opacity-50
            flex items-center justify-center
            z-50
          `}
        >
          <div
            data-testid="remove-confirm-modal"
            className={`
              bg-white dark:bg-gray-800
              rounded-lg shadow-xl
              p-6
              w-96
              max-w-[calc(100vw-2rem)]
            `}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Remove Project
            </h2>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
              Remove {getBasename(showRemoveConfirm)} from project list? (This does not delete files)
            </p>

            <div className="flex gap-2 justify-end">
              <button
                data-testid="remove-confirm-cancel"
                type="button"
                onClick={handleRemoveProjectCancel}
                className={`
                  px-4 py-2
                  text-sm font-medium
                  text-gray-700 dark:text-gray-200
                  bg-gray-100 dark:bg-gray-700
                  hover:bg-gray-200 dark:hover:bg-gray-600
                  rounded
                  transition-colors
                `}
              >
                Cancel
              </button>
              <button
                data-testid="remove-confirm-submit"
                type="button"
                onClick={() => handleRemoveProjectConfirm(showRemoveConfirm)}
                className={`
                  px-4 py-2
                  text-sm font-medium
                  text-white
                  bg-red-500 hover:bg-red-600
                  rounded
                  transition-colors
                `}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSelector;
