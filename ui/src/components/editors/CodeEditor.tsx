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
import { FunctionJumpDropdown, type FunctionJumpItem } from './FunctionJumpDropdown';
import { useTheme } from '@/hooks/useTheme';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/lib/api';
import { extractFunctions } from '@/lib/extract-functions';
import { useNavHistory } from '@/hooks/useNavHistory';
import { usePendingJump } from '@/stores/pendingJump';

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
  const [functions, setFunctions] = useState<FunctionJumpItem[]>([]);
  const [useTier2, setUseTier2] = useState(true);
  const editorViewRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // Theme for Monaco
  const { theme } = useTheme();
  const _monacoTheme = theme === 'dark' ? 'mc-dark' : 'mc-light';

  // Editor ready flag (so pending-jump consumption effect can fire)
  const [editorReady, setEditorReady] = useState(false);

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

  // Tier 2: Lezer/regex function extraction — fires on content changes
  useEffect(() => {
    if (!useTier2 || !code) return;
    const tier2 = extractFunctions(code, language || 'typescript');
    setFunctions((tier2 as unknown as FunctionJumpItem[]).slice().sort((a, b) => a.name.localeCompare(b.name)));
  }, [useTier2, code, language]);

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

  // Build the merged toolbar: back/save/sync/jump/status + language badge + copy + kebab
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
  }, [currentSession, handleSave, handleSync, isSyncing, dirty, flashMessage, filePath, functions, jumpToLine, navHistory.canGoBack, handleBack, language, handleCopy, storeRemoveSnippet]);

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
        <MonacoWrapper
          value={code}
          onChange={handleEditorChange}
          language={monacoLanguage}
          onEditorReady={handleEditorReady}
          height="100%"
        />
      </div>

      {/* Minimal footer: file path */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
      </div>
    </div>
  );
};

export default CodeEditor;
