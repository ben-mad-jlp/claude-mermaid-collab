/**
 * ProjectRail — the vertical project index for the multi-project Bridge
 * (design-tabbed-bridge §2/§3). One row per watched project, urgency-sorted so
 * "which project needs you" is answered by where the eye lands. Scrolls
 * vertically (the cheap direction) and never overflows horizontally.
 *
 * Sections: "Needs you" (open escalations > 0, then idle-with-work) always
 * visible, red-first; "Quiet" folded into a single disclosure. A type-to-filter
 * input is the palette fallback at scale; `+ Add project` and a dim
 * "detected · watch+" affordance for live-but-unwatched projects round it out.
 *
 * Pure presentational: it receives already-built per-project row data and the
 * handlers; all counts derive from selectOpenEscalationsByProject upstream.
 */
import React, { useMemo, useState } from 'react';
import { ProjectRailRow, type ProjectRailRowData } from './ProjectRailRow';

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export interface ProjectRailProps {
  projects: ProjectRailRowData[];
  activeProject: string;
  onSelect: (project: string) => void;
  onAdd: () => void;
  onRemove: (project: string) => void;
  /** Live-but-unwatched project paths (supervised/subscriptions − watched). */
  detected?: string[];
  onWatch?: (project: string) => void;
}

export const ProjectRail: React.FC<ProjectRailProps> = ({
  projects,
  activeProject,
  onSelect,
  onAdd,
  onRemove,
  detected = [],
  onWatch,
}) => {
  const [filter, setFilter] = useState('');
  const [showQuiet, setShowQuiet] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.project.toLowerCase().includes(q));
  }, [projects, filter]);

  // Urgency sort: red (most escalations first) → amber idle-with-work → quiet
  // (alphabetical). A project is "needs you" iff red or idle-with-work.
  const { needsYou, quiet } = useMemo(() => {
    const rank = (p: ProjectRailRowData) => (p.escalationCount > 0 ? 0 : p.idleWithWork ? 1 : 2);
    const sorted = [...filtered].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (a.escalationCount !== b.escalationCount) return b.escalationCount - a.escalationCount;
      return a.name.localeCompare(b.name);
    });
    return {
      needsYou: sorted.filter((p) => rank(p) < 2),
      quiet: sorted.filter((p) => rank(p) === 2),
    };
  }, [filtered]);

  // When filtering, surface everything that matched (don't bury quiet matches).
  const quietForced = filter.trim().length > 0;
  const quietVisible = showQuiet || quietForced;

  return (
    <div
      data-testid="project-rail"
      className="flex flex-col w-48 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 min-h-0"
    >
      <div className="p-1.5 border-b border-gray-200 dark:border-gray-700">
        <input
          data-testid="project-rail-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="⌕ filter…"
          className="w-full text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-400"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-0.5">
        {needsYou.length === 0 && quiet.length === 0 && (
          <div className="px-2 py-2 text-2xs text-gray-400 dark:text-gray-500">No projects</div>
        )}

        {needsYou.map((p) => (
          <ProjectRailRow
            key={p.project}
            data={p}
            active={p.project === activeProject}
            onSelect={() => onSelect(p.project)}
            onRemove={() => onRemove(p.project)}
          />
        ))}

        {quiet.length > 0 && (
          <>
            {!quietForced && (
              <button
                type="button"
                data-testid="project-rail-quiet-toggle"
                onClick={() => setShowQuiet((s) => !s)}
                className="w-full flex items-center gap-1 px-2 py-1 text-2xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <span className={`transition-transform ${quietVisible ? 'rotate-90' : ''}`}>▸</span>
                {quiet.length} quiet
              </button>
            )}
            {quietVisible &&
              quiet.map((p) => (
                <ProjectRailRow
                  key={p.project}
                  data={p}
                  active={p.project === activeProject}
                  onSelect={() => onSelect(p.project)}
                  onRemove={() => onRemove(p.project)}
                />
              ))}
          </>
        )}

        {detected.length > 0 && onWatch && (
          <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
            <div className="px-2 text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">detected</div>
            {detected.map((p) => (
              <button
                key={p}
                type="button"
                data-testid="project-rail-detected"
                onClick={() => onWatch(p)}
                title={`Watch ${p}`}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <span className="inline-block w-2 h-2 rounded-full border border-dashed border-gray-400 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-left">{projectBasename(p)}</span>
                <span className="shrink-0 text-3xs text-accent-600 dark:text-accent-400">watch+</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="project-rail-add"
        onClick={onAdd}
        className="m-1 flex items-center justify-center gap-1 px-2 py-1 text-xs text-accent-600 dark:text-accent-400 border border-dashed border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Add project
      </button>
    </div>
  );
};

export default ProjectRail;
