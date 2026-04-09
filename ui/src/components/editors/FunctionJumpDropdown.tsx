/**
 * FunctionJumpDropdown Component
 *
 * Searchable combobox in the CodeEditor toolbar listing all functions in the
 * current linked file. Click a row to scroll the editor to that function.
 *
 * Data source is Tier 1 (pseudo-db) with Tier 2 (regex) fallback — handled by
 * the parent. This component is display-only.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface FunctionJumpItem {
  name: string;
  sourceLine: number | null;
  isExported: boolean;
  params: string;
  kind: string | null;
  visibility: string | null;
}

export interface FunctionJumpDropdownProps {
  functions: FunctionJumpItem[];
  onJump: (line: number) => void;
}

export const FunctionJumpDropdown: React.FC<FunctionJumpDropdownProps> = ({
  functions,
  onJump,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const count = functions.length;
  const isEmpty = count === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return functions;
    return functions.filter(fn => fn.name.toLowerCase().includes(q));
  }, [functions, query]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  // Focus search input when dropdown opens; reset query + highlight
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightedIndex(0);
      // Defer focus to after the portal renders
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Clamp highlighted index when filtered changes
  useEffect(() => {
    if (highlightedIndex >= filtered.length) {
      setHighlightedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered, highlightedIndex]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  // Capture/update anchor rect when open
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const update = () => {
      if (buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (isEmpty) return;
    setIsOpen(prev => !prev);
  }, [isEmpty]);

  const handleSelect = useCallback((fn: FunctionJumpItem) => {
    if (fn.sourceLine == null) return;
    onJump(fn.sourceLine);
    setIsOpen(false);
  }, [onJump]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const fn = filtered[highlightedIndex];
      if (fn) handleSelect(fn);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  }, [filtered, highlightedIndex, handleSelect]);

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        data-testid="function-jump-button"
        onClick={handleToggle}
        disabled={isEmpty}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={isEmpty ? 'No functions found' : `Jump to function (${count})`}
        title={isEmpty ? 'No functions found' : `Jump to function (${count})`}
        className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
      >
        <span aria-hidden="true" className="font-mono">{'{ }'}</span>
        <span>{count}</span>
      </button>

      {isOpen && anchorRect && !isEmpty && createPortal(
        <div
          ref={dropdownRef}
          data-testid="function-jump-dropdown"
          role="listbox"
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden flex flex-col"
          style={{
            position: 'fixed',
            top: anchorRect.bottom + 4,
            left: anchorRect.left,
            width: 360,
            maxHeight: 360,
            zIndex: 50,
          }}
        >
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <input
              ref={searchInputRef}
              data-testid="function-jump-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search functions…"
              className="w-full px-2 py-1 text-sm bg-transparent border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
            />
          </div>
          <ul
            ref={listRef}
            className="flex-1 overflow-y-auto py-1"
            role="presentation"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
                No matches
              </li>
            )}
            {filtered.map((fn, idx) => {
              const disabled = fn.sourceLine == null;
              const highlighted = idx === highlightedIndex;
              return (
                <li
                  key={`${fn.name}-${idx}`}
                  data-index={idx}
                  data-testid="function-jump-item"
                  role="option"
                  aria-selected={highlighted}
                  aria-disabled={disabled}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => !disabled && handleSelect(fn)}
                  className={[
                    'px-3 py-1.5 flex items-center gap-2 text-sm cursor-pointer',
                    highlighted ? 'bg-blue-50 dark:bg-blue-900/30' : '',
                    disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${fn.isExported ? 'bg-green-500' : 'bg-transparent border border-gray-300 dark:border-gray-600'}`}
                    aria-label={fn.isExported ? 'exported' : 'internal'}
                    title={fn.isExported ? 'exported' : 'internal'}
                  />
                  <span className="font-mono font-bold text-gray-900 dark:text-gray-100 truncate">
                    {fn.name}
                  </span>
                  <span className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate flex-1">
                    {fn.params}
                  </span>
                  <span className="font-mono text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-auto">
                    {fn.sourceLine == null ? '?' : `:${fn.sourceLine}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
};

FunctionJumpDropdown.displayName = 'FunctionJumpDropdown';

export default FunctionJumpDropdown;
