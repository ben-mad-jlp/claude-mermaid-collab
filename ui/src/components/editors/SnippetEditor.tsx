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

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { CodeMirrorWrapper } from './CodeMirrorWrapper';
import { SplitPane } from '@/components/layout/SplitPane';
import { useSnippet } from '@/hooks/useSnippet';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { Snippet, SnippetAnnotation } from '@/types';
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
  /** Callback to provide inline toolbar controls to the parent (rendered in EditorToolbar header) */
  onToolbarControls?: (controls: React.ReactNode) => void;
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
  onToolbarControls,
}) => {
  const { selectedSnippet, updateSnippet, getSnippetById } = useSnippet();

  // Determine which snippet to use — must not call hook conditionally
  const snippet = snippetId ? getSnippetById(snippetId) : selectedSnippet;

  const currentSession = useSessionStore((state) => state.currentSession);

  // Local state for editor
  const [content, setContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<Language>('text');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('text');
  const [showDiff, setShowDiff] = useState(showDiffByDefault);
  const [originalCode, setOriginalCode] = useState<string>('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [parsedHighlightLines, setParsedHighlightLines] = useState<number[]>([]);
  const [annotations, setAnnotations] = useState<SnippetAnnotation[]>([]);
  const [currentSelection, setCurrentSelection] = useState<{ startLine: number; endLine: number } | null>(null);
  const [annotationPopover, setAnnotationPopover] = useState<{
    mode: 'add' | 'edit';
    startLine: number;
    endLine: number;
    text: string;
    index: number; // -1 for new
  } | null>(null);
  const annotationTextRef = useRef<HTMLTextAreaElement>(null);

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
        annotations: Array.isArray(data.annotations) ? data.annotations as SnippetAnnotation[] : [],
      };
    } catch {
      return { code: rawContent, language: null, filePath: null, originalCode: null, highlightLines: [], annotations: [] };
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
      setAnnotations(parsed.annotations);
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

  // Handle apply — save first, then write to disk via API
  const handleApply = useCallback(async () => {
    if (!snippet || !currentSession || !filePath) return;

    setIsApplying(true);
    setApplyStatus(null);
    try {
      // Save first to persist any edits
      const serialized = serializeSnippetData(content, snippet.content ?? '');
      await updateSnippet(snippet.id, serialized);
      setOriginalCode(content);

      // Apply to disk
      const result = await api.applySnippet(currentSession.project, currentSession.name, snippet.id);
      setApplyStatus(`Applied to ${result.filePath} (${result.linesWritten} lines)`);
      setTimeout(() => setApplyStatus(null), 3000);
    } catch (error) {
      console.error('Failed to apply snippet:', error);
      setApplyStatus('Apply failed');
      setTimeout(() => setApplyStatus(null), 3000);
    } finally {
      setIsApplying(false);
    }
  }, [snippet, currentSession, filePath, content, updateSnippet, serializeSnippetData]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setContent(originalCode);
    setShowDiff(false);
  }, [originalCode]);

  // ─── Annotation handlers ────────────────────────────────────────────────────

  const saveAnnotations = useCallback(async (newAnnotations: SnippetAnnotation[]) => {
    if (!snippet) return;
    setAnnotations(newAnnotations);
    try {
      const data = JSON.parse(snippet.content ?? '{}');
      await updateSnippet(snippet.id, JSON.stringify({ ...data, annotations: newAnnotations }));
    } catch {
      // not JSON — annotations can't be persisted in plain-text snippets
    }
  }, [snippet, updateSnippet]);

  const handleAnnotationClick = useCallback((ann: SnippetAnnotation) => {
    const index = annotations.findIndex(
      (a) => a.startLine === ann.startLine && a.endLine === ann.endLine && a.text === ann.text
    );
    setAnnotationPopover({ mode: 'edit', startLine: ann.startLine, endLine: ann.endLine, text: ann.text, index });
  }, [annotations]);

  const handleOpenAddAnnotation = useCallback(() => {
    if (!currentSelection) return;
    setAnnotationPopover({
      mode: 'add',
      startLine: currentSelection.startLine,
      endLine: currentSelection.endLine,
      text: '',
      index: -1,
    });
  }, [currentSelection]);

  const handleAnnotationSave = useCallback(async () => {
    if (!annotationPopover || !annotationPopover.text.trim()) return;
    const newAnn: SnippetAnnotation = {
      startLine: annotationPopover.startLine,
      endLine: annotationPopover.endLine,
      text: annotationPopover.text.trim(),
    };
    const updated = [...annotations];
    if (annotationPopover.index === -1) {
      updated.push(newAnn);
    } else {
      updated[annotationPopover.index] = newAnn;
    }
    await saveAnnotations(updated);
    setAnnotationPopover(null);
    setCurrentSelection(null);
  }, [annotationPopover, annotations, saveAnnotations]);

  const handleAnnotationDelete = useCallback(async () => {
    if (!annotationPopover || annotationPopover.index === -1) return;
    await saveAnnotations(annotations.filter((_, i) => i !== annotationPopover.index));
    setAnnotationPopover(null);
  }, [annotationPopover, annotations, saveAnnotations]);

  // Inline annotation save/delete (called from CodeMirror widget, no popover)
  const handleInlineAnnotationSave = useCallback(async (original: SnippetAnnotation, newText: string) => {
    const index = annotations.findIndex(
      (a) => a.startLine === original.startLine && a.endLine === original.endLine && a.text === original.text
    );
    if (index === -1) return;
    const updated = [...annotations];
    updated[index] = { ...original, text: newText };
    await saveAnnotations(updated);
  }, [annotations, saveAnnotations]);

  const handleInlineAnnotationDelete = useCallback(async (ann: SnippetAnnotation) => {
    await saveAnnotations(annotations.filter(
      (a) => !(a.startLine === ann.startLine && a.endLine === ann.endLine && a.text === ann.text)
    ));
  }, [annotations, saveAnnotations]);

  const handleClearAnnotations = useCallback(async () => {
    if (annotations.length > 0) await saveAnnotations([]);
  }, [annotations, saveAnnotations]);

  // ────────────────────────────────────────────────────────────────────────────

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

  // Build toolbar controls as a memoized fragment to avoid infinite effect loops
  const toolbarControls = useMemo(() => (
    <>
      {annotations.length > 0 && (
        <button
          onClick={handleClearAnnotations}
          className="px-2 py-0.5 rounded text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title="Clear all comments"
        >
          Clear Comments
        </button>
      )}
      {currentSelection && !annotationPopover && (
        <button
          onClick={handleOpenAddAnnotation}
          className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          title={`Add comment to lines ${currentSelection.startLine}–${currentSelection.endLine}`}
        >
          💬 Comment
        </button>
      )}
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
      <select
        value={selectedLanguage}
        onChange={handleLanguageChange}
        className="px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-xs font-medium"
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
      <button
        onClick={handleDiffToggle}
        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
          showDiff
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
        }`}
        title="Toggle diff view"
      >
        Diff
      </button>
      <button
        onClick={handleCopy}
        className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        title="Copy code to clipboard"
      >
        Copy
      </button>
      {filePath && (
        <button
          onClick={handleApply}
          disabled={isApplying}
          className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
          title={`Apply to ${filePath}`}
        >
          {isApplying ? 'Applying...' : 'Apply to File'}
        </button>
      )}
      {showButtons && hasChanges && (
        <>
          <button
            onClick={handleCancel}
            className="px-2 py-0.5 rounded text-xs font-medium bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-2 py-0.5 rounded text-xs font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
      {applyStatus && (
        <span className="text-xs text-green-600 dark:text-green-400">{applyStatus}</span>
      )}
      {filePath && (
        <span className="flex-1 text-right text-xs text-gray-400 dark:text-gray-500 font-mono truncate min-w-0" title={filePath}>
          {filePath}
        </span>
      )}
    </>
  ), [
    selectedLanguage, handleLanguageChange, showDiff, handleDiffToggle, handleCopy,
    filePath, handleApply, isApplying, showButtons, hasChanges, handleCancel,
    handleSave, isSaving, applyStatus, currentSelection, annotationPopover, handleOpenAddAnnotation,
    annotations, handleClearAnnotations,
  ]);

  // Push controls to parent if callback provided
  useEffect(() => {
    if (onToolbarControls) {
      onToolbarControls(toolbarControls);
    }
  }, [onToolbarControls, toolbarControls]);

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}>
      {/* Only render toolbar row if NOT pushed to parent */}
      {!onToolbarControls && (
        <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 flex items-center gap-1.5">
          {toolbarControls}
          {filePath && (
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 font-mono truncate" title={filePath}>
              {filePath}
            </span>
          )}
        </div>
      )}

      {/* Diff View or Editor */}
      {showDiff ? (
        <div className="flex-1 overflow-hidden">
          <SplitPane
            direction="horizontal"
            defaultPrimarySize={50}
            minPrimarySize={20}
            minSecondarySize={20}
            storageId="snippet-diff-split"
            primaryContent={
              <div className="flex flex-col h-full">
                <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Current
                </div>
                <div className="flex-1 min-h-0">
                  <CodeMirrorWrapper
                    value={content}
                    onChange={handleContentChange}
                    language={selectedLanguage}
                    height="100%"
                  />
                </div>
              </div>
            }
            secondaryContent={
              <div className="flex flex-col h-full">
                <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Original
                </div>
                <div className="flex-1 min-h-0">
                  <CodeMirrorWrapper
                    value={originalCode}
                    onChange={() => {}}
                    language={selectedLanguage}
                    readOnly={true}
                    height="100%"
                  />
                </div>
              </div>
            }
          />
        </div>
      ) : (
        /* Full Editor */
        <div className="relative flex-1 overflow-hidden p-4 bg-gray-50 dark:bg-gray-900">
          <CodeMirrorWrapper
            value={content}
            onChange={handleContentChange}
            language={selectedLanguage}
            height="100%"
            placeholder="Paste your code here..."
            highlightLines={effectiveHighlightLines}
            annotations={annotations}
            onAnnotationSave={handleInlineAnnotationSave}
            onAnnotationDelete={handleInlineAnnotationDelete}
            onSelectionChange={setCurrentSelection}
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
