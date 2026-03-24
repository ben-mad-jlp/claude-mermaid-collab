/**
 * CodeMirrorWrapper Component
 *
 * A React wrapper around CodeMirror 6 that provides:
 * - Code editing capabilities with language-specific syntax highlighting
 * - Editor state management and change handling
 * - Undo/redo functionality (built-in to CodeMirror)
 * - Responsive design with theme support (light/dark modes)
 * - Support for multiple programming languages (JavaScript, Markdown, YAML, HTML, JSON)
 */

import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// Language support imports
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { StreamLanguage } from '@codemirror/language';
import { csharp } from '@codemirror/legacy-modes/mode/clike';

import { useTheme } from '@/hooks/useTheme';

/**
 * Supported language types for syntax highlighting
 */
export type Language = 'javascript' | 'typescript' | 'markdown' | 'yaml' | 'html' | 'json' | 'python' | 'cpp' | 'csharp' | 'css' | 'text';

/**
 * Props for the CodeMirrorWrapper component
 */
export interface CodeMirrorWrapperProps {
  /** Initial code content to display */
  value: string;
  /** Callback fired when code changes */
  onChange: (value: string) => void;
  /** Programming language for syntax highlighting */
  language?: Language;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Custom CSS class name for the wrapper container */
  className?: string;
  /** Whether to show line numbers */
  showLineNumbers?: boolean;
  /** Custom height for the editor (CSS value) */
  height?: string;
  /** Optional placeholder text when editor is empty */
  placeholder?: string;
  /** Whether to enable word wrapping */
  wordWrap?: boolean;
  /** Callback fired when CodeMirror editor is ready with EditorView instance */
  onEditorReady?: (view: EditorView | null) => void;
  /** Lines to highlight with a subtle background (1-indexed) */
  highlightLines?: number[];
}

/**
 * Map of language type to CodeMirror language extension
 */
const getLanguageExtension = (language: Language) => {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'markdown':
      return markdown();
    case 'yaml':
      return yaml();
    case 'html':
      return html();
    case 'json':
      return json();
    case 'python':
      return python();
    case 'cpp':
      return cpp();
    case 'csharp':
      return StreamLanguage.define(csharp);
    case 'css':
      return css();
    case 'text':
    default:
      return [];
  }
};

const highlightLineDecoration = Decoration.line({ class: 'cm-highlighted-line' });

const highlightLinesThemeLight = EditorView.baseTheme({
  '.cm-highlighted-line': {
    backgroundColor: 'rgba(254, 249, 195, 0.5)',
  },
});

const highlightLinesThemeDark = EditorView.baseTheme({
  '&dark .cm-highlighted-line': {
    backgroundColor: 'rgba(113, 63, 18, 0.3)',
  },
});

function buildHighlightExtension(lines: number[]) {
  if (!lines.length) return [];
  const lineSet = new Set(lines);
  return [
    highlightLinesThemeLight,
    highlightLinesThemeDark,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }
        buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          for (let i = 1; i <= view.state.doc.lines; i++) {
            if (lineSet.has(i)) {
              const line = view.state.doc.line(i);
              builder.add(line.from, line.from, highlightLineDecoration);
            }
          }
          return builder.finish();
        }
      },
      { decorations: (v) => v.decorations }
    ),
  ];
}

/**
 * CodeMirrorWrapper Component
 *
 * Provides a user-friendly React interface to CodeMirror 6 with:
 * - Automatic syntax highlighting based on language prop
 * - Theme switching (light/dark modes)
 * - Responsive sizing and word wrapping options
 * - Read-only mode support
 * - Customizable appearance
 *
 * @example
 * ```tsx
 * function MyEditor() {
 *   const [code, setCode] = useState('const x = 42;');
 *
 *   return (
 *     <CodeMirrorWrapper
 *       value={code}
 *       onChange={setCode}
 *       language="javascript"
 *       height="500px"
 *     />
 *   );
 * }
 * ```
 */
export const CodeMirrorWrapper: React.FC<CodeMirrorWrapperProps> = ({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  className = '',
  showLineNumbers = true,
  height = '400px',
  placeholder = '',
  wordWrap = true,
  onEditorReady,
  highlightLines = [],
}) => {
  const { theme } = useTheme();
  const [isLoaded, setIsLoaded] = useState(false);
  const codeMirrorRef = useRef<any>(null);

  // Ensure component is loaded before rendering to avoid hydration mismatches
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  // Call onEditorReady callback when CodeMirror editor is mounted
  useEffect(() => {
    if (!isLoaded || !codeMirrorRef.current) {
      return;
    }

    const view = codeMirrorRef.current.view;
    if (view && onEditorReady) {
      onEditorReady(view);
    }

    // Cleanup: notify parent that editor is unmounting
    return () => {
      if (onEditorReady) {
        onEditorReady(null);
      }
    };
  }, [isLoaded, onEditorReady]);

  // Memoize the language extension to avoid unnecessary re-renders
  const languageExtension = useMemo(() => {
    return getLanguageExtension(language);
  }, [language]);

  // Memoize the theme classes based on current theme
  const themeClasses = useMemo(() => {
    return theme === 'dark'
      ? 'cm-theme-dark dark:bg-gray-800 dark:text-gray-100'
      : 'cm-theme-light bg-white text-gray-900';
  }, [theme]);

  // Memoize highlight extension
  const highlightExtension = useMemo(() => {
    return buildHighlightExtension(highlightLines);
  }, [highlightLines]);

  // Memoize the editor extensions to prevent unnecessary re-initialization
  const extensions = useMemo(() => {
    return [languageExtension, ...highlightExtension];
  }, [languageExtension, highlightExtension]);

  // Memoize onChange callback to prevent unnecessary re-renders
  const handleChange = useCallback(
    (value: string) => {
      onChange(value);
    },
    [onChange]
  );

  // Use explicit height if provided, otherwise fill container
  const containerStyle = height === '100%' ? { height: '100%' } : { height };

  // Don't render until component is loaded (hydration safety)
  if (!isLoaded) {
    return (
      <div
        className={`border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 ${className}`}
        style={containerStyle}
        data-testid="editor-loading"
      />
    );
  }

  return (
    <div
      className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col ${className}`}
      style={containerStyle}
      data-testid="editor-wrapper"
    >
      <CodeMirror
        ref={codeMirrorRef}
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme={theme === 'dark' ? 'dark' : 'light'}
        height="100%"
        placeholder={placeholder}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: showLineNumbers,
          highlightActiveLineGutter: !readOnly,
          foldGutter: true,
          dropCursor: !readOnly,
          allowMultipleSelections: true,
          indentOnInput: !readOnly,
          bracketMatching: true,
          closeBrackets: !readOnly,
          autocompletion: !readOnly,
          rectangularSelection: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
        className={`${themeClasses} w-full flex-1 min-h-0`}
        data-testid="codemirror-editor"
      />
    </div>
  );
};

export default CodeMirrorWrapper;
