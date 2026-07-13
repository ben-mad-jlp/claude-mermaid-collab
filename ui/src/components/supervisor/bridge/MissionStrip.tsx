import React, { useState } from 'react';
import { stripKindPrefix } from '@/lib/todoKind';
import { useSupervisorStore } from '@/stores/supervisorStore';
import {
  StatusPill,
  epicDotClass,
  Gauge,
  CriteriaEditor,
  missionView,
  isMissionCompleted,
} from './rail/missionShared';
import { MissionSwitcher } from './rail/MissionSwitcher';
import { useMissions } from './rail/useMissions';

export interface MissionStripProps {
  serverId: string;
  project: string;
  session?: string;
}

export const MissionStrip: React.FC<MissionStripProps> = ({ serverId, project, session }) => {
  const { missions, run } = useMissions(serverId, project);

  const addMissionCriterion = useSupervisorStore((s) => s.addMissionCriterion);
  const updateMissionCriterion = useSupervisorStore((s) => s.updateMissionCriterion);
  const removeMissionCriterion = useSupervisorStore((s) => s.removeMissionCriterion);

  const [goalOpen, setGoalOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const m = missions.find((m) => m.mission?.active !== false)
    ?? missions.find((m) => !isMissionCompleted(m))
    ?? null;

  if (!m) {
    return (
      <div data-testid="mission-strip" className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <span className="text-3xs text-gray-400 dark:text-gray-500 italic">no active mission</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen(!switcherOpen)}
            data-testid="mission-switcher-btn"
            className="text-3xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Switch missions"
          >
            Missions ▾
          </button>
          {switcherOpen && (
            <MissionSwitcher
              serverId={serverId}
              project={project}
              session={session}
              missions={missions}
              onChanged={() => setSwitcherOpen(false)}
            />
          )}
        </div>
      </div>
    );
  }

  const view = missionView(m);

  return (
    <div data-testid="mission-strip" className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-x-auto">
      {/* Mission title */}
      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 shrink-0 whitespace-nowrap">
        {stripKindPrefix(m.node?.title ?? 'Mission')}
      </span>

      {/* Status pill */}
      <StatusPill status={view.status} />

      {/* Iteration + badges */}
      <div className="flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 shrink-0">
        <span
          className="font-mono whitespace-nowrap"
          title={
            view.maxIterations != null
              ? `Iteration ${view.iteration} of a max ${view.maxIterations} (STOP-WHEN cap).`
              : `Iteration ${view.iteration} — laps around the loop (no cap set).`
          }
        >
          iter {view.iteration}{view.maxIterations != null ? `/${view.maxIterations}` : ''}
        </span>
        {view.converged && (
          <span
            data-testid="mission-converged"
            className="text-success-600 dark:text-success-400 font-semibold whitespace-nowrap"
            title="All criteria met — goal achieved (VERIFY passed)."
          >
            converged ✓
          </span>
        )}
        {view.stopped && !view.converged && (
          <span
            data-testid="mission-stopped"
            className="text-gray-500 dark:text-gray-400 font-semibold whitespace-nowrap"
            title={`Loop stopped: ${view.stopReason ?? 'reached a terminal state'}.`}
          >
            stopped{view.stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        )}
      </div>

      {/* Goal gauge */}
      <Gauge
        label="Goal"
        met={view.cap.met}
        total={view.cap.total}
        tone="goal"
        open={goalOpen}
        onToggle={() => setGoalOpen((v) => !v)}
        testid="mission-goal-toggle"
      >
        <CriteriaEditor
          criteria={view.criteria}
          onAdd={(text) => run(() => addMissionCriterion(serverId, project, view.missionId!, text))}
          onEdit={(id, text) => run(() => updateMissionCriterion(serverId, project, id, text))}
          onRemove={(id) => run(() => removeMissionCriterion(serverId, project, id))}
        />
      </Gauge>

      {/* Build gauge */}
      <Gauge
        label="Build"
        met={view.mech.done}
        total={view.mech.total}
        tone="build"
        secondary
        open={buildOpen}
        onToggle={() => setBuildOpen((v) => !v)}
        testid="mission-build-toggle"
      >
        {view.epics.length === 0 ? (
          <span className="text-3xs text-gray-400 dark:text-gray-500 italic">none yet</span>
        ) : (
          view.epics.map((e) => (
            <div key={e.id} className="flex items-start gap-1 text-3xs leading-snug" title={`${e.status}${e.acceptanceStatus ? ` · ${e.acceptanceStatus}` : ''}`}>
              <span className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${epicDotClass(e.status)}`} aria-hidden />
              <span className="text-gray-600 dark:text-gray-300 truncate">
                {stripKindPrefix(e.title)}
              </span>
              <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 lowercase">
                {e.status}
              </span>
            </div>
          ))
        )}
      </Gauge>

      {/* Mission switcher */}
      <div className="relative ml-auto shrink-0">
        <button
          type="button"
          onClick={() => setSwitcherOpen(!switcherOpen)}
          data-testid="mission-switcher-btn"
          className="text-3xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Switch missions"
        >
          Missions ▾
        </button>
        {switcherOpen && (
          <MissionSwitcher
            serverId={serverId}
            project={project}
            session={session}
            missions={missions}
            onChanged={() => setSwitcherOpen(false)}
          />
        )}
      </div>
    </div>
  );
};

export default MissionStrip;
