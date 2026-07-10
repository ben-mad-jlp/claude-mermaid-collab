/**
 * MissionsStrip — surfaces convergence-loop MISSIONS distinctly at the TOP of the
 * Plan board. A [MISSION] node is otherwise invisible (just another work-graph
 * todo on the board); this strip renders one card per mission with its PHASE, the
 * GOAL gauge (acceptance criteria met/total — the real convergence gauge), and a
 * secondary BUILD gauge (this iteration's [EPIC] children done/total). Each gauge
 * row EXPANDS to list its underlying items (criteria / epics).
 *
 * AUTHORING (write) surface — the strip lets a human curate WHAT a mission is:
 *   • switch the active mission (activate)      • edit goal / description / procedure / cap
 *   • add / edit-text / remove criteria         • create a new mission          • delete
 * DELIBERATELY steward/MCP-only (NOT here): setting a criterion's met/unmet VERDICT
 * (independent VERIFY, maker≠checker) and advancing the PHASE (the autonomous loop
 * owns phase). Mutations RE-FETCH (no optimistic update — can't race the 15s poll).
 *
 * Data comes from GET /api/supervisor/missions via supervisorStore.fetchMissions
 * (fail-open → []). Renders NOTHING when there are zero missions AND no session to
 * create one under. Refetches on mount + project/session change; polls on cadence.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';
import {
  MissionCard,
  MissionCreateDialog,
  isMissionCompleted,
} from './bridge/rail/missionShared';

export interface MissionsStripProps {
  serverId: string;
  project: string;
  /** Optional: the live session, used as the default owner when creating a mission. */
  session?: string;
}

export const MissionsStrip: React.FC<MissionsStripProps> = ({ serverId, project, session }) => {
  const fetchMissions = useSupervisorStore((s) => s.fetchMissions);
  const createMission = useSupervisorStore((s) => s.createMission);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    // Show ALL of the PROJECT's missions on its board — NOT session-scoped. A mission
    // owns a session (shown on the card) but must stay visible on its project board
    // regardless of which session is active, else it looks like a plain [EPIC].
    const load = async () => {
      const next = await fetchMissions(serverId, project);
      if (alive) setMissions(next);
    };
    void load();
    // Poll on a modest cadence so phase/gauges track the loop without a WS event.
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [serverId, project, fetchMissions]);

  // Render nothing only when there are no missions AND nothing to create under —
  // but keep the header available so a human can author the first mission when a
  // session is known.
  if (missions.length === 0 && !session) return null;

  const completedCount = missions.filter(isMissionCompleted).length;
  const shown = showCompleted ? missions : missions.filter((m) => !isMissionCompleted(m));

  return (
    <div
      data-testid="missions-strip"
      className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
    >
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Missions
        </span>
        <span className="text-3xs text-gray-400 dark:text-gray-500">
          convergence loop
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="mission-new-btn"
          className="ml-1 text-3xs px-1.5 py-0.5 rounded border border-info-200 dark:border-info-800 text-info-700 dark:text-info-300 hover:bg-info-50 dark:hover:bg-info-900/30 transition-colors"
          title="Create a new convergence mission"
        >
          + New mission
        </button>
        {completedCount > 0 && (
          <label
            className="ml-auto flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 cursor-pointer select-none"
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
      </div>
      <div className="flex gap-2 overflow-x-auto px-3 py-2 items-start">
        {missions.length === 0 ? (
          <span className="px-1 text-3xs italic text-gray-400 dark:text-gray-500">
            No missions yet — click “+ New mission” to start a convergence loop.
          </span>
        ) : shown.length === 0 ? (
          <span className="px-1 text-3xs italic text-gray-400 dark:text-gray-500">
            All {completedCount} mission{completedCount === 1 ? '' : 's'} completed — check “Show completed” to view.
          </span>
        ) : (
          shown.map((m) => (
            <MissionCard
              key={m.node?.id ?? m.mission?.todoId}
              m={m}
              serverId={serverId}
              project={project}
              onChanged={setMissions}
            />
          ))
        )}
      </div>

      {creating && (
        <MissionCreateDialog
          defaultSession={session}
          onClose={() => setCreating(false)}
          onCreate={async (body) => { setMissions(await createMission(serverId, project, body)); }}
        />
      )}
    </div>
  );
};

export default MissionsStrip;
