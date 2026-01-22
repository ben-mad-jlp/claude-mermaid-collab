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

import React, { useMemo, useCallback, useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';

// Language support imports
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';

import { useTheme } from '@/hooks/useTheme';

/**
 * Supported language types for syntax highlighting
 */
export type Language = 'javascript' | 'markdown' | 'yaml' | 'html' | 'json' | 'text';

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
}

/**
 * Map of language type to CodeMirror language extension
 */
const getLanguageExtension = (language: Language) => {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'markdown':
      return markdown();
    case 'yaml':
      return yaml();
    case 'html':
      return html();
    case 'json':
      return json();
    case 'text':
    default:
      return [];
  }
};

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
}) => {
  const { theme } = useTheme();
  const [isLoaded, setIsLoaded] = useState(false);

  // Ensure component is loaded before rendering to avoid hydration mismatches
  useEffect(() => {
    setIsLoaded(true);
  }, []);

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

  // Memoize the editor extensions to prevent unnecessary re-initialization
  const extensions = useMemo(() => {
    const exts = [languageExtension];
    return exts;
  }, [languageExtension]);

  // Memoize onChange callback to prevent unnecessary re-renders
  const handleChange = useCallback(
    (value: string) => {
      onChange(value);
    },
    [onChange]
  );

  // Don't render until component is loaded (hydration safety)
  if (!isLoaded) {
    return (
      <div
        className={`border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800 ${className}`}
        style={{ height }}
        data-testid="editor-loading"
      />
    );
  }

  return (
    <div
      className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden ${className}`}
      data-testid="editor-wrapper"
    >
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme={theme === 'dark' ? 'dark' : 'light'}
        height={height}
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
        className={`${themeClasses} w-full`}
        data-testid="codemirror-editor"
      />
    </div>
  );
};

export default CodeMirrorWrapper;
