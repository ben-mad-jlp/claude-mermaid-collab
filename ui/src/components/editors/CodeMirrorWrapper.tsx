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
import { EditorView, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect } from '@codemirror/state';
import type { SnippetAnnotation } from '@/types/snippet';

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
  /** Annotations to render as gutter markers + left border */
  annotations?: SnippetAnnotation[];
  /** Called when an annotation gutter marker is clicked */
  onAnnotationClick?: (annotation: SnippetAnnotation) => void;
  /** Called when the editor selection changes; null when selection is cleared */
  onSelectionChange?: (selection: { startLine: number; endLine: number } | null) => void;
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

// ─── Annotation extension (inline comment blocks) ───────────────────────────

const annotationTheme = EditorView.baseTheme({
  '.cm-annotation-widget': {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    padding: '4px 8px 4px 12px',
    margin: '2px 0',
    borderLeft: '3px solid #f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
    fontSize: '12px',
    lineHeight: '1.4',
    color: '#92400e',
    cursor: 'pointer',
    borderRadius: '0 4px 4px 0',
  },
  '&dark .cm-annotation-widget': {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    color: '#fbbf24',
  },
  '.cm-annotation-widget:hover': {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  '&dark .cm-annotation-widget:hover': {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
  },
  '.cm-annotation-icon': {
    flexShrink: '0',
    fontSize: '13px',
    lineHeight: '1.4',
  },
  '.cm-annotation-text': {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '.cm-annotation-lines': {
    flexShrink: '0',
    fontSize: '10px',
    opacity: '0.6',
    marginLeft: 'auto',
    paddingLeft: '8px',
  },
});

class AnnotationWidget extends WidgetType {
  constructor(
    private ann: SnippetAnnotation,
    private onClick: (ann: SnippetAnnotation) => void,
  ) { super(); }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-annotation-widget';
    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClick(this.ann);
    });

    const icon = document.createElement('span');
    icon.className = 'cm-annotation-icon';
    icon.textContent = '💬';
    wrap.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'cm-annotation-text';
    text.textContent = this.ann.text;
    wrap.appendChild(text);

    const lines = document.createElement('span');
    lines.className = 'cm-annotation-lines';
    lines.textContent = this.ann.startLine === this.ann.endLine
      ? `L${this.ann.startLine}`
      : `L${this.ann.startLine}–${this.ann.endLine}`;
    wrap.appendChild(lines);

    return wrap;
  }

  eq(other: WidgetType): boolean {
    return other instanceof AnnotationWidget
      && other.ann.startLine === this.ann.startLine
      && other.ann.endLine === this.ann.endLine
      && other.ann.text === this.ann.text;
  }

  get estimatedHeight() { return 28; }
}

function buildAnnotationExtension(
  annotations: SnippetAnnotation[],
  onAnnotationClick: (ann: SnippetAnnotation) => void,
) {
  if (!annotations.length) return [];

  const sorted = [...annotations].sort((a, b) => a.startLine - b.startLine);

  const annotationField = StateField.define<DecorationSet>({
    create(state) {
      const builder = new RangeSetBuilder<Decoration>();
      for (const ann of sorted) {
        if (ann.startLine >= 1 && ann.startLine <= state.doc.lines) {
          const line = state.doc.line(ann.startLine);
          builder.add(line.from, line.from, Decoration.widget({
            widget: new AnnotationWidget(ann, onAnnotationClick),
            block: true,
            side: -1,
          }));
        }
      }
      return builder.finish();
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const ann of sorted) {
          if (ann.startLine >= 1 && ann.startLine <= tr.state.doc.lines) {
            const line = tr.state.doc.line(ann.startLine);
            builder.add(line.from, line.from, Decoration.widget({
              widget: new AnnotationWidget(ann, onAnnotationClick),
              block: true,
              side: -1,
            }));
          }
        }
        return builder.finish();
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [annotationTheme, annotationField];
}

// ─── Selection listener extension ────────────────────────────────────────────

function buildSelectionListenerExtension(
  onSelectionChange: (sel: { startLine: number; endLine: number } | null) => void,
) {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (!update.selectionSet) return;
      const sel = update.state.selection.main;
      if (sel.empty) {
        onSelectionChange(null);
        return;
      }
      const startLine = update.state.doc.lineAt(sel.from).number;
      // sel.to may land at the very start of the next line; step back one char to get the actual end line
      const toPos = sel.to > sel.from && sel.to === update.state.doc.lineAt(sel.to).from
        ? sel.to - 1
        : sel.to;
      const endLine = update.state.doc.lineAt(toPos).number;
      onSelectionChange({ startLine, endLine });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

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
  annotations = [],
  onAnnotationClick,
  onSelectionChange,
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

  // Memoize annotation extension
  const annotationExtension = useMemo(() => {
    return buildAnnotationExtension(annotations, onAnnotationClick ?? (() => {}));
  }, [annotations, onAnnotationClick]);

  // Memoize selection listener extension
  const selectionListenerExtension = useMemo(() => {
    if (!onSelectionChange) return [];
    return [buildSelectionListenerExtension(onSelectionChange)];
  }, [onSelectionChange]);

  // Memoize the editor extensions to prevent unnecessary re-initialization
  const extensions = useMemo(() => {
    return [languageExtension, ...highlightExtension, ...annotationExtension, ...selectionListenerExtension];
  }, [languageExtension, highlightExtension, annotationExtension, selectionListenerExtension]);

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
