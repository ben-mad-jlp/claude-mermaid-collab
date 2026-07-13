/**
 * MissionDetailPanel — the inspector's "mission" view.
 *
 * Opened by clicking the MissionStrip (design feedback 2026-07-13): the mission
 * bar is now a thin summary, and ALL mission detail + switching + the per-project
 * daemon controls live here, in the same on-demand inspector pane that epic/todo
 * detail already uses. This absorbs what used to be crammed into the CommandBar
 * (⚙ nodes matrix, concurrency, the autonomy ladder) and the MissionStrip's inline
 * `Missions ▾` dropdown + gauge popovers.
 */

import React, { useState } from 'react';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';
import { OrchestratorLadder } from '../OrchestratorLadder';
import { PoolSizeControl } from '../PoolSizeControl';
import { DaemonNodesMatrix } from '@/components/settings/DaemonNodesMatrix';
import { DaemonProviderControl } from '@/components/settings/DaemonProviderControl';
import { MissionCard, MissionCreateDialog, isMissionCompleted } from '../rail/missionShared';
import { useMissions } from '../rail/useMissions';

export interface MissionDetailPanelProps {
  serverId: string;
  project: string;
  session?: string;
}

export const MissionDetailPanel: React.FC<MissionDetailPanelProps> = ({ serverId, project, session }) => {
  const { missions, setMissions } = useMissions(serverId, project);
  const createMission = useSupervisorStore((s) => s.createMission);

  const [showCompleted, setShowCompleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const completedCount = missions.filter(isMissionCompleted).length;
  // Active mission first, then the rest; completed hidden unless toggled.
  const shown = (showCompleted ? missions : missions.filter((m) => !isMissionCompleted(m)))
    .slice()
    .sort((a, b) => Number(b.mission?.active !== false) - Number(a.mission?.active !== false));

  return (
    <div data-testid="inspector-missions" className="flex flex-col gap-3 p-3 h-full min-h-0 overflow-y-auto">
      {/* Header: title + New mission */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">Missions</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="mission-new-btn"
          className="text-3xs px-1.5 py-0.5 rounded border border-info-200 dark:border-info-800 text-info-700 dark:text-info-300 hover:bg-info-50 dark:hover:bg-info-900/30 transition-colors"
          title="Create a new convergence mission"
        >
          + New mission
        </button>
      </div>

      {completedCount > 0 && (
        <label
          className="flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 cursor-pointer select-none"
          title="Show missions that have converged or stopped."
        >
          <input
            type="checkbox"
            data-testid="missions-show-completed"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="h-3 w-3 rounded border-gray-300 dark:border-gray-600"
          />
          Show completed ({completedCount})
        </label>
      )}

      {/* Mission cards (active first) */}
      {missions.length === 0 ? (
        <div className="text-3xs italic text-gray-400 dark:text-gray-500">
          No missions yet — click “+ New mission” to start a convergence loop.
        </div>
      ) : shown.length === 0 ? (
        <div className="text-3xs italic text-gray-400 dark:text-gray-500">
          All {completedCount} mission{completedCount === 1 ? '' : 's'} completed — check “Show completed” to view.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((m) => (
            <MissionCard
              key={m.node?.id}
              m={m}
              serverId={serverId}
              project={project}
              onChanged={(next: MissionSummary[]) => setMissions(next)}
            />
          ))}
        </div>
      )}

      {/* Per-project daemon controls — moved out of the CommandBar header. */}
      <div className="mt-1 border-t border-gray-200 dark:border-gray-700 pt-3">
        <button
          type="button"
          onClick={() => setShowControls((v) => !v)}
          data-testid="mission-controls-toggle"
          aria-expanded={showControls}
          className="flex w-full items-center justify-between text-3xs uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          title="Per-project daemon autonomy, concurrency, and per-node model/effort."
        >
          <span>Daemon controls</span>
          <span className="inline-block w-2 text-gray-400 dark:text-gray-500">{showControls ? '▾' : '▸'}</span>
        </button>
        {showControls && (
          <div className="mt-2 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <OrchestratorLadder project={project} />
              <PoolSizeControl project={project} />
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 bg-white/60 dark:bg-gray-900/40">
              <div className="mb-2 pb-2 border-b border-gray-200/70 dark:border-gray-700/70">
                <DaemonProviderControl project={project} />
              </div>
              <DaemonNodesMatrix project={project} />
            </div>
          </div>
        )}
      </div>

      {creating && (
        <MissionCreateDialog
          defaultSession={session}
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            const next = await createMission(serverId, project, body);
            setMissions(next);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
};

export default MissionDetailPanel;
