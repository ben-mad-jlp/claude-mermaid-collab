/**
 * CodeArtifactKebabMenu Component
 *
 * Dropdown menu for linked code artifacts, rendered in the CodeEditor toolbar.
 * Provides: Copy Import Path, Show Impact (stub), Deprecate, Unlink.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface CodeArtifactKebabMenuProps {
  snippetId: string;
  filePath: string;
  projectPath: string;
  sessionName: string;
  onDeprecate: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export const CodeArtifactKebabMenu: React.FC<CodeArtifactKebabMenuProps> = ({
  snippetId: _snippetId,
  filePath,
  projectPath: _projectPath,
  sessionName: _sessionName,
  onDeprecate,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-clear flash message after 2s
  useEffect(() => {
    if (!flashMessage) return;
    const timer = setTimeout(() => setFlashMessage(null), 2000);
    return () => clearTimeout(timer);
  }, [flashMessage]);

  // Close menu on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close menu on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setFlashMessage('Copied');
    } catch (err) {
      console.error('Copy failed:', err);
      setFlashMessage('Copy failed');
    }
    setIsOpen(false);
  }, [filePath]);

  const handleShowImpact = useCallback(() => {
    setFlashMessage('No pseudo index for this file');
    setIsOpen(false);
  }, []);

  const handleDeprecate = useCallback(async () => {
    setIsOpen(false);
    try {
      await onDeprecate();
    } catch (err) {
      console.error('Deprecate failed:', err);
      setFlashMessage('Deprecate failed');
    }
  }, [onDeprecate]);

  const handleUnlink = useCallback(async () => {
    setIsOpen(false);
    const confirmed = window.confirm(
      `Unlink ${filePath}? This removes it from the session but does not delete the file on disk.`
    );
    if (!confirmed) return;
    try {
      await onDelete();
    } catch (err) {
      console.error('Unlink failed:', err);
      setFlashMessage('Unlink failed');
    }
  }, [filePath, onDelete]);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      {flashMessage && (
        <span className="mr-2 text-xs text-blue-600 dark:text-blue-400 font-medium">
          {flashMessage}
        </span>
      )}

      <button
        data-testid="code-artifact-kebab-button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="More actions"
        title="More actions"
        className="p-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {isOpen && (
        <div
          data-testid="code-artifact-kebab-menu"
          role="menu"
          className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden animate-fadeIn"
        >
          <ul className="py-1">
            <li>
              <button
                role="menuitem"
                data-testid="kebab-copy-path"
                onClick={handleCopyPath}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span>Copy Import Path</span>
              </button>
            </li>
            <li>
              <button
                role="menuitem"
                data-testid="kebab-show-impact"
                onClick={handleShowImpact}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span>Show Impact</span>
              </button>
            </li>
            <li>
              <button
                role="menuitem"
                data-testid="kebab-deprecate"
                onClick={handleDeprecate}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span>Deprecate</span>
              </button>
            </li>
            <li>
              <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
            </li>
            <li>
              <button
                role="menuitem"
                data-testid="kebab-unlink"
                onClick={handleUnlink}
                className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                <span>Unlink</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default CodeArtifactKebabMenu;
