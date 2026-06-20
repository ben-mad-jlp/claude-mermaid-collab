import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface PaneLinesPopoverProps {
  project: string;
  session: string;
  /** Fetch raw capture-pane text on demand. NOT a stream. */
  onFetch: (project: string, session: string) => Promise<string>;
}

export const PaneLinesPopover: React.FC<PaneLinesPopoverProps> = ({ project, session, onFetch }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onFetch(project, session);
      setLines(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setLines('');
    } finally {
      setLoading(false);
    }
  }, [onFetch, project, session]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void load();
  };

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        data-testid="pane-lines-trigger"
        onClick={toggle}
        className="text-3xs text-gray-500 dark:text-gray-400 hover:underline transition-colors"
      >
        {open ? 'hide lines' : 'show the lines it read'}
      </button>
      {open && (
        <div
          data-testid="pane-lines-popover"
          className="absolute z-20 mt-1 left-0 w-[28rem] max-w-[80vw] max-h-64 overflow-auto rounded border border-gray-700 bg-gray-900 text-gray-100 text-3xs font-mono whitespace-pre p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-1 sticky top-0 bg-gray-900 pb-1 border-b border-gray-700">
            <span className="text-gray-400 font-semibold">raw pane</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                className="text-accent-400 hover:text-accent-300 underline"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-300 leading-none"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          {loading && <div className="text-gray-400 mt-1">loading…</div>}
          {!loading && error && <div className="text-danger-400 mt-1">{error}</div>}
          {!loading && !error && (
            <pre className="whitespace-pre m-0 mt-1">
              {lines || <span className="text-gray-500">(no output)</span>}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default PaneLinesPopover;
