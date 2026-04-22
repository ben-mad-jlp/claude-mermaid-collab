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
import { usePendingJump } from '@/stores/pendingJump';
import { useGlobalSearch } from '@/stores/globalSearch';
import { fetchCodeSearch, type CodeSearchResult } from '@/lib/code-search-api';
import { linkFile } from '@/lib/link-file';
import { LinkAndNavigateDialog } from '@/components/editors/LinkAndNavigateDialog';
import type { SourceLinkCandidate } from '@/lib/pseudo-api';
import type { Snippet } from '@/types';

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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0">
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

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => (results.length === 0 ? 0 : Math.min(i + 1, results.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[selectedIdx];
      if (r) handleResultClick(r);
      return;
    }
  }, [results, selectedIdx, handleResultClick, closeOverlay]);

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
              placeholder="Search pseudo files and linked snippets…"
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
              data-testid="global-search-input"
            />
            <kbd className="text-[10px] font-mono text-gray-400 border border-gray-300 dark:border-gray-600 rounded px-1">Esc</kbd>
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
              <div className="px-4 py-3 text-xs text-red-600 dark:text-red-400">{error}</div>
            )}
            {!loading && !error && query.trim() && results.length === 0 && (
              <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">No results</div>
            )}
            {!loading && results.map((r, idx) => {
              const isSelected = idx === selectedIdx;
              const key = `${r.kind}:${r.filePath}:${r.line ?? 'x'}:${r.snippetId ?? 'x'}:${idx}`;
              return (
                <button
                  key={key}
                  type="button"
                  data-result-idx={idx}
                  data-testid={`global-search-result-${idx}`}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => handleResultClick(r)}
                  className={`w-full text-left px-4 py-2 flex items-start gap-3 border-b border-gray-100 dark:border-gray-700/50 ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30'
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
                        <span className="text-xs font-mono text-green-600 dark:text-green-400 truncate">
                          {r.methodName}
                        </span>
                      )}
                      {r.line != null && (
                        <span className="text-[10px] text-gray-400">:{r.line}</span>
                      )}
                    </div>
                    <div
                      className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate mt-0.5"
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                    <div className="text-[10px] text-gray-400 truncate mt-0.5">
                      {r.filePath}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3 text-[10px] text-gray-400">
            <span><kbd className="font-mono">↑↓</kbd> Navigate</span>
            <span><kbd className="font-mono">Enter</kbd> Open</span>
            <span><kbd className="font-mono">Esc</kbd> Close</span>
          </div>
        </div>
      </div>
    );
  }, [isOpen, query, loading, error, results, selectedIdx, handleInputKeyDown, handleResultClick, closeOverlay]);

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
