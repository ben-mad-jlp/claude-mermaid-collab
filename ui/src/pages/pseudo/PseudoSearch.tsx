/**
 * PseudoSearch Component
 *
 * Cmd+K search overlay for pseudocode files:
 * - Semi-transparent overlay with centered search box
 * - Debounced search (200ms) with keyboard navigation
 * - Results grouped by file (max 3 matches per file)
 * - Function signatures truncated to 60 chars
 * - Highlighted selection: bg-purple-50
 * - Keyboard: ArrowDown/Up to navigate, Enter to select, Esc to close
 * - Click outside to close, click result to navigate
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { searchPseudo, type SearchResult, type SearchMatch } from '../../lib/pseudo-api';

export type PseudoSearchProps = {
  project: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (stem: string, functionName?: string) => void;
};

/**
 * Flat list entry combining file context with match
 */
type FlatResult = {
  file: string;
  fileStem: string;
  match: SearchMatch;
  globalIndex: number;
};

/**
 * Extract file stem from filename (e.g., 'api.pseudo' -> 'api')
 */
function getFileStem(filename: string): string {
  return filename.replace(/\.pseudo$/, '');
}

/**
 * Truncate line to max 60 characters with ellipsis
 */
function truncateLine(line: string, maxLen: number = 60): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen) + '...';
}

export default function PseudoSearch({
  project,
  isOpen,
  onClose,
  onNavigate,
}: PseudoSearchProps): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten results for easier keyboard navigation
  const flatResults: FlatResult[] = React.useMemo(() => {
    const flat: FlatResult[] = [];
    let globalIndex = 0;

    results.forEach((result) => {
      const fileStem = getFileStem(result.file);
      // Only show first 3 matches per file
      const limitedMatches = result.matches.slice(0, 3);
      limitedMatches.forEach((match) => {
        flat.push({
          file: result.file,
          fileStem,
          match,
          globalIndex,
        });
        globalIndex++;
      });
    });

    return flat;
  }, [results]);

  // Handle search with debounce
  const performSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setHighlightedIndex(-1);
        return;
      }

      setLoading(true);
      searchPseudo(project, searchQuery)
        .then((data) => {
          setResults(data);
          setHighlightedIndex(-1); // Reset highlight on new search
          setLoading(false);
        })
        .catch((error) => {
          console.error('Search error:', error);
          setResults([]);
          setHighlightedIndex(-1);
          setLoading(false);
        });
    },
    [project]
  );

  // Debounced search on query change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(query);
    }, 200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < flatResults.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < flatResults.length) {
          const item = flatResults[highlightedIndex];
          onNavigate(item.fileStem, item.match.functionName ?? undefined);
          onClose();
        }
      }
    },
    [flatResults, highlightedIndex, onNavigate, onClose]
  );

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Check if click is on overlay background (not on search container)
      if (overlayRef.current === e.target) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen, onClose]);

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Group results by file for display (max 8 files)
  const groupedResults = results.slice(0, 8);

  return (
    <div
      ref={overlayRef}
      data-testid="overlay"
      className="fixed inset-0 bg-black/40 flex items-start justify-center pt-24 z-50"
    >
      <div className="w-full max-w-2xl mx-auto px-4">
        {/* Search Box Container */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="border-b border-stone-200 p-4">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search pseudocode..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full outline-none text-sm"
              style={{ color: '#1c1917' }}
            />
          </div>

          {/* Results Dropdown */}
          {query.trim() && (
            <div className="max-h-96 overflow-y-auto">
              {loading && (
                <div className="p-4 text-center text-sm" style={{ color: '#78716c' }}>
                  Searching...
                </div>
              )}

              {!loading && flatResults.length === 0 && (
                <div className="p-4 text-center text-sm" style={{ color: '#78716c' }}>
                  No results found
                </div>
              )}

              {!loading && flatResults.length > 0 && (
                <div>
                  {groupedResults.map((fileResult) => {
                    const fileStem = getFileStem(fileResult.file);
                    const limitedMatches = fileResult.matches.slice(0, 3);

                    return (
                      <div key={fileResult.file}>
                        {/* File Header */}
                        <div
                          className="px-4 py-2 text-xs font-medium"
                          style={{ color: '#a8a29e' }}
                        >
                          {fileStem}.pseudo
                        </div>

                        {/* Matches for this file */}
                        {limitedMatches.map((match, matchIdx) => {
                          const globalIdx = flatResults.findIndex(
                            (r) =>
                              r.file === fileResult.file && r.match === match
                          );

                          return (
                            <button
                              key={`${fileResult.file}-${matchIdx}`}
                              onClick={() => {
                                onNavigate(fileStem, match.functionName ?? undefined);
                                onClose();
                              }}
                              className={`w-full text-left px-4 py-2 border-b border-stone-100 text-sm transition-colors ${
                                globalIdx === highlightedIndex
                                  ? 'bg-purple-50'
                                  : 'hover:bg-stone-50'
                              }`}
                              style={{
                                color: '#44403c',
                              }}
                            >
                              <div className="font-medium">
                                {match.functionName}
                              </div>
                              <div
                                className="text-xs truncate"
                                style={{ color: '#78716c' }}
                              >
                                {truncateLine(match.line)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
