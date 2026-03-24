/**
 * SnippetEditor Component
 *
 * Full-width code snippet editor with:
 * - CodeMirror for code editing with syntax highlighting
 * - Toolbar with language dropdown, diff toggle, copy button
 * - Diff view to compare original vs current code
 * - Line highlighting support (background highlight on highlighted lines)
 * - Language auto-detection with manual override
 * - Snippet saving and change tracking
 * - Keyboard shortcuts (Ctrl+S to save)
 * - Loading and error states
 */

import React, { useState, useCallback, useEffect } from 'react';
import { CodeMirrorWrapper } from './CodeMirrorWrapper';
import { useSnippet } from '@/hooks/useSnippet';
import { Snippet } from '@/types';
import type { Language } from './CodeMirrorWrapper';

/**
 * Props for the SnippetEditor component
 */
export interface SnippetEditorProps {
  /** Snippet ID to edit (uses selectedSnippet if not provided) */
  snippetId?: string;
  /** Callback when snippet is saved */
  onSave?: (snippet: Snippet) => void;
  /** Callback when snippet changes */
  onChange?: (content: string) => void;
  /** Whether to show action buttons */
  showButtons?: boolean;
  /** Custom CSS class name for the container */
  className?: string;
  /** Lines to highlight (1-indexed array of line numbers) */
  highlightLines?: number[];
  /** Whether to show diff view by default */
  showDiffByDefault?: boolean;
}

/**
 * Language detection from file extension or content
 */
const detectLanguage = (fileName: string, content?: string): Language => {
  if (!fileName) return 'text';

  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const langMap: Record<string, Language> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'c': 'cpp',
    'h': 'cpp',
    'hpp': 'cpp',
    'cs': 'csharp',
    'css': 'css',
    'md': 'markdown',
    'markdown': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml',
    'html': 'html',
    'htm': 'html',
    'json': 'json',
  };

  return langMap[ext] || 'text';
};

/**
 * SnippetEditor Component
 *
 * Provides a full-featured code snippet editor with:
 * - Full-width CodeMirror editor
 * - Toolbar for language selection and view toggling
 * - Diff view support
 * - Line highlighting
 * - Snippet save/cancel functionality
 */
