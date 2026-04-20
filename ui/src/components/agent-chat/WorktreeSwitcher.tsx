import React, { useState, useRef, useEffect } from 'react';

export interface WorktreeEntry {
  sessionId: string;
  path: string;
  branch?: string;
}

export interface WorktreeSwitcherProps {
  worktrees: Array<WorktreeEntry>;
  activeSessionId?: string;
  onSwitch: (sessionId: string) => void;
}

/**
 * Dropdown pill for switching between active worktrees. Shows the current
 * worktree's branch (or path fallback) and opens a list on click.
 */
export const WorktreeSwitcher: React.FC<WorktreeSwitcherProps> = ({
  worktrees,
  activeSessionId,
  onSwitch,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const active = worktrees.find((w) => w.sessionId === activeSessionId) ?? worktrees[0];
  const label = active ? active.branch ?? active.path : 'No worktree';

  const handlePick = (sessionId: string) => {
    setOpen(false);
    onSwitch(sessionId);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-label="Worktree switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono rounded-full border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors max-w-[16rem] truncate"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden className="text-gray-500">▾</span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 left-0 min-w-[14rem] max-w-[22rem] max-h-64 overflow-auto rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-lg text-xs"
        >
          {worktrees.length === 0 ? (
            <li className="px-3 py-2 text-gray-500">No worktrees</li>
          ) : (
            worktrees.map((w) => {
              const isActive = w.sessionId === activeSessionId;
              return (
                <li key={w.sessionId} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    onClick={() => handlePick(w.sessionId)}
                    className={`w-full text-left px-3 py-1.5 flex flex-col gap-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      isActive ? 'bg-gray-50 dark:bg-gray-800 font-semibold' : ''
                    }`}
                  >
                    <span className="font-mono truncate">{w.branch ?? '(no branch)'}</span>
                    <span className="text-[10px] text-gray-500 truncate">{w.path}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};

export default WorktreeSwitcher;
