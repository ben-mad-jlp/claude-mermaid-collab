/**
 * PseudoViewer - Center panel for viewing pseudo-file contents
 *
 * Displays:
 * - Pseudo-file content with syntax highlighting
 * - File metadata and breadcrumbs
 * - Line numbers and code blocks
 * - Empty state when no file selected
 */

import React, { forwardRef, useEffect, useState, useCallback, useMemo, useImperativeHandle, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchPseudoFile } from '@/lib/pseudo-api';
import PseudoBlock from './PseudoBlock';
import { parsePseudo } from './parsePseudo';

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
    const [content, setContent] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Load pseudo-file content when path or project changes
     */
    useEffect(() => {
      if (!path || !project) {
        setContent('');
        setLoading(false);
        return;
      }

      const loadFile = async () => {
        try {
          setLoading(true);
          setError(null);
          const fileContent = await fetchPseudoFile(project, path);
          setContent(fileContent);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load file');
          setContent('');
        } finally {
          setLoading(false);
        }
      };

      loadFile();
    }, [path, project]);

    // Parse pseudo-file into blocks — memoized so reference is stable when content unchanged
    const parsed = useMemo(() => parsePseudo(content), [content]);

    // Notify parent of functions change
    useEffect(() => {
      if (onFunctionsChange) {
        onFunctionsChange(parsed.functions);
      }
    }, [parsed.functions, onFunctionsChange]);

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
          {parsed.syncedAt && (
            <div className="text-xs flex-shrink-0" style={{ color: '#a8a29e' }}>
              synced {parsed.syncedAt.slice(0, 10)}
            </div>
          )}
        </div>

        {/* Content area */}
        <div ref={contentRef} className="flex-1 overflow-auto p-4">
          {/* Module header: title, subtitle, prose */}
          {(parsed.titleLine || parsed.subtitleLine || parsed.moduleProse.length > 0) && (
            <div className="mb-6 pb-4 border-b border-purple-100 dark:border-purple-900">
              {parsed.titleLine && (
                <div className="text-lg font-bold mb-1" style={{ color: '#7c3aed' }}>{parsed.titleLine}</div>
              )}
              {parsed.subtitleLine && (
                <div className="text-sm font-medium mb-2" style={{ color: '#44403c' }}>{parsed.subtitleLine}</div>
              )}
              {parsed.moduleProse.filter(l => l.trim()).map((line, idx) => (
                <p key={idx} className="text-sm" style={{ color: '#57534e' }}>{line}</p>
              ))}
            </div>
          )}

          {parsed.functions.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No functions</p>
          ) : (
            <div className="space-y-4">
              {parsed.functions.map((func, idx) => (
                <PseudoBlock
                  key={idx}
                  func={func}
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
