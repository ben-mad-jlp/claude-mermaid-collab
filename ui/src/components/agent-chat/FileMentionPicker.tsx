import { useEffect, useMemo, useRef, useState } from 'react';

export interface FileMentionPickerProps {
  /**
   * Controlled mode: when defined, the parent owns the query. The component
   * skips its own query state derivation and filters against this value.
   * When undefined, legacy uncontrolled behavior is used (query is supplied
   * externally anyway, but internal textarea flow is retained).
   */
  query?: string;
  /** Controlled-mode positioning anchor. When provided, fixed-positioned. */
  anchorRect?: DOMRect;
  files?: string[];
  onSelect?: (path: string) => void;
  onDismiss: () => void;
}

function fuzzyFilter(items: string[], query: string): string[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter((item) => item.toLowerCase().includes(q));
}

export function FileMentionPicker({
  query,
  anchorRect,
  files,
  onSelect,
  onDismiss,
}: FileMentionPickerProps) {
  const effectiveQuery = query ?? '';
  const isControlled = query !== undefined;
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch when no files prop provided
  useEffect(() => {
    if (files !== undefined) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const url = `/api/worktree/files?q=${encodeURIComponent(effectiveQuery)}`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : { files: [] }))
        .then((data) => {
          const list: string[] = Array.isArray(data)
            ? data
            : Array.isArray(data?.files)
              ? data.files
              : [];
          setFetched(list);
        })
        .catch(() => setFetched([]));
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [effectiveQuery, files]);

  const results = useMemo(() => {
    if (files !== undefined) return fuzzyFilter(files, effectiveQuery);
    // Server may have already filtered; apply a light filter too for safety
    return fetched ? fuzzyFilter(fetched, effectiveQuery) : [];
  }, [files, fetched, effectiveQuery]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, effectiveQuery]);

  const handleSelect = (path: string) => {
    if (onSelect) onSelect(path);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          results.length ? (i - 1 + results.length) % results.length : 0,
        );
      } else if (e.key === 'Enter') {
        if (results.length > 0) {
          e.preventDefault();
          handleSelect(results[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, activeIndex, onSelect, onDismiss]);

  const positionStyle =
    isControlled && anchorRect
      ? {
          position: 'fixed' as const,
          top: anchorRect.bottom,
          left: anchorRect.left,
        }
      : undefined;

  const containerClass = isControlled
    ? 'z-50 max-h-60 w-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800'
    : 'absolute bottom-full left-0 mb-1 max-h-60 w-72 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800';

  if (results.length === 0) {
    return (
      <div
        role="listbox"
        aria-label="File mentions"
        data-testid="file-mention-picker"
        style={positionStyle}
        className={containerClass}
      >
        <div className="px-3 py-2 text-sm text-gray-500">No files</div>
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="File mentions"
      data-testid="file-mention-picker"
      style={positionStyle}
      className={containerClass}
    >
      {results.map((path, i) => (
        <button
          key={path}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          data-testid={`file-mention-item-${i}`}
          onClick={() => handleSelect(path)}
          onMouseEnter={() => setActiveIndex(i)}
          className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
            i === activeIndex
              ? 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100'
              : 'text-gray-800 dark:text-gray-200'
          }`}
        >
          {path}
        </button>
      ))}
    </div>
  );
}

export default FileMentionPicker;
