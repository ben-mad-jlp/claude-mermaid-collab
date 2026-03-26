/**
 * Onboarding Layout - Wrapper for all onboarding pages
 *
 * Matches KodexLayout pattern: left sidebar + top header + main content.
 * Provides OnboardingContext (mode, user, project).
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useKodexStore } from '@/stores/kodexStore';
import { ProjectSelector } from '@/components/kodex/ProjectSelector';
import { useTheme } from '@/hooks/useTheme';
import { useWebSocket } from '@/hooks/useWebSocket';
import { NavMenu } from '@/components/layout/NavMenu';
import { onboardingApi } from '@/lib/onboarding-api';
import type { OnboardingConfig, User } from '@/lib/onboarding-api';

// ============================================================================
// Context
// ============================================================================

interface OnboardingContextValue {
  mode: 'browse' | 'onboard';
  currentUser: User | null;
  setMode: (m: 'browse' | 'onboard') => void;
  setUser: (u: User | null) => void;
  project: string | null;
  config: OnboardingConfig | null;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  mode: 'browse',
  currentUser: null,
  setMode: () => {},
  setUser: () => {},
  project: null,
  config: null,
});

export const useOnboarding = () => useContext(OnboardingContext);

// ============================================================================
// Sidebar Nav Items
// ============================================================================

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  onboardOnly?: boolean;
}

const navItems: NavItem[] = [
  {
    path: '/onboarding',
    label: 'Browse',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    path: '/onboarding/graph',
    label: 'Graph',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="6" cy="6" r="3" strokeWidth={2} />
        <circle cx="18" cy="18" r="3" strokeWidth={2} />
        <circle cx="18" cy="6" r="3" strokeWidth={2} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.5 7.5L15.5 16.5M8.5 6L15.5 6" />
      </svg>
    ),
  },
  {
    path: '/onboarding/dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    onboardOnly: true,
  },
  {
    path: '/onboarding/team',
    label: 'Team',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    onboardOnly: true,
  },
];

// ============================================================================
// Component
// ============================================================================

export const OnboardingLayout: React.FC = () => {
  const { selectedProject, fetchProjects } = useKodexStore();
  const { theme, toggleTheme } = useTheme();
  const { isConnected, isConnecting } = useWebSocket();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<'browse' | 'onboard'>('browse');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    fetchProjects();
    if (selectedProject) {
      onboardingApi.getConfig(selectedProject)
        .then(setConfig)
        .catch(() => setConfig(null));
    }
  }, [fetchProjects, selectedProject]);

  // Fetch config when project changes
  useEffect(() => {
    if (!selectedProject) {
      setConfig(null);
      return;
    }
    onboardingApi.getConfig(selectedProject)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [selectedProject]);

  // Handle mode toggle
  const handleModeToggle = useCallback((newMode: 'browse' | 'onboard') => {
    setMode(newMode);
    if (newMode === 'onboard' && !currentUser) {
      navigate('/onboarding/welcome');
    } else if (newMode === 'browse') {
      navigate('/onboarding');
    }
  }, [currentUser, navigate]);

  // Handle search
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/onboarding/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }, [searchQuery, navigate]);

  // Nav active check
  const isActive = (path: string) => {
    if (path === '/onboarding') {
      return location.pathname === '/onboarding';
    }
    return location.pathname.startsWith(path);
  };

  // Filter nav items based on mode
  const visibleNavItems = navItems.filter(item => !item.onboardOnly || mode === 'onboard');

  const contextValue: OnboardingContextValue = {
    mode,
    currentUser,
    setMode,
    setUser: setCurrentUser,
    project: selectedProject,
    config,
  };

  return (
    <OnboardingContext.Provider value={contextValue}>
      <div className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        {/* Full-width top header */}
        <header className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <NavMenu />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Onboarding</span>
            {/* Connection Status Badge */}
            <div
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-full ${
                isConnected
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                  : isConnecting
                  ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                  : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'}`} />
              <span>{isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}</span>
            </div>
            {/* Refresh Button */}
            <button
              onClick={handleRefresh}
              aria-label="Refresh"
              title="Refresh"
              className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
            </button>
            {/* Project Selector */}
            <ProjectSelector className="w-[400px]" />
            {/* Search */}
            {selectedProject && (
              <form onSubmit={handleSearch} className="flex-1 max-w-md">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search topics..."
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </form>
            )}
          </div>
          {/* Theme Toggle */}
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

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          {/* Mode toggle */}
          {selectedProject && (
            <div className="px-3 pt-3 pb-1">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                <button
                  onClick={() => handleModeToggle('browse')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                    mode === 'browse'
                      ? 'bg-white dark:bg-gray-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  Browse
                </button>
                <button
                  onClick={() => handleModeToggle('onboard')}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                    mode === 'onboard'
                      ? 'bg-white dark:bg-gray-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  Onboard
                </button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 p-2 space-y-1">
            {visibleNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
                  ${isActive(item.path)
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                `}
              >
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* User chip (onboarding mode) */}
          {mode === 'onboard' && currentUser && (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-medium">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-blue-700 dark:text-blue-300 truncate">{currentUser.name}</span>
              </div>
            </div>
          )}

        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Page Content */}
          {!selectedProject ? (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <svg className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-lg font-medium text-gray-700 dark:text-gray-300">No project selected</p>
                <p className="text-sm mt-1 text-gray-400">Select a project from Kodex or Collab to get started</p>
              </div>
            </div>
          ) : (
            <main className="flex-1 overflow-auto p-6 flex flex-col">
              <Outlet />
            </main>
          )}
        </div>
        </div>
      </div>
    </OnboardingContext.Provider>
  );
};
