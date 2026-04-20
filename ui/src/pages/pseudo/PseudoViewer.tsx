/**
 * PseudoViewer - Center panel for viewing pseudo-file contents
 *
 * Displays:
 * - Pseudo-file content with syntax highlighting
 * - File metadata and breadcrumbs
 * - Line numbers and code blocks
 * - Empty state when no file selected
 */

import React, { forwardRef, useEffect, useState, useImperativeHandle, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPseudoFile, PseudoFileWithMethods, PseudoMethod } from '@/lib/pseudo-api';
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
    const [fileData, setFileData] = useState<PseudoFileWithMethods | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load pseudo-file content when path or project changes
     */
    useEffect(() => {
      if (!path || !project) {
        setFileData(null);
        setLoading(false);
        return;
      }

      const controller = new AbortController();

      const loadFile = async () => {
        try {
          setLoading(true);
          setError(null);
          const data = await fetchPseudoFile(project, path, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setFileData(data);
        } catch (err) {
          if (controller.signal.aborted || (err as any)?.name === 'AbortError') return;
          setError(err instanceof Error ? err.message : 'Failed to load file');
          setFileData(null);
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

    // Empty state
    if (!path) {
      return (
        <div className="h-full flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-400">Select a file to view</p>
        </div>
      );
    }

    // Loading state
    if (loading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
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
                  currentFileStem={path.split('/').pop() || path}
                  onNavigate={(stem) => {
                    navigate(`/pseudo/${stem}`);
                  }}
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
