/**
 * FileBrowserDialog
 *
 * Modal file picker for browsing project directories.
 * Lazy-loads directory contents and supports filtering, selection,
 * and size-based restrictions (files >1MB are not selectable).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';

interface FileBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (filePath: string) => void;
  project: string;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

const ONE_MB = 1024 * 1024;

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < ONE_MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / ONE_MB).toFixed(1)} MB`;
}

export const FileBrowserDialog: React.FC<FileBrowserDialogProps> = ({
  open,
  onClose,
  onSelect,
  project,
}) => {
  const [entries, setEntries] = useState<Map<string, FileEntry[]>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const loadDirectory = useCallback(async (dirPath: string) => {
    if (entries.has(dirPath)) return;

    setLoading(prev => {
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });

    try {
      const result = await api.listProjectFiles(project, dirPath || undefined);
      const fileEntries: FileEntry[] = (result.entries || []).map((f: any) => ({
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
        extension: f.extension,
      }));
      setEntries(prev => {
        const next = new Map(prev);
        next.set(dirPath, fileEntries);
        return next;
      });
    } catch {
      // On error, set empty array so we don't retry on every render
      setEntries(prev => {
        const next = new Map(prev);
        next.set(dirPath, []);
        return next;
      });
    } finally {
      setLoading(prev => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, [entries, project]);

  // Load root on open
  useEffect(() => {
    if (open) {
      setSelectedFile(null);
      setFilter('');
      setExpandedDirs(new Set());
      setEntries(new Map());
      // Need to load fresh after clearing
      const loadRoot = async () => {
        setLoading(new Set(['']));
        try {
          const result = await api.listProjectFiles(project);
          const fileEntries: FileEntry[] = (result.entries || []).map((f: any) => ({
            name: f.name,
            path: f.path,
            type: f.type,
            size: f.size,
            extension: f.extension,
          }));
          setEntries(new Map([['', fileEntries]]));
        } catch {
          setEntries(new Map([['', []]]));
        } finally {
          setLoading(new Set());
        }
      };
      loadRoot();
    }
  }, [open, project]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        // Lazy-load if not already cached
        if (!entries.has(dirPath)) {
          loadDirectory(dirPath);
        }
      }
      return next;
    });
  }, [entries, loadDirectory]);

  const handleLink = useCallback(() => {
    if (selectedFile) {
      onSelect(selectedFile);
      onClose();
    }
  }, [selectedFile, onSelect, onClose]);

  const filterLower = useMemo(() => filter.toLowerCase(), [filter]);

  const matchesFilter = useCallback((entry: FileEntry): boolean => {
    if (!filterLower) return true;
    return entry.name.toLowerCase().includes(filterLower);
  }, [filterLower]);

  const renderEntries = useCallback((dirPath: string, level: number): React.ReactNode => {
    const dirEntries = entries.get(dirPath);
    if (!dirEntries) return null;

    const filtered = filterLower
      ? dirEntries.filter(e => {
          if (e.type === 'directory') return true; // always show dirs (may have matching children)
          return matchesFilter(e);
        })
      : dirEntries;

    // Sort: directories first, then files, both alphabetical
    const sorted = [...filtered].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map(entry => {
      const isDir = entry.type === 'directory';
      const isExpanded = expandedDirs.has(entry.path);
      const isLoading = loading.has(entry.path);
      const isTooLarge = !isDir && entry.size != null && entry.size > ONE_MB;
      const isSelected = selectedFile === entry.path;

      if (isDir) {
        return (
          <div key={entry.path}>
            <div
              style={{ paddingLeft: `${level * 16 + 4}px` }}
              className="flex items-center gap-1 px-2 py-1 cursor-pointer rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => toggleDir(entry.path)}
            >
              <span className="flex-shrink-0">
                <ChevronIcon isOpen={isExpanded} />
              </span>
              <span className="flex-shrink-0 text-gray-500 dark:text-gray-400">
                <FolderIcon />
              </span>
              <span className="text-sm truncate text-gray-900 dark:text-gray-100">
                {entry.name}
              </span>
            </div>
            {isExpanded && (
              <div>
                {isLoading ? (
                  <div style={{ paddingLeft: `${(level + 1) * 16 + 4}px` }} className="flex items-center gap-2 px-2 py-1">
                    <SpinnerIcon />
                    <span className="text-xs text-gray-400">Loading...</span>
                  </div>
                ) : (
                  renderEntries(entry.path, level + 1)
                )}
              </div>
            )}
          </div>
        );
      }

      // File entry
      return (
        <div
          key={entry.path}
          style={{ paddingLeft: `${level * 16 + 4}px` }}
          className={`flex items-center gap-1 px-2 py-1 rounded ${
            isTooLarge
              ? 'opacity-50 cursor-not-allowed'
              : isSelected
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 cursor-pointer'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
          }`}
          onClick={() => {
            if (!isTooLarge) setSelectedFile(entry.path);
          }}
        >
          <div className="w-4 flex-shrink-0" />
          <span className={`flex-shrink-0 ${isTooLarge ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'}`}>
            <FileIcon />
          </span>
          <span className={`text-sm truncate ${isTooLarge ? 'text-gray-400 dark:text-gray-600' : 'text-gray-900 dark:text-gray-100'}`}>
            {entry.name}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto flex-shrink-0">
            {isTooLarge ? '(Too large)' : formatSize(entry.size)}
          </span>
        </div>
      );
    });
  }, [entries, expandedDirs, loading, selectedFile, filterLower, matchesFilter, toggleDir]);

  if (!open) return null;

  const rootEntries = entries.get('');
  const isRootLoading = loading.has('');

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Link Code File</h3>
        </div>

        {/* Filter */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setFilter(''); } }}
            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* File list */}
        <div className="max-h-96 overflow-y-auto px-2 py-2">
          {isRootLoading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <SpinnerIcon />
              <span className="text-sm text-gray-400">Loading files...</span>
            </div>
          ) : rootEntries && rootEntries.length > 0 ? (
            renderEntries('', 0)
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No files found</p>
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
          <button
            onClick={handleLink}
            disabled={!selectedFile}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              selectedFile
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
            }`}
          >
            Link
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileBrowserDialog;
