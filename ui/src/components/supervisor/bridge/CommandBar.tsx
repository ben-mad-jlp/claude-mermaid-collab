/**
 * CommandBar — the Bridge's top identity + glance strip (BR-2, design §2/§8).
 *
 * It absorbs the deleted AlertRibbon: instead of a separate banner, the
 * at-a-glance FLEET pulse lives inline here — `● N live · M in-flight ·
 * ▲ K needs you` (fleet-summed). The "needs you" count is the single earned red;
 * everything else stays calm. Project switching moved to the ProjectRail
 * (design-tabbed-bridge §3b) — the dropdown that used to live here is gone.
 *
 * Design feedback 2026-07-13: the header is a clean, well-spaced STATUS line only.
 * The per-project daemon controls (⚙ nodes matrix, concurrency, autonomy ladder)
 * that used to crowd this row now live in the mission inspector pane
 * (MissionDetailPanel), reachable by clicking the mission strip.
 */

import React from 'react';
import { OrchestratorLadder } from './OrchestratorLadder';
import { ConductorLadder } from './ConductorLadder';

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
  /** Active project. */
  project?: string;
  /** Re-fetch all Bridge data for the current scope. */
  onRefresh?: () => void;
  /** Open the per-project settings modal (gear button). */
  onOpenSettings?: () => void;
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
  onOpenSettings,
}) => {
  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : null;
  return (
    <div
      data-testid="bridge-command-bar"
      className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700"
    >
      {/* Row 1 — identity + project + per-project autonomy off/on/auto ladder
          (OrchestratorLadder), rendered inline in this header row. */}
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bridge</span>
        {projectName && (
          <span
            data-testid="bridge-project-name"
            title={project}
            className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate max-w-[220px]"
          >
            {projectName}
          </span>
        )}
        {project && <OrchestratorLadder project={project} />}
        {project && <ConductorLadder project={project} />}
        {onRefresh && (
          <button
            type="button"
            data-testid="bridge-refresh"
            title="Refresh bridge data"
            aria-label="Refresh bridge data"
            onClick={onRefresh}
            className="ml-auto p-1 rounded text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            data-testid="bridge-settings"
            title="Project settings"
            aria-label="Project settings"
            onClick={onOpenSettings}
            className={`${onRefresh ? '' : 'ml-auto '}p-1 rounded text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>

      {/* Row 2 — glanceable totals. Mirrors the left-column project card's row-2
          indicators (same glyphs + colors) so the Bridge top line and the card
          never disagree: ● live · in-flight · ▲ needs-you · ⬇ to-land · open · ▶ · ⊘ · ⚠ parked. */}
      <div data-testid="bridge-glance" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
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
