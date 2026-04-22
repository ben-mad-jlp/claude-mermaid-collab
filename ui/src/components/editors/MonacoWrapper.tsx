import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { type OnMount, loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import type { SnippetAnnotation } from '@/types/snippet';
import { useTheme } from '@/hooks/useTheme';
import { applyAnnotations, clearAnnotations, type AnnotationCallbacks } from './MonacoAnnotations';
import { registerSymbolNav } from './MonacoSymbolNav';
import { useMonacoHistory } from '@/hooks/useMonacoHistory';

export type Language = 'javascript' | 'typescript' | 'markdown' | 'yaml' | 'html' | 'json' | 'python' | 'cpp' | 'csharp' | 'css' | 'text';

export interface MonacoWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language?: Language;
  readOnly?: boolean;
  className?: string;
  showLineNumbers?: boolean;
  height?: string;
  placeholder?: string;
  wordWrap?: boolean;
  onEditorReady?: (editor: Monaco.editor.IStandaloneCodeEditor | null) => void;
  highlightLines?: number[];
  annotations?: SnippetAnnotation[];
  onAnnotationClick?: (annotation: SnippetAnnotation) => void;
  onAnnotationSave?: (original: SnippetAnnotation, newText: string) => void;
  onAnnotationDelete?: (annotation: SnippetAnnotation) => void;
  onSelectionChange?: (selection: { startLine: number; endLine: number } | null) => void;
  onSymbolClick?: (symbol: string, rect: DOMRect) => void;
  onSymbolGoToDefinition?: (symbol: string, rect: DOMRect) => void;
}

function getMonacoLanguage(language: Language): string {
  switch (language) {
    case 'javascript': return 'javascript';
    case 'typescript': return 'typescript';
    case 'markdown': return 'markdown';
    case 'yaml': return 'yaml';
    case 'html': return 'html';
    case 'json': return 'json';
    case 'python': return 'python';
    case 'cpp': return 'cpp';
    case 'csharp': return 'csharp';
    case 'css': return 'css';
    case 'text':
    default: return 'plaintext';
  }
}

// Track whether custom themes and folding providers have been registered globally.
// Monaco registers themes and language providers globally, so we only do it once.
let _themesRegistered = false;
let _foldingRegistered = false;

async function ensureThemesRegistered(monacoInstance: typeof Monaco): Promise<void> {
  if (_themesRegistered) return;
  _themesRegistered = true;

  // Dynamically import theme data from monaco-themes to avoid bloating the initial bundle.
  // We load two themes: one for dark mode and one for light mode.
  try {
    const [githubDarkData, githubLightData] = await Promise.all([
      import('monaco-themes/themes/GitHub Dark.json'),
      import('monaco-themes/themes/GitHub.json'),
    ]);

    monacoInstance.editor.defineTheme('mc-dark', githubDarkData as Monaco.editor.IStandaloneThemeData);
    monacoInstance.editor.defineTheme('mc-light', githubLightData as Monaco.editor.IStandaloneThemeData);
  } catch {
    // Fallback: themes not available, use built-ins
  }
}

