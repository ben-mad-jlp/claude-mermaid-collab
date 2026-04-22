/**
 * CodeEditor Component
 *
 * Editor for linked code files (codeFiles store).
 * Uses MonacoWrapper directly — no longer delegates to SnippetEditor.
 * Merges push-to-file, sync-from-disk, language badge, and copy controls
 * into the shared EditorToolbar via onToolbarControls.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import MonacoWrapper, { type Language } from './MonacoWrapper';
import { DiffAgainstDiskModal } from './DiffAgainstDiskModal';
import { CodeArtifactKebabMenu } from './CodeArtifactKebabMenu';
import { PseudoSideBySideView } from './PseudoSideBySideView';
import { MonacoDiffEditor } from './diffReview/MonacoDiffEditor';
import { FunctionJumpDropdown, type FunctionJumpItem } from './FunctionJumpDropdown';
import { ReferencesPopover } from './ReferencesPopover';
import { useTheme } from '@/hooks/useTheme';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { api } from '@/lib/api';
import { fetchFunctionsForSource, fetchPseudoReferences, fetchSourceLink, type Reference, type SourceLinkCandidate } from '@/lib/pseudo-api';
import { extractFunctions } from '@/lib/extract-functions';
import { Snippet } from '@/types';
import { resolveDefinition, type ResolveDecision } from '@/lib/definition-resolver';
import { linkFile } from '@/lib/link-file';
import { useNavHistory } from '@/hooks/useNavHistory';
import { usePendingJump } from '@/stores/pendingJump';
import { DefinitionPickerPopover } from './DefinitionPickerPopover';
import { LinkAndNavigateDialog } from './LinkAndNavigateDialog';

/**
 * Format a timestamp as a human-readable relative time string.
 */
