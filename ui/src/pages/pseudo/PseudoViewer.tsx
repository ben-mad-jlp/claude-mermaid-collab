/**
 * PseudoViewer - Center panel for viewing pseudo-file contents
 *
 * Displays:
 * - Pseudo-file content with syntax highlighting
 * - File metadata and breadcrumbs
 * - Line numbers and code blocks
 * - Empty state when no file selected
 */

import React, { forwardRef, useCallback, useEffect, useState, useImperativeHandle, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPseudoFile, peekPseudoFile, PseudoFileWithMethods, PseudoMethod } from '@/lib/pseudo-api';
import PseudoBlock from './PseudoBlock';

export type PseudoViewerHandle = {
  scrollToFunction: (name: string) => void;
};

export type PseudoViewerProps = {
  path: string;
  project: string;
  onFunctionsChange?: (functions: any[]) => void;
};

/**
 * PseudoViewer Component
 * Renders a single pseudo-file with syntax highlighting
 */
export const PseudoViewer = forwardRef<PseudoViewerHandle, PseudoViewerProps>(
  ({ path, project, onFunctionsChange }, ref) => {
    const navigate = useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    // Seed synchronously from the LRU so a revisit paints instantly.
    const initial = path && project ? peekPseudoFile(project, path) : null;
    const [fileData, setFileData] = useState<PseudoFileWithMethods | null>(initial);
    const [loading, setLoading] = useState(initial == null);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load pseudo-file content when path or project changes.
     * If we already rendered a cached value, revalidate silently in the
     * background (do not flip loading=true).
     */
    useEffect(() => {
      if (!path || !project) {
        setFileData(null);
        setLoading(false);
        return;
      }

      const cached = peekPseudoFile(project, path);
      const hasCached = cached != null;
      if (hasCached) {
        setFileData(cached);
      }

      const controller = new AbortController();

      const loadFile = async () => {
        try {
          if (!hasCached) setLoading(true);
          setError(null);
          const data = await fetchPseudoFile(project, path, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setFileData(data);
        } catch (err) {
          if (controller.signal.aborted || (err as any)?.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : 'Failed to load file');
          if (!hasCached) setFileData(null);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      };

      loadFile();

      return () => {
        controller.abort();
      };
    }, [path, project]);

    // Notify parent of methods change
    useEffect(() => {
      if (onFunctionsChange && fileData) {
        onFunctionsChange(fileData.methods);
      }
    }, [fileData?.methods, onFunctionsChange]);

    // Expose scrollToFunction via imperative handle
    useImperativeHandle(ref, () => ({
      scrollToFunction: (name: string) => {
        const el = contentRef.current?.querySelector(`[data-function="${name}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('function-flash');
          setTimeout(() => el.classList.remove('function-flash'), 1500);
        }
      },
    }));

    const handleBlockNavigate = useCallback(
      (stem: string) => {
        navigate(`/pseudo/${stem}`);
      },
      [navigate]
    );

    const currentFileStem = useMemo(
      () => path.split('/').pop() || path,
      [path]
    );

    // Empty state
    if (!path) {
      return (
        <div className="h-full flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-400">Select a file to view</p>
        </div>
      );
    }

    // Loading state: skeleton with file-path header + ghost method cards.
    if (loading) {
      return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
          <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex-shrink-0">
            <div className="text-sm font-mono text-gray-600 dark:text-gray-400 truncate">
              {path}
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-6" data-testid="pseudo-viewer-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/4 mb-3" />
                <div className="space-y-1.5">
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-5/6" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/6" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // Error state
    if (error) {
      return (
        <div className="h-full flex items-center justify-center p-4">
          <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg max-w-md">
            <p className="text-red-700 dark:text-red-300">Error loading file:</p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
        {/* Header with file info */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 flex-shrink-0 flex items-baseline justify-between gap-4">
          <div className="text-sm font-mono text-gray-600 dark:text-gray-400 truncate">
            {path}
          </div>
          {fileData?.syncedAt && (
            <div className="text-xs flex-shrink-0" style={{ color: '#a8a29e' }}>
              synced {fileData.syncedAt.slice(0, 10)}
            </div>
          )}
        </div>

        {/* Content area */}
        <div ref={contentRef} className="flex-1 overflow-auto p-4">
          {/* Module header: title, purpose, context */}
          {fileData && (fileData.title || fileData.purpose || fileData.moduleContext?.trim()) && (
            <div className="mb-6 pb-4 border-b border-purple-100 dark:border-purple-900">
              {fileData.title && (
                <div className="text-lg font-bold mb-1" style={{ color: '#7c3aed' }}>{fileData.title}</div>
              )}
              {fileData.purpose && (
                <div className="text-sm font-medium mb-2" style={{ color: '#44403c' }}>{fileData.purpose}</div>
              )}
              {fileData.moduleContext?.trim() && fileData.moduleContext.split('\n').filter(l => l.trim()).map((line, idx) => (
                <p key={idx} className="text-sm" style={{ color: '#57534e' }}>{line}</p>
              ))}
            </div>
          )}

          {!fileData || fileData.methods.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No functions</p>
          ) : (
            <div className="space-y-4">
              {fileData.methods.map((method, idx) => (
                <PseudoBlock
                  key={idx}
                  func={method}
                  project={project}
                  currentFileStem={currentFileStem}
                  onNavigate={handleBlockNavigate}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

PseudoViewer.displayName = 'PseudoViewer';
