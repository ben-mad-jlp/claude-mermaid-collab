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
import { MissionCard, MissionCreateDialog, MissionDetail, isMissionCompleted } from '../rail/missionShared';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const completedCount = missions.filter(isMissionCompleted).length;
  // Active mission first, then the rest; completed hidden unless toggled.
  const shown = (showCompleted ? missions : missions.filter((m) => !isMissionCompleted(m)))
    .slice()
    .sort((a, b) => Number(b.mission?.active !== false) - Number(a.mission?.active !== false));

  // Effective selected mission: explicit selection, active mission, or first shown.
  const selected = missions.find((m) => m.node?.id === selectedId)
    ?? missions.find((m) => m.mission?.active !== false)
    ?? shown[0];

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

      {/* Mission detail view */}
      {missions.length === 0 ? (
        <div className="text-3xs italic text-gray-400 dark:text-gray-500">
          No missions yet — click "+ New mission" to start a convergence loop.
        </div>
      ) : shown.length === 0 ? (
        <div className="text-3xs italic text-gray-400 dark:text-gray-500">
          All {completedCount} mission{completedCount === 1 ? '' : 's'} completed — check "Show completed" to view.
        </div>
      ) : selected ? (
        <>
          <MissionDetail
            m={selected}
            serverId={serverId}
            project={project}
            onChanged={(next: MissionSummary[]) => setMissions(next)}
          />

          {/* Inactive missions carousel */}
          {shown.length > 1 && (
            <div data-testid="mission-inactive-carousel" className="flex gap-2 overflow-x-auto pb-2">
              {shown
                .filter((m) => m.node?.id !== selected.node?.id)
                .map((m) => (
                  <div
                    key={m.node?.id}
                    onClick={() => setSelectedId(m.node?.id ?? null)}
                    className="cursor-pointer"
                  >
                    <MissionCard
                      m={m}
                      serverId={serverId}
                      project={project}
                      onChanged={(next: MissionSummary[]) => setMissions(next)}
                    />
                  </div>
                ))}
            </div>
          )}
        </>
      ) : null}

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