/** Register custom folding range providers for mermaid and markdown. */
function ensureFoldingRegistered(monacoInstance: typeof Monaco): void {
  if (_foldingRegistered) return;
  _foldingRegistered = true;

  // --- Mermaid folding: fold by diagram sections / subgraph blocks ---
  monacoInstance.languages.registerFoldingRangeProvider('plaintext', {
    provideFoldingRanges(model) {
      // Only apply mermaid folding when the content looks like a mermaid diagram
      const firstLine = model.getLineContent(1).trim().toLowerCase();
      const isMermaid = /^(graph|flowchart|sequencediagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitgraph|mindmap|timeline|sankey|xychart|block)\b/i.test(firstLine);
      if (!isMermaid) return [];

      const lineCount = model.getLineCount();
      const ranges: Monaco.languages.FoldingRange[] = [];
      const stack: number[] = [];

      for (let i = 1; i <= lineCount; i++) {
        const line = model.getLineContent(i).trim();
        if (/^subgraph\b/i.test(line)) {
          stack.push(i);
        } else if (/^end\s*$/i.test(line) && stack.length > 0) {
          const start = stack.pop()!;
          if (i > start + 1) {
            ranges.push({ start, end: i, kind: monacoInstance.languages.FoldingRangeKind.Region });
          }
        }
      }
      return ranges;
    },
  });

  // --- Markdown folding: fold by heading level ---
  monacoInstance.languages.registerFoldingRangeProvider('markdown', {
    provideFoldingRanges(model) {
      const lineCount = model.getLineCount();
      const ranges: Monaco.languages.FoldingRange[] = [];

      interface HeadingEntry { level: number; line: number }
      const headings: HeadingEntry[] = [];

      for (let i = 1; i <= lineCount; i++) {
        const line = model.getLineContent(i);
        const m = line.match(/^(#{1,6})\s/);
        if (m) {
          headings.push({ level: m[1].length, line: i });
        }
      }

      for (let i = 0; i < headings.length; i++) {
        const current = headings[i];
        // Find the next heading at same or higher level (lower number)
        let endLine = lineCount;
        for (let j = i + 1; j < headings.length; j++) {
          if (headings[j].level <= current.level) {
            endLine = headings[j].line - 1;
            break;
          }
        }
        // Skip trailing blank lines
        while (endLine > current.line && model.getLineContent(endLine).trim() === '') {
          endLine--;
        }
        if (endLine > current.line) {
          ranges.push({
            start: current.line,
            end: endLine,
            kind: monacoInstance.languages.FoldingRangeKind.Region,
          });
        }
      }

      return ranges;
    },
  });

  // --- YAML folding: fold by indentation blocks ---
  monacoInstance.languages.registerFoldingRangeProvider('yaml', {
    provideFoldingRanges(model) {
      const lineCount = model.getLineCount();
      const ranges: Monaco.languages.FoldingRange[] = [];

      interface IndentBlock { indent: number; start: number }
      const stack: IndentBlock[] = [];

      const getIndent = (line: string) => {
        let i = 0;
        while (i < line.length && line[i] === ' ') i++;
        return i;
      };

      for (let i = 1; i <= lineCount; i++) {
        const content = model.getLineContent(i);
        const trimmed = content.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = getIndent(content);

        // Pop entries that are at same or deeper indent — they ended
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          const entry = stack.pop()!;
          const end = i - 1;
          if (end > entry.start) {
            ranges.push({ start: entry.start, end, kind: monacoInstance.languages.FoldingRangeKind.Region });
          }
        }

        // If next non-empty line is deeper, this line starts a block
        let nextIndent = -1;
        for (let j = i + 1; j <= lineCount; j++) {
          const next = model.getLineContent(j).trim();
          if (next && !next.startsWith('#')) {
            nextIndent = getIndent(model.getLineContent(j));
            break;
          }
        }

        if (nextIndent > indent) {
          stack.push({ indent, start: i });
        }
      }

      // Close remaining open blocks
      while (stack.length > 0) {
        const entry = stack.pop()!;
        if (lineCount > entry.start) {
          ranges.push({ start: entry.start, end: lineCount, kind: monacoInstance.languages.FoldingRangeKind.Region });
        }
      }

      return ranges;
    },
  });
}

export const MonacoWrapper: React.FC<MonacoWrapperProps> = ({
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
  onAnnotationSave,
  onAnnotationDelete,
  onSelectionChange,
  onSymbolClick,
  onSymbolGoToDefinition,
}) => {
  const { theme } = useTheme();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const appliedAnnotationsRef = useRef<ReturnType<typeof applyAnnotations> | null>(null);
  const highlightDecorationIdsRef = useRef<string[]>([]);
  const symbolNavDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const selectionDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const onEditorReadyRef = useRef(onEditorReady);
  const [editorReady, setEditorReady] = useState(false);
  const [themesReady, setThemesReady] = useState(false);

  useEffect(() => { onEditorReadyRef.current = onEditorReady; });

  const { setEditor: setHistoryEditor } = useMonacoHistory();

  // Pre-register themes before the editor mounts so the theme names are available immediately.
  useEffect(() => {
    loader.init().then(async (monacoInstance) => {
      await ensureThemesRegistered(monacoInstance);
      ensureFoldingRegistered(monacoInstance);
      setThemesReady(true);
    }).catch(() => {
      // If loader fails, still show the editor with built-in themes
      setThemesReady(true);
    });
  }, []);

  // Sync theme changes to the active editor
  useEffect(() => {
    if (!themesReady || !monacoRef.current) return;
    const monacoTheme = theme === 'dark' ? 'mc-dark' : 'mc-light';
    monacoRef.current.editor.setTheme(monacoTheme);
  }, [theme, themesReady]);

  const handleEditorDidMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;
    monacoRef.current = monacoInstance;

    // Configure TypeScript defaults for intellisense
    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monacoInstance.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
      allowJs: true,
    });

    // Wire up undo/redo history tracking
    setHistoryEditor(editor);

    // Selection change listener
    if (onSelectionChange) {
      selectionDisposableRef.current = editor.onDidChangeCursorSelection((e) => {
        const sel = e.selection;
        if (sel.isEmpty()) {
          onSelectionChange(null);
        } else {
          onSelectionChange({
            startLine: sel.startLineNumber,
            endLine: sel.endLineNumber,
          });
        }
      });
    }

    // Symbol navigation
    if (onSymbolClick || onSymbolGoToDefinition) {
      symbolNavDisposablesRef.current = registerSymbolNav(editor, onSymbolClick, onSymbolGoToDefinition);
    }

    onEditorReady?.(editor);
    setEditorReady(true);
  }, [onEditorReady, onSelectionChange, onSymbolClick, onSymbolGoToDefinition, setHistoryEditor]);

  // Annotations effect
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady) return;

    if (appliedAnnotationsRef.current) {
      clearAnnotations(editor, appliedAnnotationsRef.current);
      appliedAnnotationsRef.current = null;
    }

    if (annotations.length > 0) {
      const callbacks: AnnotationCallbacks = {
        onSave: onAnnotationSave ?? (() => {}),
        onDelete: onAnnotationDelete ?? (() => {}),
      };
      appliedAnnotationsRef.current = applyAnnotations(editor, monacoRef.current!, annotations, callbacks);
    }
  }, [annotations, onAnnotationSave, onAnnotationDelete, editorReady]);

  // Highlight lines effect
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    highlightDecorationIdsRef.current = editor.deltaDecorations(
      highlightDecorationIdsRef.current,
      highlightLines.map((ln) => ({
        range: new monaco.Range(ln, 1, ln, 1),
        options: { isWholeLine: true, className: 'mc-highlighted-line' },
      })),
    );
  }, [highlightLines]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setHistoryEditor(null);
      selectionDisposableRef.current?.dispose();
      for (const d of symbolNavDisposablesRef.current) d.dispose();
      const editor = editorRef.current;
      if (editor) {
        if (appliedAnnotationsRef.current) clearAnnotations(editor, appliedAnnotationsRef.current);
      }
      onEditorReadyRef.current?.(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const containerStyle = height === '100%' ? { height: '100%' } : { height };

  // Determine theme names: use custom themes once loaded, fall back to built-ins during loading.
  const monacoTheme = themesReady
    ? (theme === 'dark' ? 'mc-dark' : 'mc-light')
    : (theme === 'dark' ? 'vs-dark' : 'vs');

  return (
    <div
      className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden flex flex-col ${className}`}
      style={containerStyle}
      data-testid="editor-wrapper"
    >
      <style>{`
        .mc-highlighted-line { background-color: rgba(254, 249, 195, 0.5) !important; }
        .dark .mc-highlighted-line { background-color: rgba(113, 63, 18, 0.3) !important; }
      `}</style>
      <Editor
        value={value}
        onChange={(val) => onChange(val ?? '')}
        language={getMonacoLanguage(language)}
        theme={monacoTheme}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          lineNumbers: showLineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          glyphMargin: true,
          // Minimap: enabled with sensible defaults — narrow, shows a slider on hover,
          // no individual characters rendered (too noisy at smaller sizes).
          minimap: {
            enabled: true,
            scale: 1,
            showSlider: 'mouseover',
            renderCharacters: false,
            maxColumn: 80,
          },
          // Sticky scroll: pin parent scope headers at top while scrolling.
          stickyScroll: {
            enabled: true,
            maxLineCount: 5,
          },
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
          fontSize: 13,
          tabSize: 2,
          automaticLayout: true,
          placeholder: placeholder || undefined,
          // Folding: use the registered custom folding range providers.
          folding: true,
          foldingStrategy: 'auto',
          showFoldingControls: 'mouseover',
          // Codicons: Monaco uses its own bundled codicon font (no extra setup needed
          // when using vite-plugin-monaco-editor, which copies the font assets).
          // Enabling suggest and quick suggestion icons confirms codicons are working.
          suggest: {
            showIcons: true,
          },
        }}
        height="100%"
        data-testid="monaco-editor"
      />
    </div>
  );
};

export default MonacoWrapper;
