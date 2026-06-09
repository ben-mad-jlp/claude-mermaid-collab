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
}

export const CommandBar: React.FC<CommandBarProps> = ({
  liveCount,
  inflightCount,
  needsYouCount,
  project,
}) => {
  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : null;
  return (
    <div
      data-testid="bridge-command-bar"
      className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700"
    >
      <span className="text-base" role="img" aria-label="bridge">⤢</span>
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

      {/* Per-project Orchestrator level ladder — moved here from the sidebar
          rows (it crowded the supervisor cards). Scoped to the active project. */}
      {project && (
        <div className="ml-auto">
          <OrchestratorLadder project={project} />
        </div>
      )}

      {/* Glanceable FLEET pulse — absorbed AlertRibbon. */}
      <div data-testid="bridge-glance" className={`flex items-center gap-3 text-xs ${project ? '' : 'ml-auto'}`}>
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
