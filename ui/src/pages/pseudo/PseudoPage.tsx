/**
 * PseudoPage - Top-level layout and state owner for pseudo-file viewer
 *
 * Manages:
 * - File list fetching and caching
 * - Current file navigation via URL params
 * - Three-column layout (FileTree, Viewer, FunctionJumpPanel)
 * - Global keyboard shortcuts (Cmd+K / Cmd+F for search)
 * - Search overlay state
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useKodexStore } from '@/stores/kodexStore';
import { NavMenu } from '@/components/layout/NavMenu';
import { ProjectSelector } from '@/components/kodex/ProjectSelector';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTheme } from '@/hooks/useTheme';
import { fetchPseudoFiles } from '@/lib/pseudo-api';
import { PseudoFileTree } from './PseudoFileTree';
import { PseudoViewer, type PseudoViewerHandle } from './PseudoViewer';
import FunctionJumpPanel from './FunctionJumpPanel';
import PseudoSearch from './PseudoSearch';
import type { ParsedFunction } from './parsePseudo';

export type PseudoPageState = {
  fileList: string[];
  fileCache: Map<string, string>;
  searchQuery: string;
  searchOpen: boolean;
};

/**
 * PseudoPage Component
 * Top-level layout and state owner for the pseudo-file viewer
 */
export default function PseudoPage(): JSX.Element {
  // Get current path from URL params (wildcard route "*" param)
  const params = useParams<{ '*': string }>();
  const currentPath = params['*'] || '';

  // Get navigation function
  const navigate = useNavigate();

  const { selectedProject: project, fetchProjects, setSelectedProject } = useKodexStore();
  const { isConnected, isConnecting } = useWebSocket();
  const { theme, toggleTheme } = useTheme();

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleAddProject = useCallback(async () => {
    const projectPath = window.prompt('Enter project path:', '/Users');
    if (!projectPath?.trim()) return;
    try {
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
      await fetchProjects();
      setSelectedProject(projectPath.trim());
    } catch {
      alert('Failed to add project');
    }
  }, [fetchProjects, setSelectedProject]);

  // State management
  const [fileList, setFileList] = useState<string[]>([]);
  const [fileCache] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [functions, setFunctions] = useState<ParsedFunction[]>([]);

  // Pending scroll target: set when search navigates to a function
  const [pendingScrollTarget, setPendingScrollTarget] = useState<string | null>(null);

  const viewerRef = useRef<PseudoViewerHandle>(null);

  // Track previous project to detect changes
  const prevProjectRef = useRef<string | null>(project);

  /**
   * Fetch pseudo files for the current project
   */
  const loadPseudoFiles = useCallback(async () => {
    if (!project) return;

    try {
      const files = await fetchPseudoFiles(project);
      setFileList(files);
    } catch (error) {
      console.error('Failed to load pseudo files:', error);
      setFileList([]);
    }
  }, [project]);

  /**
   * On mount: fetch file list for current project
   */
  useEffect(() => {
    loadPseudoFiles();
  }, [loadPseudoFiles]);

  /**
   * On project change: clear state and navigate to /pseudo
   */
  useEffect(() => {
    if (project && project !== prevProjectRef.current) {
      prevProjectRef.current = project;

      // Clear fileList and cache
      setFileList([]);
      fileCache.clear();

      // Navigate to /pseudo
      navigate('/pseudo');

      // Refetch files for new project
      loadPseudoFiles();
    }
  }, [project, navigate, fileCache, loadPseudoFiles]);

  /**
   * Global keyboard shortcuts for search
   * Cmd+K or Cmd+F -> open search
   * Escape -> close search
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open search on Cmd+K or Cmd+F
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault();
        setSearchOpen(true);
      }

      // Close search on Escape
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  /**
   * Handle file tree navigation
   */
  const handleNavigate = useCallback(
    (stem: string) => {
      navigate(`/pseudo/${stem}`);
    },
    [navigate]
  );

  /**
   * Handle search close
   */
  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
  }, []);

  // When functions update, trigger any pending scroll from search navigation
  useEffect(() => {
    if (pendingScrollTarget && functions.length > 0) {
      viewerRef.current?.scrollToFunction(pendingScrollTarget);
      setPendingScrollTarget(null);
    }
  }, [functions, pendingScrollTarget]);

  /**
   * Handle search navigation (when user clicks a result)
   */
  const handleSearchNavigate = useCallback(
    (file: string, functionName?: string) => {
      handleNavigate(file);
      setSearchOpen(false);
      if (functionName) {
        setPendingScrollTarget(functionName);
      }
    },
    [handleNavigate]
  );

  return (
    <div className="flex flex-col h-screen w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Full-width top header */}
      <header className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <NavMenu />
          {/* Title */}
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Pseudo</span>

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
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500' : isConnecting ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            <span>{isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}</span>
          </div>

          {/* Refresh Button */}
          <button
            onClick={loadPseudoFiles}
            aria-label="Refresh files"
            title="Refresh files"
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
          <ProjectSelector className="w-[400px]" onAddProject={handleAddProject} />

          {/* Search Button */}
          <button
            onClick={() => setSearchOpen(true)}
            title="Search pseudocode (⌘K)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Search</span>
            <kbd className="ml-1 text-gray-400 dark:text-gray-500">⌘K</kbd>
          </button>
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

      {/* Body: resizable file tree + viewer + jump panel */}
      <PanelGroup direction="horizontal" id="pseudo-layout" className="flex-1">
        {/* Left column: File Tree + cross-nav links */}
        <Panel defaultSizePercentage={28} minSizePercentage={12} id="pseudo-tree">
          <div className="flex flex-col h-full border-r border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <PseudoFileTree
                fileList={fileList}
                currentPath={currentPath}
                onNavigate={handleNavigate}
                project={project || ''}
              />
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-gray-200 dark:bg-gray-700 hover:bg-purple-400 dark:hover:bg-purple-600 transition-colors cursor-col-resize" />

        {/* Viewer */}
        <Panel defaultSizePercentage={57} minSizePercentage={30} id="pseudo-viewer">
          <div className="h-full overflow-hidden">
            <PseudoViewer
              ref={viewerRef}
              path={currentPath}
              project={project || ''}
              onFunctionsChange={setFunctions}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-gray-200 dark:bg-gray-700 hover:bg-purple-400 dark:hover:bg-purple-600 transition-colors cursor-col-resize" />

        {/* Function Jump Panel */}
        <Panel defaultSizePercentage={15} minSizePercentage={8} id="pseudo-jump">
          <div className="h-full overflow-hidden">
            <FunctionJumpPanel functions={functions} viewerRef={viewerRef} />
          </div>
        </Panel>
      </PanelGroup>

      {/* Search Overlay */}
      <PseudoSearch
        project={project ?? ''}
        isOpen={searchOpen}
        onClose={handleSearchClose}
        onNavigate={handleSearchNavigate}
      />
    </div>
  );
}
