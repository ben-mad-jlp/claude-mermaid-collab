import { createPortal } from 'react-dom';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getHistory, type ComposerHistoryEntry } from '@/stores/composerDraftStore';

interface HistorySearchPopoverProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  onSelect: (entry: ComposerHistoryEntry) => void;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function HistorySearchPopover({ open, onClose, sessionId, onSelect }: HistorySearchPopoverProps) {
  const [entries, setEntries] = useState<ComposerHistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setEntries(getHistory(sessionId));
    setQuery('');
    setActiveIndex(0);
  }, [open, sessionId]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(e => e.plain.toLowerCase().includes(q));
  }, [entries, query]);

  useEffect(() => { setActiveIndex(0); }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => (i + 1) % Math.max(filtered.length, 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => (i - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)); }
      if (e.key === 'Enter' && filtered[activeIndex]) { handleSelect(filtered[activeIndex]!); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, filtered, activeIndex, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onClose]);

  const handleSelect = (entry: ComposerHistoryEntry) => {
    onSelect(entry);
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      data-testid="history-search-popover"
      className="fixed z-50 bg-white dark:bg-gray-800 border border-stone-200 dark:border-gray-700 rounded-lg shadow-xl max-w-lg w-full"
      style={{ bottom: '120px', left: '50%', transform: 'translateX(-50%)' }}
    >
      <div className="flex items-center gap-2 p-3 border-b border-stone-200 dark:border-gray-700">
        <span id={titleId} className="sr-only">Search prompt history</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search history…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-500"
          aria-label="Search prompt history"
          data-testid="history-search-input"
        />
        <button type="button" onClick={onClose} aria-label="Close history search" className="text-stone-400 hover:text-stone-700 dark:hover:text-white text-lg leading-none px-1">×</button>
      </div>
      <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Prompt history">
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-sm text-gray-400 text-center">No history matches</div>
        )}
        {filtered.map((entry, i) => (
          <button
            key={entry.ts}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            data-testid={`history-entry-${i}`}
            onClick={() => handleSelect(entry)}
            onMouseEnter={() => setActiveIndex(i)}
            className={`w-full text-left px-4 py-2.5 border-b border-stone-100 dark:border-gray-700/50 last:border-0 flex flex-col gap-0.5 hover:bg-stone-100 dark:hover:bg-gray-700 ${
              i === activeIndex ? 'bg-blue-50 dark:bg-blue-900/30' : ''
            }`}
          >
            <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
              {entry.plain.length > 80 ? entry.plain.slice(0, 80) + '…' : entry.plain}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{formatTs(entry.ts)}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
