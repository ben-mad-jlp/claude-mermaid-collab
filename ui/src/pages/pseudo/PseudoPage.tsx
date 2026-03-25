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
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '@/stores/sessionStore';
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

  // Get project and session switcher from session store
  const project = useSessionStore((s) => s.currentSession?.project || '');
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);

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
  const prevProjectRef = useRef<string>(project);

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
    <div className="flex h-screen w-full bg-white dark:bg-gray-900">
      {/* Left Column: File Tree (280px) */}
      <div className="w-[280px] border-r border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-hidden">
        <PseudoFileTree
          fileList={fileList}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          project={project}
          onProjectChange={(newProject) => {
            const match = sessions.find((s) => s.project === newProject);
            if (match) setCurrentSession(match);
          }}
        />
      </div>

      {/* Center Column: Viewer (flex-1) */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <PseudoViewer
          ref={viewerRef}
          path={currentPath}
          project={project}
          onFunctionsChange={setFunctions}
        />
      </div>

      {/* Right Column: Function Jump Panel (220px) */}
      <div className="w-[220px] border-l border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-hidden">
        <FunctionJumpPanel functions={functions} viewerRef={viewerRef} />
      </div>

      {/* Search Overlay */}
      <PseudoSearch
        project={project}
        isOpen={searchOpen}
        onClose={handleSearchClose}
        onNavigate={handleSearchNavigate}
      />
    </div>
  );
}
