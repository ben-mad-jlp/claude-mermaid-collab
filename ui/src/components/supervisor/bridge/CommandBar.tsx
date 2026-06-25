/**
 * CommandBar — the Bridge's top identity + glance strip (BR-2, design §2/§8).
 *
 * It absorbs the deleted AlertRibbon: instead of a separate banner, the
 * at-a-glance FLEET pulse lives inline here — `● N live · M in-flight ·
 * ▲ K needs you` (fleet-summed). The "needs you" count is the single earned red;
 * everything else stays calm. Project switching moved to the ProjectRail
 * (design-tabbed-bridge §3b) — the dropdown that used to live here is gone.
 */

import React, { useState } from 'react';
import { OrchestratorLadder } from './OrchestratorLadder';
import { PoolSizeControl } from './PoolSizeControl';
import { DaemonNodesMatrix } from '@/components/settings/DaemonNodesMatrix';
import { DaemonProviderControl } from '@/components/settings/DaemonProviderControl';

export interface CommandBarProps {
  liveCount: number;
  inflightCount: number;
  needsYouCount: number;
  /** Epics ready to land (positive prompt) — shown with a download glyph, not red. */
  landReadyCount?: number;
  /** Plan stats mirrored from the project card: open / in-progress / blocked / parked. */
  openCount?: number;
  inProgressCount?: number;
  blockedCount?: number;
  parked?: boolean;
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
  landReadyCount = 0,
  openCount = 0,
  inProgressCount = 0,
  blockedCount = 0,
  parked = false,
  project,
  onRefresh,
}) => {
  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : null;
  const [showNodes, setShowNodes] = useState(false);
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
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              data-testid="bridge-nodes-toggle"
              data-open={showNodes}
              onClick={() => setShowNodes((v) => !v)}
              title="Per-node model & effort for this project's daemon workers"
              className={`flex items-center rounded border px-1.5 py-0.5 text-3xs font-medium shrink-0 cursor-pointer border-gray-300 dark:border-gray-600 ${showNodes ? 'bg-info-500 dark:bg-info-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              ⚙ nodes
            </button>
            <PoolSizeControl project={project} />
            <OrchestratorLadder project={project} />
          </div>
        )}
      </div>

      {/* Per-node-kind model + effort matrix for the leaf-executor's claude workers,
          scoped to the active project. Toggled from the ⚙ nodes button above. */}
      {project && showNodes && (
        <div className="mt-2 rounded border border-gray-200 dark:border-gray-700 p-2 bg-white/60 dark:bg-gray-900/40">
          <div className="mb-2 pb-2 border-b border-gray-200/70 dark:border-gray-700/70">
            <DaemonProviderControl project={project} />
          </div>
          <DaemonNodesMatrix project={project} />
        </div>
      )}

      {/* Row 2 — glanceable totals. Mirrors the left-column project card's row-2
          indicators (same glyphs + colors) so the Bridge top line and the card
          never disagree: ● live · in-flight · ▲ needs-you · ⬇ to-land · open · ▶ · ⊘ · ⚠ parked. */}
      <div data-testid="bridge-glance" className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
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
        {landReadyCount > 0 && (
          <span className="flex items-center gap-1 font-semibold text-info-700 dark:text-info-400" title={`${landReadyCount} epic${landReadyCount === 1 ? '' : 's'} ready to land`}>
            {/* download glyph = 'ready to ship to master' — matches the project card + Land tab */}
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10 2a1 1 0 011 1v7.586l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 10.586V3a1 1 0 011-1z" />
              <path d="M3 14a1 1 0 011 1v1a1 1 0 001 1h10a1 1 0 001-1v-1a1 1 0 112 0v1a3 3 0 01-3 3H5a3 3 0 01-3-3v-1a1 1 0 011-1z" />
            </svg>
            {landReadyCount} to land
          </span>
        )}
        {openCount > 0 && <span className="text-gray-600 dark:text-gray-300">{openCount} open</span>}
        {inProgressCount > 0 && <span className="text-info-700 dark:text-info-400">{inProgressCount}▶</span>}
        {blockedCount > 0 && <span className="text-warning-700 dark:text-warning-400">{blockedCount}⊘</span>}
        {parked && <span className="text-warning-700 dark:text-warning-400">⚠ parked</span>}
      </div>
    </div>
  );
};

export default CommandBar;
