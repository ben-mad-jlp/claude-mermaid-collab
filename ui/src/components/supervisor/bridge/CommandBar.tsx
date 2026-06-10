/**
 * CommandBar — the Bridge's top identity + glance strip (BR-2, design §2/§8).
 *
 * It absorbs the deleted AlertRibbon: instead of a separate banner, the
 * at-a-glance FLEET pulse lives inline here — `● N live · M in-flight ·
 * ▲ K needs you` (fleet-summed). The "needs you" count is the single earned red;
 * everything else stays calm. Project switching moved to the ProjectRail
 * (design-tabbed-bridge §3b) — the dropdown that used to live here is gone.
 */

import React from 'react';
import { OrchestratorLadder } from './OrchestratorLadder';

export interface CommandBarProps {
  liveCount: number;
  inflightCount: number;
  needsYouCount: number;
  /** Routing scope (kept for API compatibility). */
  serverScope: string;
  /** Active project. */
  project?: string;
  /** Re-fetch all Bridge data for the current scope. */
  onRefresh?: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  liveCount,
  inflightCount,
  needsYouCount,
  project,
  onRefresh,
}) => {
  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : null;
  return (
    <div
      data-testid="bridge-command-bar"
      className="px-4 py-2 border-b border-gray-200 dark:border-gray-700"
    >
      {/* Row 1 — identity + project + the Orchestrator level ladder. */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bridge</span>
        {/* Active project — the Bridge is per-project. */}
        {projectName && (
          <span
            data-testid="bridge-project-name"
            title={project}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate max-w-[160px]"
          >
            {projectName}
          </span>
        )}
        {onRefresh && (
          <button
            type="button"
            data-testid="bridge-refresh"
            title="Refresh bridge data"
            aria-label="Refresh bridge data"
            onClick={onRefresh}
            className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}

        {/* Per-project Orchestrator level ladder — moved here from the sidebar
            rows (it crowded the supervisor cards). Scoped to the active project. */}
        {project && (
          <div className="ml-auto">
            <OrchestratorLadder project={project} />
          </div>
        )}
      </div>

      {/* Row 2 — glanceable FLEET pulse (absorbed AlertRibbon), moved below the
          identity row so the numbers read as a dedicated status line. */}
      <div data-testid="bridge-glance" className="mt-1.5 flex items-center gap-3 text-xs">
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
