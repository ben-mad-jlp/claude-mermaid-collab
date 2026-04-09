/**
 * DiffAgainstDiskModal Component
 *
 * Modal showing a unified diff of the current in-editor code vs the disk or last-pushed version.
 * Used as the confirmation step for Push to File, and as a standalone "Preview Diff" viewer.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DiffViewer from 'react-diff-viewer-continued';
import { api } from '@/lib/api';
import { useTheme } from '@/hooks/useTheme';

export interface DiffAgainstDiskModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  snippetId: string;
  filePath: string;
  projectPath: string;
  sessionName: string;
}

interface ParsedSnippet {
  code: string;
  originalCode: string;
  diskCode: string;
}

function parseSnippetEnvelope(content: string | undefined): ParsedSnippet {
  if (!content) return { code: '', originalCode: '', diskCode: '' };
  try {
    const data = JSON.parse(content);
    return {
      code: typeof data.code === 'string' ? data.code : '',
      originalCode: typeof data.originalCode === 'string' ? data.originalCode : '',
      diskCode: typeof data.diskCode === 'string' ? data.diskCode : '',
    };
  } catch {
    return { code: content, originalCode: '', diskCode: '' };
  }
}

function basename(p: string): string {
  if (!p) return '';
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export const DiffAgainstDiskModal: React.FC<DiffAgainstDiskModalProps> = ({
  open,
  onClose,
  onConfirm,
  confirmLabel,
  snippetId,
  filePath,
  projectPath,
  sessionName,
}) => {
  const [parsed, setParsed] = useState<ParsedSnippet>({ code: '', originalCode: '', diskCode: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'disk' | 'pushed'>('disk');
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Fetch the snippet when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCompareMode('disk');
    setParsed({ code: '', originalCode: '', diskCode: '' });

    (async () => {
      try {
        const snippet = await api.getSnippet(projectPath, sessionName, snippetId);
        if (cancelled) return;
        if (!snippet) {
          setError('Snippet not found');
        } else {
          setParsed(parseSnippetEnvelope(snippet.content));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load snippet');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, snippetId, projectPath, sessionName]);

  // Escape key handler
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleConfirm = useCallback(async () => {
    try {
      await onConfirm?.();
    } finally {
      onClose();
    }
  }, [onConfirm, onClose]);

  if (!open) return null;

  const oldValue = compareMode === 'disk' ? parsed.diskCode : parsed.originalCode;
  const newValue = parsed.code;
  const leftTitle = compareMode === 'disk' ? 'Disk' : 'Last Pushed';
  const rightTitle = 'Local (editor)';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Review changes"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-5xl w-full mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Review changes to <code className="font-mono text-blue-600 dark:text-blue-400">{basename(filePath)}</code>
          </h3>
          <div className="flex items-center gap-2 bg-gray-200 dark:bg-gray-700 rounded-md p-1">
            <button
              onClick={() => setCompareMode('disk')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                compareMode === 'disk'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
              aria-pressed={compareMode === 'disk'}
            >
              vs. Disk
            </button>
            <button
              onClick={() => setCompareMode('pushed')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                compareMode === 'pushed'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
              aria-pressed={compareMode === 'pushed'}
            >
              vs. Last Pushed
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-gray-900">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
              Loading diff...
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center justify-center py-12 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && oldValue === newValue && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
              No changes detected
            </div>
          )}
          {!loading && !error && oldValue !== newValue && (
            <DiffViewer
              oldValue={oldValue}
              newValue={newValue}
              splitView={true}
              useDarkTheme={isDark}
              leftTitle={leftTitle}
              rightTitle={rightTitle}
              hideLineNumbers={false}
              showDiffOnly={true}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {onConfirm && (
            <button
              onClick={handleConfirm}
              disabled={loading || !!error || oldValue === newValue}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                loading || error || oldValue === newValue
                  ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {confirmLabel ?? 'Confirm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

DiffAgainstDiskModal.displayName = 'DiffAgainstDiskModal';

export default DiffAgainstDiskModal;