export const SnippetEditor: React.FC<SnippetEditorProps> = ({
  snippetId,
  onSave,
  onChange,
  showButtons = true,
  className = '',
  highlightLines = [],
  showDiffByDefault = false,
}) => {
  const { selectedSnippet, updateSnippet, getSnippetById } = useSnippet();

  // Determine which snippet to use — must not call hook conditionally
  const snippet = snippetId ? getSnippetById(snippetId) : selectedSnippet;

  // Local state for editor
  const [content, setContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<Language>('text');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('text');
  const [showDiff, setShowDiff] = useState(showDiffByDefault);
  const [originalCode, setOriginalCode] = useState<string>('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parsedHighlightLines, setParsedHighlightLines] = useState<number[]>([]);

  // Parse snippet JSON content → { language, code, filePath, highlightLines, originalCode }
  // Falls back gracefully if content is a plain string (not JSON)
  const parseSnippetData = useCallback((rawContent: string) => {
    try {
      const data = JSON.parse(rawContent);
      return {
        code: typeof data.code === 'string' ? data.code : rawContent,
        language: typeof data.language === 'string' ? data.language : null,
        filePath: typeof data.filePath === 'string' ? data.filePath : null,
        originalCode: typeof data.originalCode === 'string' ? data.originalCode : null,
        highlightLines: Array.isArray(data.highlightLines) ? data.highlightLines : [],
      };
    } catch {
      return { code: rawContent, language: null, filePath: null, originalCode: null, highlightLines: [] };
    }
  }, []);

  // Serialize code changes back into the JSON content envelope
  const serializeSnippetData = useCallback((newCode: string, rawContent: string): string => {
    try {
      const data = JSON.parse(rawContent);
      return JSON.stringify({ ...data, code: newCode });
    } catch {
      return newCode;
    }
  }, []);

  // Initialize language and code from parsed JSON content
  useEffect(() => {
    if (snippet) {
      const parsed = parseSnippetData(snippet.content ?? '');
      const detected = parsed.language as Language
        || (parsed.filePath ? detectLanguage(parsed.filePath) : detectLanguage(snippet.name));
      setDetectedLanguage(detected);
      setSelectedLanguage(detected);
      setContent(parsed.code);
      setOriginalCode(parsed.originalCode ?? parsed.code);
      setFilePath(parsed.filePath);
      setParsedHighlightLines(parsed.highlightLines);
    }
  }, [snippet, parseSnippetData]);

  // Handle content change
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (onChange) {
        onChange(newContent);
      }
    },
    [onChange]
  );

  // Handle language change
  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedLanguage(e.target.value as Language);
    },
    []
  );

  // Handle diff toggle
  const handleDiffToggle = useCallback(() => {
    setShowDiff(!showDiff);
  }, [showDiff]);

  // Handle copy to clipboard
  const handleCopy = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    navigator.clipboard.writeText(content).then(() => {
      // Visual feedback: button flash
      const originalText = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }, [content]);

  // Handle save — serialize code back into JSON content envelope
  const handleSave = useCallback(async () => {
    if (!snippet) return;

    setIsSaving(true);
    try {
      const serialized = serializeSnippetData(content, snippet.content ?? '');
      await updateSnippet(snippet.id, serialized);
      setOriginalCode(content);
      if (onSave) {
        onSave({ ...snippet, content: serialized, lastModified: Date.now() });
      }
    } catch (error) {
      console.error('Failed to save snippet:', error);
    } finally {
      setIsSaving(false);
    }
  }, [snippet, content, updateSnippet, onSave, serializeSnippetData]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setContent(originalCode);
    setShowDiff(false);
  }, [originalCode]);

  // Keyboard shortcut for save (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Determine if content has changed
  const hasChanges = content !== originalCode;

  // Merge prop highlightLines with parsed ones from JSON content
  const effectiveHighlightLines = highlightLines.length > 0 ? highlightLines : parsedHighlightLines;

  if (!snippet) {
    return <div className={`p-4 text-gray-500 ${className}`}>No snippet selected</div>;
  }

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}>
      {/* Toolbar */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 flex items-center gap-2 flex-wrap">
        {/* Language Dropdown */}
        <select
          value={selectedLanguage}
          onChange={handleLanguageChange}
          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm font-medium"
          title="Select code language"
        >
          <option value="text">Plain Text</option>
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="csharp">C#</option>
          <option value="cpp">C/C++</option>
          <option value="css">CSS</option>
          <option value="html">HTML</option>
          <option value="json">JSON</option>
          <option value="markdown">Markdown</option>
          <option value="yaml">YAML</option>
        </select>

        {/* File Path Badge */}
        {filePath && (
          <span className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-[200px]" title={filePath}>
            {filePath}
          </span>
        )}

        {/* Diff Toggle Button */}
        <button
          onClick={handleDiffToggle}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            showDiff
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
          title="Toggle diff view"
        >
          Diff
        </button>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className="px-3 py-1 rounded text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          title="Copy code to clipboard"
        >
          Copy
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action Buttons */}
        {showButtons && (
          <div className="flex gap-2">
            {hasChanges && (
              <button
                onClick={handleCancel}
                className="px-3 py-1 rounded text-sm font-medium bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            )}
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1 rounded text-sm font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Diff View or Editor */}
      {showDiff ? (
        <div className="flex-1 overflow-hidden flex gap-4 p-4 bg-gray-50 dark:bg-gray-900">
          {/* Original Code */}
          <div className="flex-1 flex flex-col min-w-0 border border-gray-200 dark:border-gray-700 rounded">
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
              Original
            </div>
            <CodeMirrorWrapper
              value={originalCode}
              onChange={() => {}}
              language={selectedLanguage}
              readOnly={true}
              height="100%"
              className="flex-1"
            />
          </div>

          {/* Current Code */}
          <div className="flex-1 flex flex-col min-w-0 border border-gray-200 dark:border-gray-700 rounded">
            <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
              Current
            </div>
            <CodeMirrorWrapper
              value={content}
              onChange={handleContentChange}
              language={selectedLanguage}
              height="100%"
              className="flex-1"
            />
          </div>
        </div>
      ) : (
        /* Full Editor */
        <div className="flex-1 overflow-hidden p-4 bg-gray-50 dark:bg-gray-900">
          <CodeMirrorWrapper
            value={content}
            onChange={handleContentChange}
            language={selectedLanguage}
            height="100%"
            placeholder="Paste your code here..."
            highlightLines={effectiveHighlightLines}
          />
        </div>
      )}

      {/* Status Bar */}
      {showButtons && (
        <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 flex justify-between">
          <div>
            {hasChanges ? (
              <span className="text-orange-600 dark:text-orange-400 font-medium">Unsaved changes</span>
            ) : (
              <span>All changes saved</span>
            )}
          </div>
          <div>
            {content.split('\n').length} lines • {content.length} characters
          </div>
        </div>
      )}
    </div>
  );
};

export default SnippetEditor;
