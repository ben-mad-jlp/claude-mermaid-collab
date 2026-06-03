/**
 * GlobalSearch Component
 *
 * Cmd+K (Ctrl+K) overlay that provides cross-artifact search across pseudo
 * files (FTS) and linked code snippets (content grep). Results are rendered
 * as a unified list with kind icons, keyboard navigation, and click handlers
 * that dispatch based on result kind.
 *
 * - 'code' kind: setPending + selectSnippet + close overlay
 * - 'pseudo' kind: if a snippet for the file is already linked, same as code;
 *   otherwise show LinkAndNavigateDialog, then linkFile, setPending, select.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useDiveIn } from '@/hooks/useDiveIn';
import { useDataLoader } from '@/hooks/useDataLoader';
import { usePendingJump } from '@/stores/pendingJump';
import { useGlobalSearch } from '@/stores/globalSearch';
import { fetchCodeSearch, type CodeSearchResult } from '@/lib/code-search-api';
import { linkFile } from '@/lib/link-file';
import { LinkAndNavigateDialog } from '@/components/editors/LinkAndNavigateDialog';
import type { SourceLinkCandidate } from '@/components/editors/LinkAndNavigateDialog';
import type { Snippet } from '@/types';

/**
 * A mode-aware command for the ⌘K palette (CUI-6). In Studio the palette is
 * artifacts + session todos + step-back; in Bridge/Plan it is the role-action
 * surface (start coordinator, answer an escalation, jump to a session).
 */
interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function basename(p: string): string {
  if (!p) return '';
  return p.split('/').pop() || p;
}

