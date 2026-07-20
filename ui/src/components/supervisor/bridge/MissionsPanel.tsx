/**
 * MissionsPanel — the Bridge "Missions" tab (HOME rail, above Plan). A read-only overview list of the
 * project's convergence missions: title, derived status, criteria progress (met/total), and serving
 * epics. Reuses the existing useMissions poll hook (GET /api/supervisor/missions). Clicking a mission
 * jumps to its mission todo via onSelectTodo (when provided) so the detail/stage view can take over.
 */
import React from 'react';
import { useMissions } from './rail/useMissions';
import type { MissionSummary } from '@/stores/supervisorStore';

interface MissionsPanelProps {
  serverId: string;
  project: string;
  onOpenMission?: (missionTodoId: string) => void;
}

/** Status → pill colour. Converged = green, stopped/abandoned = red, active/building = blue, else gray. */
function statusTone(m: MissionSummary): string {
  const s = (m.rollup.status ?? m.node.status ?? '').toLowerCase();
  if (m.rollup.converged || s === 'converged') return 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300';
  if (m.rollup.stopped || s === 'abandoned' || s === 'stopped') return 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300';
  if (s === 'unapproved') return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
}

function statusLabel(m: MissionSummary): string {
  if (m.rollup.converged) return 'converged';
  if (m.rollup.stopped) return 'stopped';
  return (m.rollup.status ?? m.node.status ?? 'active').toString();
}

export const MissionsPanel: React.FC<MissionsPanelProps> = ({ serverId, project, onOpenMission }) => {
  const { missions } = useMissions(serverId, project);

  return (
    <div className="p-2" data-testid="missions-panel">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Missions</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{missions.length}</span>
      </div>

      {missions.length === 0 ? (
        <div className="px-1 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
          No missions for this project.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {missions.map((m) => {
            const cap = m.rollup.capability;
            const clickable = !!onOpenMission;
            return (
              <li key={m.node.id}>
                <button
                  type="button"
                  data-testid="mission-row"
                  disabled={!clickable}
                  onClick={() => onOpenMission?.(m.mission.todoId)}
                  title={clickable ? 'Open mission detail' : undefined}
                  className={`w-full text-left rounded border border-gray-200 dark:border-gray-700 px-2.5 py-2 bg-white dark:bg-gray-900 ${clickable ? 'hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{m.node.title}</span>
                    <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-3xs font-semibold ${statusTone(m)}`}>
                      {statusLabel(m)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-3xs tabular-nums text-gray-500 dark:text-gray-400">
                    <span title="criteria met / total">
                      criteria <span className="font-semibold text-gray-700 dark:text-gray-200">{cap.met}/{cap.total}</span>
                    </span>
                    <span title="serving epics">
                      epics <span className="font-semibold text-gray-700 dark:text-gray-200">{m.epics.length}</span>
                    </span>
                    <span title="convergence iteration">
                      iter <span className="font-semibold text-gray-700 dark:text-gray-200">{m.rollup.iteration}{m.rollup.maxIterations ? `/${m.rollup.maxIterations}` : ''}</span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default MissionsPanel;
