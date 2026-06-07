/**
 * CommandBar — the Bridge's top identity + glance strip (BR-2, design §2/§8).
 *
 * It absorbs the deleted AlertRibbon: instead of a separate banner, the
 * at-a-glance fleet pulse lives inline here — `● N live · M in-flight ·
 * ▲ K needs you`. The "needs you" count is the single earned red; everything
 * else stays calm. Also hosts the project selector (the only place it lives).
 */

import React, { useState, useRef, useEffect } from 'react';

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export interface CommandBarProps {
  project: string;
  projectOptions: string[];
  onSelectProject: (project: string) => void;
  /** Open the add-project dialog. Omit to hide the add control. */
  onAddProject?: () => void;
  /** Remove a project (path) from the Bridge. Omit to hide remove controls. */
  onRemoveProject?: (path: string) => void;
  liveCount: number;
  inflightCount: number;
  needsYouCount: number;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  project,
  projectOptions,
  onSelectProject,
  onAddProject,
  onRemoveProject,
  liveCount,
  inflightCount,
  needsYouCount,
}) => {
  // Custom project dropdown (replaces the native <select>) so it can host
  // per-project remove (×) and an add action — "manage projects from the dropdown".
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  return (
    <div
      data-testid="bridge-command-bar"
      className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700"
    >
      <span className="text-base" role="img" aria-label="bridge">⤢</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bridge</span>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          data-testid="bridge-project-select"
          onClick={() => setMenuOpen((o) => !o)}
          title={project || 'Manage projects'}
          className="flex items-center gap-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 outline-none max-w-[240px] hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <span className="truncate">{project ? projectBasename(project) : 'Select project'}</span>
          <svg className={`w-3 h-3 shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {menuOpen && (
          <div
            data-testid="bridge-project-menu"
            className="absolute left-0 top-full mt-1 z-50 w-64 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
          >
            {projectOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No projects</div>
            ) : (
              projectOptions.map((p) => (
                <div
                  key={p}
                  className={`group flex items-center gap-1 px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    p === project ? 'bg-gray-50 dark:bg-gray-700/50' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { onSelectProject(p); setMenuOpen(false); }}
                    title={p}
                    className="flex-1 min-w-0 text-left truncate text-gray-800 dark:text-gray-200"
                  >
                    {p === project && <span className="text-accent-500 mr-1">•</span>}
                    {projectBasename(p)}
                  </button>
                  {onRemoveProject && (
                    <button
                      type="button"
                      data-testid="bridge-project-remove"
                      title={`Remove ${projectBasename(p)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove project "${projectBasename(p)}" from the Bridge?\n\nUnregisters it; files on disk are untouched.`)) {
                          onRemoveProject(p);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-gray-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-opacity"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>
              ))
            )}
            {onAddProject && (
              <>
                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                <button
                  type="button"
                  data-testid="bridge-project-add"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddProject();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-600 dark:text-accent-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Add project…
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Glanceable pulse — absorbed AlertRibbon. */}
      <div data-testid="bridge-glance" className="ml-auto flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
          <span className="text-success-500" aria-hidden="true">●</span>
          {liveCount} live
        </span>
        <span className="text-gray-600 dark:text-gray-300">{inflightCount} in-flight</span>
        <span
          className={`flex items-center gap-1 font-medium ${
            needsYouCount > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span aria-hidden="true">▲</span>
          {needsYouCount} needs you
        </span>
      </div>
    </div>
  );
};

export default CommandBar;
