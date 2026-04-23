/**
 * CodeEditor Component (DirectFileEditor)
 *
 * Editor for direct file paths — loads/saves via api.getFileContent/saveFileContent.
 * Uses MonacoWrapper directly.
 * Merges save/sync, language badge, and copy controls
 * into the shared EditorToolbar via onToolbarControls.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import MonacoWrapper, { type Language } from './MonacoWrapper';
import { CodeArtifactKebabMenu } from './CodeArtifactKebabMenu';
import { PseudoSideBySideView } from './PseudoSideBySideView';
import { FunctionJumpDropdown, type FunctionJumpItem } from './FunctionJumpDropdown';
import { ReferencesPopover } from './ReferencesPopover';
import { useTheme } from '@/hooks/useTheme';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { fetchFunctionsForSource, fetchPseudoReferences, fetchSourceLink, type Reference, type SourceLinkCandidate } from '@/lib/pseudo-api';
import { extractFunctions } from '@/lib/extract-functions';
import { resolveDefinition, type ResolveDecision } from '@/lib/definition-resolver';
import { useNavHistory } from '@/hooks/useNavHistory';
import { usePendingJump } from '@/stores/pendingJump';
import { DefinitionPickerPopover } from './DefinitionPickerPopover';
import { LinkAndNavigateDialog } from './LinkAndNavigateDialog';

/**
 * Normalize a language string to the Language union type accepted by MonacoWrapper.
 */
function normalizeLanguage(lang: string | null | undefined): Language {
  const valid: Language[] = ['javascript', 'typescript', 'markdown', 'yaml', 'html', 'json', 'python', 'cpp', 'csharp', 'css', 'text'];
  if (!lang) return 'text';
  const lower = lang.toLowerCase() as Language;
  return valid.includes(lower) ? lower : 'text';
}

const EXT_TO_LANGUAGE: Record<string, Language> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  cs: 'csharp',
  py: 'python',
  md: 'markdown', markdown: 'markdown',
  yaml: 'yaml', yml: 'yaml',
  html: 'html', htm: 'html',
  json: 'json',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  css: 'css', scss: 'css', less: 'css',
};

function inferLanguageFromPath(filePath: string): Language {
  if (!filePath) return 'text';
  const base = filePath.split('/').pop() ?? '';
  // Support both dot-extension (foo.cs) and dash-extension (foo-cs)
  const dotExt = base.includes('.') ? base.split('.').pop()!.toLowerCase() : null;
  const dashExt = base.includes('-') ? base.split('-').pop()!.toLowerCase() : null;
  return EXT_TO_LANGUAGE[dotExt ?? ''] ?? EXT_TO_LANGUAGE[dashExt ?? ''] ?? 'text';
}

function fileStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export interface CodeEditorProps {
  filePath: string;
  project: string;
  /** Callback for toolbar controls to be rendered in parent EditorToolbar */
  onToolbarControls?: (controls: React.ReactNode) => void;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ filePath, project, onToolbarControls }) => {
  const currentSession = useSessionStore((state) => state.currentSession);
  const storeRemoveSnippet = useSessionStore((state) => state.removeSnippet);
  const selectSnippet = useSessionStore((state) => state.selectSnippet);
  const snippets = useSessionStore((state) => state.snippets);
  const setPendingJumpStore = usePendingJump((state) => state.setPending);
  const consumePendingJump = usePendingJump((state) => state.consume);
  // Nav history
  const navHistory = useNavHistory();

  // State
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [showPseudo, setShowPseudo] = useState(false);
  const [functions, setFunctions] = useState<FunctionJumpItem[]>([]);
  const [useTier2, setUseTier2] = useState(false);
  const editorViewRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [popover, setPopover] = useState<{ symbol: string; refs: Reference[]; rect: DOMRect } | null>(null);

  // Theme for Monaco
  const { theme } = useTheme();
  const _monacoTheme = theme === 'dark' ? 'mc-dark' : 'mc-light';

  // Feature B state
  const [pickerState, setPickerState] = useState<{ symbol: string; candidates: SourceLinkCandidate[]; rect: DOMRect } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ candidate: SourceLinkCandidate; symbol: string } | null>(null);

  // Editor ready flag (so pending-jump consumption effect can fire)
  const [editorReady, setEditorReady] = useState(false);

  const snippetsRef = useRef(snippets);
  useEffect(() => { snippetsRef.current = snippets; }, [snippets]);

  const currentSessionRef = useRef(currentSession);
  useEffect(() => { currentSessionRef.current = currentSession; }, [currentSession]);

  const filePathRef = useRef<string | null>(null);
  useEffect(() => {
    filePathRef.current = filePath || null;
  }, [filePath]);

  const navPushRef = useRef(navHistory.push);
  useEffect(() => { navPushRef.current = navHistory.push; }, [navHistory.push]);

  const navBackRef = useRef(navHistory.back);
  useEffect(() => { navBackRef.current = navHistory.back; }, [navHistory.back]);

  // Auto-clear flash messages after 3 seconds
  useEffect(() => {
    if (!flashMessage) return;
    const timer = setTimeout(() => setFlashMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [flashMessage]);

  // Load content on mount / filePath change
  useEffect(() => {
    if (!filePath) return;
    api.getFileContent(filePath).then(({ content, language: lang }: { content: string; language: string }) => {
      setCode(content);
      setLanguage(lang);
      setDirty(false);
    }).catch(console.error);
  }, [filePath]);

  // Load functions for jump dropdown — Tier 1: pseudo-db
  useEffect(() => {
    if (!filePath || !currentSession) return;
    let cancelled = false;

    (async () => {
      try {
        const tier1 = await fetchFunctionsForSource(currentSession.project, filePath);
        if (cancelled) return;
        if (tier1.length > 0) {
          setFunctions((tier1 as FunctionJumpItem[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
          setUseTier2(false);
        } else {
          setUseTier2(true);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Tier 1 functions lookup failed:', err);
        setUseTier2(true);
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, currentSession?.project]);

  // Tier 2: Lezer/regex fallback — fires on content changes while Tier 2 mode is active
  useEffect(() => {
    if (!useTier2 || !code) return;
    const tier2 = extractFunctions(code, language || 'typescript');
    setFunctions((tier2 as unknown as FunctionJumpItem[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
  }, [useTier2, code, language]);

  const handleSymbolClick = useCallback(async (symbol: string, rect: DOMRect) => {
    const fp = filePathRef.current;
    if (!currentSession || !fp) return;
    const fileStem = fileStemFromPath(fp);
    try {
      const refs = await fetchPseudoReferences(currentSession.project, symbol, fileStem);
      if (refs.length > 0) {
        setPopover({ symbol, refs, rect });
      }
    } catch (err) {
      console.warn('References lookup failed:', err);
    }
  }, [currentSession?.project]);

  const handleGoToDefinition = useCallback(async (symbol: string, rect: DOMRect) => {
    const session = currentSessionRef.current;
    const fp = filePathRef.current;
    if (!session || !fp) return;
    const fileStem = fileStemFromPath(fp);
    try {
      const candidates = await fetchSourceLink(session.project, symbol, fileStem);
      const linked = snippetsRef.current
        .filter((s) => s.name)
        .map((s) => ({ id: s.id, filePath: s.name }));
      const decision: ResolveDecision = resolveDefinition(candidates, linked);
      if (decision.type === 'not-found') return;
      if (decision.type === 'found-linked') {
        const curEditor = editorViewRef.current;
        const curLine = curEditor ? (curEditor.getPosition()?.lineNumber ?? 1) : 1;
        navPushRef.current({ snippetId: decision.snippetId, line: curLine });
        setPendingJumpStore({ snippetId: decision.snippetId, line: decision.line });
        selectSnippet(decision.snippetId);
        return;
      }
      if (decision.type === 'needs-link') {
        setLinkDialog({ candidate: decision.candidate, symbol });
        return;
      }
      if (decision.type === 'needs-link-picker') {
        setPickerState({ symbol, candidates: decision.candidates, rect });
        return;
      }
    } catch (err) {
      console.warn('Go-to-definition failed:', err);
    }
  }, [selectSnippet, setPendingJumpStore]);

  const handleEditorReady = useCallback((editor: Monaco.editor.IStandaloneCodeEditor | null) => {
    editorViewRef.current = editor;
    setEditorReady(editor !== null);
  }, []);

  const jumpToLine = useCallback((line: number) => {
    const editor = editorViewRef.current;
    if (!editor) return;
    const model = editor.getModel();
    const totalLines = model ? model.getLineCount() : 1;
    const safeLine = Math.max(1, Math.min(line, totalLines));
    editor.revealLineInCenter(safeLine);
    editor.setPosition({ lineNumber: safeLine, column: 1 });
    editor.focus();
  }, []);

  const jumpToLineRef = useRef(jumpToLine);
  useEffect(() => { jumpToLineRef.current = jumpToLine; }, [jumpToLine]);

  const handleBack = useCallback(() => {
    const entry = navBackRef.current();
    if (!entry) return;
    setPendingJumpStore({ snippetId: entry.snippetId, line: entry.line });
    selectSnippet(entry.snippetId);
  }, [selectSnippet, setPendingJumpStore]);

  // Pending-jump consumption: when editor mounts, apply any pending jump for this filePath
  useEffect(() => {
    if (!editorReady) return;
    // Use filePath as a stable ID for pending-jump lookup
    const line = consumePendingJump(filePath);
    if (line != null) {
      jumpToLine(line);
    }
  }, [editorReady, filePath, consumePendingJump, jumpToLine]);

  async function handleSave() {
    if (!dirty) return;
    try {
      await api.saveFileContent(filePath, code);
      setDirty(false);
      setFlashMessage('Saved');
      setTimeout(() => setFlashMessage(null), 2000);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const { content } = await api.getFileContent(filePath);
      if (content !== code) {
        setCode(content);
        setDirty(false);
        setFlashMessage('Synced from disk');
        setTimeout(() => setFlashMessage(null), 2000);
      }
    } catch (err) {
      console.error('Failed to sync:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [filePath, code]);

  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => setFlashMessage('Copied')).catch(() => {});
  }, [code]);

  // MonacoWrapper onChange: update local state only
  const handleEditorChange = useCallback((val: string | undefined) => {
    setCode(val ?? '');
    setDirty(true);
  }, []);

  // Build the merged toolbar: save/sync/pseudo/status + language badge + copy + kebab
  const mergedControls = useMemo(() => {
    if (!currentSession) return null;
    return (
      <>
        {/* Back button — nav history */}
        <button
          onClick={handleBack}
          disabled={!navHistory.canGoBack}
          title={navHistory.canGoBack ? 'Back' : 'No history'}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            navHistory.canGoBack
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
          }`}
        >
          ← Back
        </button>
        {/* Save to File */}
        <button
          onClick={handleSave}
          disabled={!dirty}
          title={dirty ? 'Save local changes to disk' : 'No changes to save'}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            !dirty
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          Save
        </button>
        {/* Sync from Disk */}
        <button
          onClick={handleSync}
          disabled={isSyncing}
          title="Re-read file from disk"
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            isSyncing
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {isSyncing ? 'Syncing…' : 'Sync'}
        </button>
        {/* Pseudo side-by-side toggle */}
        <button
          onClick={() => setShowPseudo((prev) => !prev)}
          aria-pressed={showPseudo}
          title={showPseudo ? 'Hide pseudo side-by-side' : 'Show pseudo side-by-side'}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            showPseudo
              ? 'bg-purple-500 text-white hover:bg-purple-600'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Pseudo
        </button>
        {/* Function jump dropdown */}
        <FunctionJumpDropdown functions={functions} onJump={jumpToLine} />
        {/* Dirty indicator */}
        <span className={`text-xs font-medium ${dirty ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
          {dirty ? 'Modified' : 'Clean'}
        </span>
        {/* Flash message */}
        {flashMessage && (
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">{flashMessage}</span>
        )}
        {/* Separator */}
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
        {/* Language badge */}
        {language && (
          <span className="px-2 py-0.5 rounded text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 select-none">
            {language}
          </span>
        )}
        {/* Copy button */}
        <button
          onClick={handleCopy}
          title="Copy code to clipboard"
          className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Copy
        </button>
        {/* Separator before kebab */}
        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
        {/* Kebab menu (Copy path, Impact, Deprecate, Unlink) */}
        <CodeArtifactKebabMenu
          snippetId={filePath}
          filePath={filePath}
          projectPath={currentSession.project}
          sessionName={currentSession.name}
          onDeprecate={() => {}}
          onDelete={() => storeRemoveSnippet(filePath)}
        />
      </>
    );
  }, [currentSession, handleSave, handleSync, isSyncing, dirty, flashMessage, showPseudo, filePath, functions, jumpToLine, navHistory.canGoBack, handleBack, language, handleCopy, storeRemoveSnippet]);

  // Push merged controls to parent EditorToolbar
  useEffect(() => {
    if (onToolbarControls) {
      onToolbarControls(mergedControls);
    }
  }, [onToolbarControls, mergedControls]);

  const monacoLanguage = (() => {
    const fromRecord = normalizeLanguage(language);
    return fromRecord !== 'text' ? fromRecord : inferLanguageFromPath(filePath);
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Editor area */}
      <div className="flex-1 min-h-0">
        {showPseudo && currentSession ? (
          <PseudoSideBySideView
            snippetId={filePath}
            sourceFilePath={filePath}
            projectPath={currentSession.project}
          >
            <MonacoWrapper
              value={code}
              onChange={handleEditorChange}
              language={monacoLanguage}
              onEditorReady={handleEditorReady}
              onSymbolClick={handleSymbolClick}
              onSymbolGoToDefinition={handleGoToDefinition}
              height="100%"
            />
          </PseudoSideBySideView>
        ) : (
          <MonacoWrapper
            value={code}
            onChange={handleEditorChange}
            language={monacoLanguage}
            onEditorReady={handleEditorReady}
            onSymbolClick={handleSymbolClick}
            onSymbolGoToDefinition={handleGoToDefinition}
            height="100%"
          />
        )}
      </div>

      {/* Minimal footer: file path */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
      </div>

      {/* References popover (shown after Cmd/Ctrl-click on a symbol) */}
      {popover && (
        <ReferencesPopover
          references={popover.refs}
          symbolName={popover.symbol}
          anchorRect={popover.rect}
          currentFilePath={filePath}
          linkedSourcePathsInSession={[]}
          onNavigateSameFile={jumpToLine}
          onNavigateLinkedFile={() => {}}
          onClose={() => setPopover(null)}
        />
      )}

      {/* Definition picker popover (Feature B: multiple candidate defs) */}
      {pickerState && currentSession && (
        <DefinitionPickerPopover
          candidates={pickerState.candidates}
          symbolName={pickerState.symbol}
          anchorRect={pickerState.rect}
          onPick={(candidate) => {
            const pickerSymbol = pickerState.symbol;
            setPickerState(null);
            const already = snippetsRef.current.find((s) => s.name === candidate.sourceFilePath);
            if (already) {
              const curEditor = editorViewRef.current;
              const curLine = curEditor ? (curEditor.getPosition()?.lineNumber ?? 1) : 1;
              navPushRef.current({ snippetId: already.id, line: curLine });
              setPendingJumpStore({ snippetId: already.id, line: candidate.sourceLine ?? 1 });
              selectSnippet(already.id);
            } else {
              setLinkDialog({ candidate, symbol: pickerSymbol });
            }
          }}
          onClose={() => setPickerState(null)}
        />
      )}

      {/* Link-and-navigate confirmation dialog (Feature B) */}
      <LinkAndNavigateDialog
        open={linkDialog !== null}
        candidate={linkDialog?.candidate ?? null}
        symbolName={linkDialog?.symbol ?? ''}
        onClose={() => setLinkDialog(null)}
        onConfirm={async () => {
          setLinkDialog(null);
        }}
      />
    </div>
  );
};

export default CodeEditor;