function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60000) return 'just now';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`;
  return `${Math.floor(delta / 86400000)}d ago`;
}

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
  codeFileId: string;
  onSave?: (snippet: Snippet) => void;
  /** Callback for toolbar controls to be rendered in parent EditorToolbar */
  onToolbarControls?: (controls: React.ReactNode) => void;
}

interface ConflictState {
  diskChanged: boolean;
  hasLocalEdits: boolean;
}

function fileStemFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ codeFileId, onSave: _onSave, onToolbarControls }) => {
  const currentSession = useSessionStore((state) => state.currentSession);
  const storeUpdateSnippet = useSessionStore((state) => state.updateSnippet);
  const storeRemoveSnippet = useSessionStore((state) => state.removeSnippet);
  const getCodeFileById = useSessionStore((state) => state.getCodeFileById);
  const updateCodeFile = useSessionStore((state) => state.updateCodeFile);
  const selectSnippet = useSessionStore((state) => state.selectSnippet);
  const snippets = useSessionStore((state) => state.snippets);
  const codeFiles = useSessionStore((state) => state.codeFiles);
  const setPendingJumpStore = usePendingJump((state) => state.setPending);
  const consumePendingJump = usePendingJump((state) => state.consume);
  // Nav history
  const navHistory = useNavHistory();

  // Read from codeFiles store
  const codeFile = getCodeFileById(codeFileId);

  // Direct field reads from the CodeFile artifact
  const filePath = codeFile?.filePath ?? '';
  const dirty = codeFile?.dirty ?? false;
  const code = codeFile?.content ?? '';
  const language = codeFile?.language ?? '';
  const lastPushedAt: number | null = codeFile?.lastPushedAt ?? null;
  const lastSyncedAt: number = Date.now();

  // Detect proposed edit stored as JSON in content
  const proposedEdit: { newCode: string; message?: string; proposedBy: string; proposedAt: number } | null = (() => {
    if (!code) return null;
    try {
      const parsed = JSON.parse(code);
      return parsed?.proposedEdit ?? null;
    } catch {
      return null;
    }
  })();

  // State
  const [isPushing, setIsPushing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [showPseudo, setShowPseudo] = useState(false);
  const [functions, setFunctions] = useState<FunctionJumpItem[]>([]);
  const [useTier2, setUseTier2] = useState(false);
  const editorViewRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffSideBySide = useUIStore((state) => state.diffSideBySide);
  const setDiffSideBySide = useUIStore((state) => state.setDiffSideBySide);
  const [popover, setPopover] = useState<{ symbol: string; refs: Reference[]; rect: DOMRect } | null>(null);
  const [comment, setComment] = useState('');

  // Theme for Monaco diff editor
  const { theme } = useTheme();
  const monacoTheme = theme === 'dark' ? 'mc-dark' : 'mc-light';

  // Feature B state
  const [pickerState, setPickerState] = useState<{ symbol: string; candidates: SourceLinkCandidate[]; rect: DOMRect } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ candidate: SourceLinkCandidate; symbol: string } | null>(null);

  // Editor ready flag (so pending-jump consumption effect can fire)
  const [editorReady, setEditorReady] = useState(false);

  // Combine snippets + code files for cross-file navigation lookups
  const allNavigableFiles = useMemo(() => [
    ...snippets,
    ...codeFiles.map((f) => ({ id: f.id, name: f.filePath })),
  ], [snippets, codeFiles]);
  const snippetsRef = useRef(allNavigableFiles);
  useEffect(() => { snippetsRef.current = allNavigableFiles; }, [allNavigableFiles]);

  const currentSessionRef = useRef(currentSession);
  useEffect(() => { currentSessionRef.current = currentSession; }, [currentSession]);

  const codeFileIdRef = useRef(codeFileId);
  useEffect(() => { codeFileIdRef.current = codeFileId; }, [codeFileId]);

  const navPushRef = useRef(navHistory.push);
  useEffect(() => { navPushRef.current = navHistory.push; }, [navHistory.push]);

  const navBackRef = useRef(navHistory.back);
  useEffect(() => { navBackRef.current = navHistory.back; }, [navHistory.back]);

  // Keep filePath in a ref so handleSymbolClick has a stable identity
  const filePathRef = useRef<string | null>(null);
  useEffect(() => {
    filePathRef.current = filePath || null;
  }, [filePath]);

  // Auto-clear flash messages after 3 seconds
  useEffect(() => {
    if (!flashMessage) return;
    const timer = setTimeout(() => setFlashMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [flashMessage]);

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
        if (decision.snippetId === codeFileIdRef.current) {
          jumpToLineRef.current?.(decision.line);
          return;
        }
        const curEditor = editorViewRef.current;
        const curLine = curEditor ? (curEditor.getPosition()?.lineNumber ?? 1) : 1;
        navPushRef.current({ snippetId: codeFileIdRef.current, line: curLine });
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

  const handleLinkAndNavigate = useCallback(async () => {
    const session = currentSessionRef.current;
    if (!session || !linkDialog) return;
    const { candidate } = linkDialog;
    const newSnippetId = await linkFile(session.project, session.name, candidate.sourceFilePath);
    const curEditor = editorViewRef.current;
    const curLine = curEditor ? (curEditor.getPosition()?.lineNumber ?? 1) : 1;
    navPushRef.current({ snippetId: codeFileIdRef.current, line: curLine });
    setPendingJumpStore({ snippetId: newSnippetId, line: candidate.sourceLine ?? 1 });
    selectSnippet(newSnippetId);
    setLinkDialog(null);
  }, [linkDialog, selectSnippet, setPendingJumpStore]);

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
    if (entry.snippetId === codeFileIdRef.current) {
      jumpToLineRef.current?.(entry.line);
      return;
    }
    setPendingJumpStore({ snippetId: entry.snippetId, line: entry.line });
    selectSnippet(entry.snippetId);
  }, [selectSnippet, setPendingJumpStore]);

  // Pending-jump consumption: when editor mounts for a snippet with a pending jump, apply it
  useEffect(() => {
    if (!editorReady) return;
    const line = consumePendingJump(codeFileId);
    if (line != null) {
      jumpToLine(line);
    }
  }, [editorReady, codeFileId, consumePendingJump, jumpToLine]);

  const refreshSnippet = useCallback(async () => {
    if (!currentSession) return;
    try {
      const full = await api.getCodeFile(currentSession.project, currentSession.name, codeFileId);
      if (full?.content) {
        if (getCodeFileById(codeFileId)) {
          updateCodeFile(codeFileId, { content: full.content, lastModified: full.lastModified ?? Date.now() });
        } else {
          storeUpdateSnippet(codeFileId, { content: full.content, lastModified: full.lastModified ?? Date.now() });
        }
      }
    } catch (err) {
      console.error('Failed to refresh snippet:', err);
    }
  }, [currentSession, codeFileId, storeUpdateSnippet, updateCodeFile, getCodeFileById]);

  // Auto-load content on mount if the store entry is empty (loaded from list metadata only)
  useEffect(() => {
    if (!code) refreshSnippet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFileId]);

  const actualPush = useCallback(async () => {
    if (!currentSession || isPushing) return;
    setIsPushing(true);
    try {
      await api.pushCodeToFile(currentSession.project, currentSession.name, codeFileId);
      setFlashMessage('Pushed');
      setConflict(null);
      await refreshSnippet();
    } catch (err) {
      console.error('Push failed:', err);
      setFlashMessage('Push failed');
    } finally {
      setIsPushing(false);
    }
  }, [currentSession, isPushing, codeFileId, refreshSnippet]);

  const handlePush = useCallback(() => {
    if (!currentSession || isPushing || !dirty) return;
    setDiffModalOpen(true);
  }, [currentSession, isPushing, dirty]);

  const handlePreview = useCallback(() => {
    setDiffModalOpen(true);
  }, []);

  const handleDeprecate = useCallback(async () => {
    if (!currentSession) return;
    try {
      await api.setDeprecated(currentSession.project, currentSession.name, codeFileId, true);
      if (!getCodeFileById(codeFileId)) {
        storeUpdateSnippet(codeFileId, { deprecated: true, lastModified: Date.now() });
      }
      setFlashMessage('Deprecated');
      await refreshSnippet();
    } catch (err) {
      console.error('Deprecate failed:', err);
      setFlashMessage('Deprecate failed');
    }
  }, [currentSession, codeFileId, storeUpdateSnippet, refreshSnippet, getCodeFileById]);

  const handleDelete = useCallback(async () => {
    if (!currentSession) return;
    try {
      await api.deleteSnippet(currentSession.project, currentSession.name, codeFileId);
      storeRemoveSnippet(codeFileId);
    } catch (err) {
      console.error('Delete failed:', err);
      setFlashMessage('Unlink failed');
    }
  }, [currentSession, codeFileId, storeRemoveSnippet]);

  const handleSync = useCallback(async () => {
    if (!currentSession || isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await api.syncCodeFromDisk(currentSession.project, currentSession.name, codeFileId);

      if (result.conflict) {
        setConflict({ diskChanged: true, hasLocalEdits: true });
      } else if (result.diskChanged) {
        setFlashMessage('Synced');
      } else if (!result.diskChanged) {
        setFlashMessage('Up to date');
      }

      await refreshSnippet();
    } catch (err) {
      console.error('Sync failed:', err);
      setFlashMessage('Sync failed');
    } finally {
      setIsSyncing(false);
    }
  }, [currentSession, isSyncing, codeFileId, refreshSnippet]);

  const handleAccept = useCallback(async () => {
    if (!currentSession) return;
    try {
      await api.acceptProposedEdit(currentSession.project, currentSession.name, codeFileId, comment);
      setComment('');
      setFlashMessage('Accepted — review and Push when ready');
      await refreshSnippet();
    } catch (err) {
      console.error('Accept proposal failed:', err);
      setFlashMessage('Accept failed');
    }
  }, [currentSession, codeFileId, refreshSnippet, comment]);

  const handleReject = useCallback(async () => {
    if (!currentSession) return;
    try {
      await api.rejectProposedEdit(currentSession.project, currentSession.name, codeFileId, comment);
      setComment('');
      setFlashMessage('Rejected');
      await refreshSnippet();
    } catch (err) {
      console.error('Reject proposal failed:', err);
      setFlashMessage('Reject failed');
    }
  }, [currentSession, codeFileId, refreshSnippet, comment]);

  const handleKeepMine = useCallback(() => {
    setConflict(null);
  }, []);

  const handleTakeDisk = useCallback(async () => {
    if (!currentSession) return;
    try {
      await api.syncCodeFromDisk(currentSession.project, currentSession.name, codeFileId);
      setConflict(null);
      setFlashMessage('Took disk version');
      await refreshSnippet();
    } catch (err) {
      console.error('Take disk failed:', err);
      setFlashMessage('Take disk failed');
    }
  }, [currentSession, codeFileId, refreshSnippet]);

  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => setFlashMessage('Copied')).catch(() => {});
  }, [code]);

  // MonacoWrapper onChange: write directly to codeFiles store
  const handleEditorChange = useCallback((val: string) => {
    updateCodeFile(codeFileId, { content: val, dirty: true });
  }, [codeFileId, updateCodeFile]);

  // Build the merged toolbar: push/preview/sync/pseudo/status + language badge + copy + kebab
  const mergedControls = useMemo(() => {
    if (!currentSession) return null;
    if (proposedEdit) {
      return (
        <>
          <input
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAccept(); }}
            placeholder="Optional comment… (⌘Enter to accept)"
            className="px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500 w-48"
          />
          <button onClick={handleAccept} className="px-2 py-1 rounded text-xs font-medium bg-green-500 text-white hover:bg-green-600 transition-colors">✓ Accept</button>
          <button onClick={handleReject} className="px-2 py-1 rounded text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">✗ Reject</button>
          <button onClick={() => setDiffSideBySide(!diffSideBySide)} className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            {diffSideBySide ? 'Inline' : 'Side'}
          </button>
          {flashMessage && <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">{flashMessage}</span>}
        </>
      );
    }
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
        {/* Push to File (opens diff confirmation modal) */}
        <button
          onClick={handlePush}
          disabled={isPushing || !dirty}
          title={dirty ? 'Review and push local changes to disk' : 'No changes to push'}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            isPushing || !dirty
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          }`}
        >
          {isPushing ? 'Pushing…' : 'Push'}
        </button>
        {/* Preview Diff (standalone, no confirm) */}
        <button
          onClick={handlePreview}
          title="Preview diff against disk"
          className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Preview
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
        {/* Dirty / Conflict indicator */}
        {conflict ? (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">Conflict</span>
        ) : (
          <span className={`text-xs font-medium ${dirty ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
            {dirty ? 'Modified' : 'Clean'}
          </span>
        )}
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
          snippetId={codeFileId}
          filePath={filePath}
          projectPath={currentSession.project}
          sessionName={currentSession.name}
          onDeprecate={handleDeprecate}
          onDelete={handleDelete}
        />
      </>
    );
  }, [currentSession, handlePush, handlePreview, handleSync, isPushing, isSyncing, dirty, conflict, flashMessage, showPseudo, codeFileId, filePath, handleDeprecate, handleDelete, functions, jumpToLine, navHistory.canGoBack, handleBack, handleAccept, handleReject, diffSideBySide, setDiffSideBySide, comment, language, handleCopy, proposedEdit]);

  // Push merged controls to parent EditorToolbar
  useEffect(() => {
    if (onToolbarControls) {
      onToolbarControls(mergedControls);
    }
  }, [onToolbarControls, mergedControls]);

  // If codeFile not yet in store, show a loading placeholder while auto-load effect runs
  if (!codeFile) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    );
  }

  const monacoLanguage = normalizeLanguage(language || inferLanguageFromPath(filePath));

  return (
    <div className="flex flex-col h-full">
      {/* Conflict banner */}
      {conflict && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-between text-sm">
          <span className="text-amber-800 dark:text-amber-200">
            Conflict: file changed on disk while you have local edits
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleKeepMine}
              className="px-2 py-0.5 rounded text-xs font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 transition-colors"
            >
              Keep Mine
            </button>
            <button
              onClick={handleTakeDisk}
              className="px-2 py-0.5 rounded text-xs font-medium bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-300 dark:hover:bg-blue-700 transition-colors"
            >
              Take Disk
            </button>
            <button
              onClick={() => setConflict(null)}
              className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Editor area — MonacoDiffEditor when reviewing a proposal, MonacoWrapper otherwise */}
      <div className="flex-1 min-h-0">
        {proposedEdit ? (
          <MonacoDiffEditor
            snippetId={codeFileId}
            original={code}
            proposed={proposedEdit.newCode}
            language={language}
            theme={monacoTheme}
            sideBySide={diffSideBySide}
            onAcceptAll={handleAccept}
            onRejectAll={handleReject}
            onSideBySideChange={setDiffSideBySide}
          />
        ) : showPseudo && currentSession ? (
          <PseudoSideBySideView
            snippetId={codeFileId}
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

      {/* Minimal footer: file path (fills space) + timestamps */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-mono truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
        <span className="flex-shrink-0">{lastPushedAt != null ? `Pushed ${formatRelativeTime(lastPushedAt)}` : 'Never pushed'}</span>
        <span className="flex-shrink-0">Synced {formatRelativeTime(lastSyncedAt)}</span>
      </div>

      {/* Diff modal — doubles as Push confirmation and standalone Preview */}
      {currentSession && (
        <DiffAgainstDiskModal
          open={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          onConfirm={dirty ? actualPush : undefined}
          confirmLabel="Push to File"
          snippetId={codeFileId}
          filePath={filePath}
          projectPath={currentSession.project}
          sessionName={currentSession.name}
        />
      )}

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
              if (already.id === codeFileId) {
                jumpToLine(candidate.sourceLine ?? 1);
              } else {
                const curEditor = editorViewRef.current;
                const curLine = curEditor ? (curEditor.getPosition()?.lineNumber ?? 1) : 1;
                navPushRef.current({ snippetId: codeFileId, line: curLine });
                setPendingJumpStore({ snippetId: already.id, line: candidate.sourceLine ?? 1 });
                selectSnippet(already.id);
              }
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
        onConfirm={handleLinkAndNavigate}
      />
    </div>
  );
};

export default CodeEditor;