function getFileStem(filePath: string | undefined | null): string {
  if (!filePath) return '';
  const last = basename(filePath);
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

function extractSnippetFilePath(snip: Snippet): string | null {
  const metaPath = (snip as any).filePath as string | undefined;
  try {
    const parsed = JSON.parse(snip.content || '');
    if (parsed && typeof parsed.filePath === 'string' && parsed.filePath) {
      return parsed.filePath;
    }
  } catch {
    // Not JSON envelope
  }
  return metaPath || null;
}

function findLinkedSnippetForFile(
  snippets: Snippet[],
  filePath: string,
): Snippet | null {
  const exact = snippets.find((s) => extractSnippetFilePath(s) === filePath);
  if (exact) return exact;
  const targetStem = getFileStem(filePath);
  if (!targetStem) return null;
  return snippets.find((s) => getFileStem(extractSnippetFilePath(s)) === targetStem) || null;
}

const KindIconCode: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-info-500 shrink-0">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const KindIconPseudo: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-500 shrink-0">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

export const GlobalSearch: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const snippets = useSessionStore((s) => s.snippets);
  const documents = useSessionStore((s) => s.documents);
  const diagrams = useSessionStore((s) => s.diagrams);
  const sessions = useSessionStore((s) => s.sessions);

  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const activeProject = useUIStore((s) => s.activeProject);
  const escalations = useSupervisorStore((s) => s.escalations);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);
  const decideEscalation = useSupervisorStore((s) => s.decideEscalation);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const diveIn = useDiveIn();
  const { selectDocumentWithContent, selectDiagramWithContent } = useDataLoader();

  // Open state lives in a shared store so external buttons (Sidebar) can trigger it.
  const isOpen = useGlobalSearch((s) => s.isOpen);
  const openStore = useGlobalSearch((s) => s.open);
  const closeStore = useGlobalSearch((s) => s.close);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkCandidate, setLinkCandidate] = useState<SourceLinkCandidate | null>(null);
  const [linkSymbolName, setLinkSymbolName] = useState('');
  const [linkTargetLine, setLinkTargetLine] = useState<number>(1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  const openOverlay = useCallback(() => {
    openStore();
    setQuery('');
    setResults([]);
    setError(null);
    setSelectedIdx(0);
  }, [openStore]);

  const closeOverlay = useCallback(() => {
    closeStore();
    setQuery('');
    setResults([]);
    setError(null);
    setSelectedIdx(0);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [closeStore]);

  // Mode-aware command surface (CUI-6). Studio = artifacts + session todos +
  // step-back; Bridge/Plan = the role-action surface.
  const commands = useMemo<CommandItem[]>(() => {
    const out: CommandItem[] = [];
    const run = (fn: () => void) => () => {
      fn();
      closeOverlay();
    };
    const project = activeProject ?? currentSession?.project ?? '';
    const serverScope = currentSession?.serverId ?? 'local';

    if (mode === 'studio') {
      out.push({ id: 'step-back', label: '⤢ Step back to Bridge', hint: 'mode', run: run(() => setMode('bridge')) });
      if (currentSession) {
        for (const d of documents) {
          out.push({
            id: `doc-${d.id}`,
            label: d.name,
            hint: 'document',
            run: run(() => void selectDocumentWithContent(currentSession.serverId, currentSession.project, currentSession.name, d.id)),
          });
        }
        for (const g of diagrams) {
          out.push({
            id: `dia-${g.id}`,
            label: g.name,
            hint: 'diagram',
            run: run(() => void selectDiagramWithContent(currentSession.serverId, currentSession.project, currentSession.name, g.id)),
          });
        }
        const sessionTodos = (todosByProject[currentSession.project] ?? []).filter(
          (t) => t.sessionName === currentSession.name || t.assigneeSession === currentSession.name,
        );
        for (const t of sessionTodos) {
          out.push({ id: `todo-${t.id}`, label: t.title, hint: `todo · ${t.status}`, run: run(() => {}) });
        }
      }
    } else {
      // Bridge / Plan: the palette IS the role-action surface.
      const running = !!coordinatorByProject[project];
      if (project) {
        out.push({
          id: 'coordinator',
          label: running ? '■ Stop coordinator' : '▸ Start coordinator',
          hint: 'daemon',
          run: run(() => void setCoordinator(serverScope, project, running ? 'stop' : 'start')),
        });
      }
      out.push({ id: 'approve-plan', label: '✓ Approve plan', hint: 'plan', run: run(() => setMode('plan')) });
      for (const e of escalations.filter((x) => x.status === 'open')) {
        const rec = e.options?.find((o) => o.id === e.recommended) ?? (e.options?.length === 1 ? e.options[0] : undefined);
        out.push({
          id: `esc-${e.id}`,
          label: `Answer: ${e.questionText}`,
          hint: rec ? `→ ${rec.label}` : `jump ${e.session}`,
          run: run(() => {
            if (rec) void decideEscalation(serverScope, e.id, rec.id);
            else diveIn({ project: e.project, session: e.session });
          }),
        });
      }
      for (const s of sessions) {
        out.push({ id: `jump-${s.project}:${s.name}`, label: `Jump to ${s.name}`, hint: 'session', run: run(() => diveIn({ project: s.project, session: s.name })) });
      }
    }
    return out;
  }, [
    mode, activeProject, currentSession, documents, diagrams, sessions, todosByProject,
    escalations, coordinatorByProject, setCoordinator, decideEscalation, setMode, diveIn,
    selectDocumentWithContent, selectDiagramWithContent, closeOverlay,
  ]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q));
  }, [commands, query]);

  // Cmd/Ctrl+K global listener
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (isOpen) {
          closeOverlay();
        } else {
          openOverlay();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, openOverlay, closeOverlay]);

  // Autofocus input when opening
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (!currentSession) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetchCodeSearch(
          currentSession.project,
          currentSession.name,
          trimmed,
        );
        if (myReq !== reqIdRef.current) return;
        setResults(resp.results || []);
        setSelectedIdx(0);
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query, isOpen, currentSession]);

  // Scroll selected row into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-result-idx="${selectedIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const jumpToSnippet = useCallback((snippetId: string, line: number) => {
    usePendingJump.getState().setPending({ snippetId, line: line || 1 });
    useSessionStore.getState().selectSnippet(snippetId);
    closeOverlay();
  }, [closeOverlay]);

  const handleResultClick = useCallback((result: CodeSearchResult) => {
    if (result.kind === 'code') {
      if (!result.snippetId) return;
      jumpToSnippet(result.snippetId, result.line || 1);
      return;
    }
    const existing = findLinkedSnippetForFile(snippets, result.filePath);
    if (existing) {
      jumpToSnippet(existing.id, result.line || 1);
      return;
    }
    const candidate: SourceLinkCandidate = {
      sourceFilePath: result.filePath,
      sourceLine: result.line ?? null,
      sourceLineEnd: null,
      language: null,
      isExported: false,
    };
    setLinkCandidate(candidate);
    setLinkSymbolName(result.methodName || basename(result.filePath));
    setLinkTargetLine(result.line || 1);
    setLinkDialogOpen(true);
  }, [snippets, jumpToSnippet]);

  const handleLinkConfirm = useCallback(async () => {
    if (!currentSession || !linkCandidate) return;
    const newSnippetId = await linkFile(
      currentSession.project,
      currentSession.name,
      linkCandidate.sourceFilePath,
    );
    usePendingJump.getState().setPending({
      snippetId: newSnippetId,
      line: linkTargetLine || 1,
    });
    useSessionStore.getState().selectSnippet(newSnippetId);
    setLinkDialogOpen(false);
    setLinkCandidate(null);
    closeOverlay();
  }, [currentSession, linkCandidate, linkTargetLine, closeOverlay]);

  // The palette navigates a unified list: commands first, then code results.
  const totalItems = filteredCommands.length + results.length;

  const activateIdx = useCallback((idx: number) => {
    if (idx < filteredCommands.length) {
      filteredCommands[idx]?.run();
      return;
    }
    const r = results[idx - filteredCommands.length];
    if (r) handleResultClick(r);
  }, [filteredCommands, results, handleResultClick]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (totalItems === 0 ? 0 : Math.min(i + 1, totalItems - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      activateIdx(selectedIdx);
      return;
    }
  }, [totalItems, selectedIdx, activateIdx, closeOverlay]);

  const overlay = useMemo(() => {
    if (!isOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24"
        onClick={closeOverlay}
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        data-testid="global-search-overlay"
      >
        <div
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={mode === 'studio' ? 'Search artifacts, todos, commands…' : 'Run a command — coordinator, escalations, jump…'}
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
              data-testid="global-search-input"
            />
            <kbd className="text-3xs font-mono text-gray-400 border border-gray-300 dark:border-gray-600 rounded px-1">Esc</kbd>
          </div>

          <div
            ref={listRef}
            className="max-h-96 overflow-y-auto"
            data-testid="global-search-results"
          >
            {loading && (
              <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">Searching…</div>
            )}
            {error && !loading && (
              <div className="px-4 py-3 text-xs text-danger-600 dark:text-danger-400">{error}</div>
            )}
            {!loading && !error && totalItems === 0 && (
              <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                {query.trim() ? 'No results' : 'No commands available'}
              </div>
            )}
            {/* Mode-aware commands first. */}
            {filteredCommands.map((c, idx) => {
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-result-idx={idx}
                  data-testid={`global-search-command-${c.id}`}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => c.run()}
                  className={`w-full text-left px-4 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700/50 ${
                    isSelected ? 'bg-accent-50 dark:bg-accent-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <span className="text-accent-500 shrink-0 text-xs">⌘</span>
                  <span className="flex-1 min-w-0 text-sm text-gray-900 dark:text-white truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">{c.hint}</span>}
                </button>
              );
            })}
            {!loading && results.map((r, ri) => {
              const idx = filteredCommands.length + ri;
              const isSelected = idx === selectedIdx;
              const key = `${r.kind}:${r.filePath}:${r.line ?? 'x'}:${r.snippetId ?? 'x'}:${idx}`;
              return (
                <button
                  key={key}
                  type="button"
                  data-result-idx={idx}
                  data-testid={`global-search-result-${ri}`}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => handleResultClick(r)}
                  className={`w-full text-left px-4 py-2 flex items-start gap-3 border-b border-gray-100 dark:border-gray-700/50 ${
                    isSelected
                      ? 'bg-info-50 dark:bg-info-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <div className="pt-1">
                    {r.kind === 'code' ? <KindIconCode /> : <KindIconPseudo />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {basename(r.filePath)}
                      </span>
                      {r.methodName && (
                        <span className="text-xs font-mono text-success-600 dark:text-success-400 truncate">
                          {r.methodName}
                        </span>
                      )}
                      {r.line != null && (
                        <span className="text-3xs text-gray-400">:{r.line}</span>
                      )}
                    </div>
                    <div
                      className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate mt-0.5"
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                    <div className="text-3xs text-gray-400 truncate mt-0.5">
                      {r.filePath}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3 text-3xs text-gray-400">
            <span><kbd className="font-mono">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono">Enter</kbd> Open</span>
            <span><kbd className="font-mono">Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    );
  }, [isOpen, query, loading, error, results, selectedIdx, handleInputKeyDown, handleResultClick, closeOverlay, filteredCommands, totalItems, mode]);

  return (
    <>
      {overlay && createPortal(overlay, document.body)}
      <LinkAndNavigateDialog
        open={linkDialogOpen}
        onClose={() => {
          setLinkDialogOpen(false);
          setLinkCandidate(null);
        }}
        candidate={linkCandidate}
        symbolName={linkSymbolName}
        onConfirm={handleLinkConfirm}
      />
    </>
  );
};

GlobalSearch.displayName = 'GlobalSearch';

export default GlobalSearch;
