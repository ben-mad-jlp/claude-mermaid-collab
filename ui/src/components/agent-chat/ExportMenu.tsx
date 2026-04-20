import { useEffect, useRef, useState } from 'react';

export interface ExportMenuProps {
  onCopyTurn?: () => void;
  onExportTurn?: () => void;
  onExportSession?: () => void;
}

export function ExportMenu({ onCopyTurn, onExportTurn, onExportSession }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleItem = (handler?: () => void) => {
    if (!handler) return;
    handler();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label="Export menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="px-2 py-1 text-gray-500 hover:text-gray-700 rounded"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[160px] bg-white border border-gray-200 rounded shadow-md z-10"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!onCopyTurn}
            onClick={() => handleItem(onCopyTurn)}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Copy turn
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onExportTurn}
            onClick={() => handleItem(onExportTurn)}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Export turn
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onExportSession}
            onClick={() => handleItem(onExportSession)}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            Export session
          </button>
        </div>
      )}
    </div>
  );
}
