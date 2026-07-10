import React, { useEffect, useRef, useState } from 'react';
import { stripKindPrefix } from '@/lib/todoKind';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  PHASE_STYLE,
  PHASE_LABEL,
  phaseTooltip,
  isTerminalPhase,
  MissionEditDialog,
  MissionCreateDialog,
  missionView,
  isMissionCompleted,
  MiniButton,
} from './missionShared';

export interface MissionSwitcherProps {
  serverId: string;
  project: string;
  session?: string;
  missions: MissionSummary[];
  onChanged: () => void;
}

export const MissionSwitcher: React.FC<MissionSwitcherProps> = ({ serverId, project, session, missions, onChanged }) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingMission, setEditingMission] = useState<MissionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmActivate, setConfirmActivate] = useState<{ m: MissionSummary; phase: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const activateMission = useSupervisorStore((s) => s.activateMission);
  const updateMission = useSupervisorStore((s) => s.updateMission);
  const deleteMission = useSupervisorStore((s) => s.deleteMission);

  // Close popover on Escape or outside click
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChanged();
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onChanged();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onChanged]);

  const completedCount = missions.filter(isMissionCompleted).length;
  const shown = showCompleted ? missions : missions.filter((m) => !isMissionCompleted(m));

  const doActivate = async (m: MissionSummary) => {
    const view = missionView(m);
    if (isTerminalPhase(view.phase)) {
      setConfirmActivate({ m, phase: view.phase });
      return;
    }
    try {
      if (view.missionId) {
        await activateMission(serverId, project, view.missionId);
        onChanged();
      }
    } catch (e) {
      console.error('Failed to activate mission:', e);
    }
  };

  const doEdit = async (m: MissionSummary, patch: any) => {
    const view = missionView(m);
    try {
      if (view.missionId) {
        await updateMission(serverId, project, view.missionId, patch);
        setEditingMission(null);
        onChanged();
      }
    } catch (e) {
      console.error('Failed to update mission:', e);
    }
  };

  const doDelete = async (missionId: string | undefined) => {
    if (!missionId) return;
    try {
      await deleteMission(serverId, project, missionId);
      setConfirmDelete(null);
      onChanged();
    } catch (e) {
      console.error('Failed to delete mission:', e);
    }
  };

  return (
    <div
      ref={popoverRef}
      data-testid="mission-switcher-popover"
      className="absolute z-40 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 min-w-60 max-h-96 overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="mission-new-btn"
          className="w-full text-3xs px-1.5 py-0.5 rounded border border-info-200 dark:border-info-800 text-info-700 dark:text-info-300 hover:bg-info-50 dark:hover:bg-info-900/30 transition-colors"
          title="Create a new convergence mission"
        >
          + New mission
        </button>

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
      </div>

      {/* Empty states */}
      {missions.length === 0 ? (
        <div className="px-3 py-2 text-3xs italic text-gray-400 dark:text-gray-500">
          No missions yet — click "+ New mission" to start a convergence loop.
        </div>
      ) : shown.length === 0 ? (
        <div className="px-3 py-2 text-3xs italic text-gray-400 dark:text-gray-500">
          All {completedCount} mission{completedCount === 1 ? '' : 's'} completed — check "Show completed" to view.
        </div>
      ) : (
        // Mission rows
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {shown.map((m) => {
            const view = missionView(m);
            const active = view.active;

            return (
              <div
                key={m.node?.id}
                data-testid="mission-switcher-row"
                data-active={active}
                className={`px-3 py-2 space-y-1 ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'border-dashed opacity-60'
                }`}
              >
                {/* Title + phase pill */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-3xs font-semibold text-gray-800 dark:text-gray-100 line-clamp-2">
                    {!active && (
                      <span className="shrink-0 text-3xs font-normal not-italic text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-gray-600 rounded px-1 mr-1" title="Paused">
                        paused
                      </span>
                    )}
                    {stripKindPrefix(m.node?.title ?? 'Mission')}
                  </span>
                  <span
                    className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${PHASE_STYLE[view.phase]}`}
                    title={phaseTooltip(view.phase)}
                  >
                    {PHASE_LABEL[view.phase]}
                  </span>
                </div>

                {/* Iteration */}
                <div className="text-3xs text-gray-500 dark:text-gray-400 font-mono">
                  iter {view.iteration}{view.maxIterations != null ? `/${view.maxIterations}` : ''}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 pt-1">
                  {!active && (
                    <MiniButton
                      onClick={() => void doActivate(m)}
                      tone="primary"
                      title="Make this the active mission"
                      testid="mission-activate-btn"
                    >
                      Activate
                    </MiniButton>
                  )}
                  <MiniButton
                    onClick={() => setEditingMission(m)}
                    title="Edit goal / description / procedure / cap"
                    testid="mission-edit-btn"
                  >
                    Edit
                  </MiniButton>
                  <MiniButton
                    onClick={() => setConfirmDelete(view.missionId || null)}
                    tone="danger"
                    title="Delete this mission"
                    testid="mission-delete-btn"
                  >
                    Delete
                  </MiniButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      {editingMission && (
        <MissionEditDialog
          m={editingMission}
          onClose={() => setEditingMission(null)}
          onSave={(patch) => doEdit(editingMission, patch)}
        />
      )}

      {/* Create dialog */}
      {creating && (
        <MissionCreateDialog
          defaultSession={session}
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            try {
              await useSupervisorStore.getState().createMission(serverId, project, body);
              setCreating(false);
              onChanged();
            } catch (e) {
              console.error('Failed to create mission:', e);
            }
          }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          isOpen
          title="Delete mission?"
          message={<>Permanently delete this mission? This drops the mission node, its loop state, and all criteria. This cannot be undone.</>}
          confirmLabel="Delete permanently"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete)}
        />
      )}

      {/* Activate terminal mission confirmation */}
      {confirmActivate && (
        <ConfirmDialog
          isOpen
          title="Re-activate a completed mission?"
          message={<>This mission has already <strong>{confirmActivate.phase}</strong>. Re-activating it makes it the session's active mission, but the loop won't re-drive a terminal mission. Continue?</>}
          confirmLabel="Activate anyway"
          onCancel={() => setConfirmActivate(null)}
          onConfirm={() => {
            void doActivate(confirmActivate.m);
            setConfirmActivate(null);
          }}
        />
      )}
    </div>
  );
};

export default MissionSwitcher;
