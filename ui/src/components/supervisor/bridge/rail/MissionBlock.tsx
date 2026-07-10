import React, { useState } from 'react';
import { stripKindPrefix } from '@/lib/todoKind';
import { useSupervisorStore, type MissionSummary } from '@/stores/supervisorStore';
import {
  PHASE_STYLE,
  PHASE_LABEL,
  phaseTooltip,
  isTerminalPhase,
  epicDotClass,
  Gauge,
  CriteriaEditor,
  missionView,
  isMissionCompleted,
} from './missionShared';
import { MissionSwitcher } from './MissionSwitcher';
import { useMissions } from './useMissions';

export interface MissionBlockProps {
  serverId: string;
  project: string;
  session?: string;
}

export const MissionBlock: React.FC<MissionBlockProps> = ({ serverId, project, session }) => {
  const { missions, run } = useMissions(serverId, project);

  const addMissionCriterion = useSupervisorStore((s) => s.addMissionCriterion);
  const updateMissionCriterion = useSupervisorStore((s) => s.updateMissionCriterion);
  const removeMissionCriterion = useSupervisorStore((s) => s.removeMissionCriterion);

  const [goalOpen, setGoalOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Find the ONE active mission, else the first non-completed, else null
  const m = missions.find((m) => m.mission?.active !== false)
    ?? missions.find((m) => !isMissionCompleted(m))
    ?? null;

  if (!m) {
    // Empty state: just show the switcher
    return (
      <div data-testid="mission-block" className="flex items-center gap-2 px-3 py-2">
        <span className="text-3xs text-gray-400 dark:text-gray-500 italic">no active mission</span>
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
    );
  }

  const view = missionView(m);

  return (
    <div data-testid="mission-block" className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 space-y-2">
      {/* Title + Phase pill */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-snug">
          {stripKindPrefix(m.node?.title ?? 'Mission')}
        </span>
        <span
          data-testid="mission-phase-pill"
          className={`shrink-0 text-3xs font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${PHASE_STYLE[view.phase]}`}
          title={phaseTooltip(view.phase)}
        >
          Phase: {PHASE_LABEL[view.phase]}
        </span>
      </div>

      {/* Owner row */}
      {view.owner && (
        <div
          data-testid="mission-owner"
          className="flex items-center gap-1 text-3xs text-gray-400 dark:text-gray-500"
          title="The session that owns / drives this mission."
        >
          <span aria-hidden>◷</span>
          <span className="font-mono truncate">session: {view.owner}</span>
        </div>
      )}

      {/* Iteration + badges */}
      <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
        <span
          className="font-mono"
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
            className="text-success-600 dark:text-success-400 font-semibold"
            title="All criteria met — goal achieved (VERIFY passed)."
          >
            converged ✓
          </span>
        )}
        {view.stopped && !view.converged && (
          <span
            data-testid="mission-stopped"
            className="text-gray-500 dark:text-gray-400 font-semibold"
            title={`Loop stopped: ${view.stopReason ?? 'reached a terminal state'}.`}
          >
            stopped{view.stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        )}
      </div>

      {/* Procedure blurb */}
      {view.procedure && (
        <div
          className="text-3xs text-gray-500 dark:text-gray-400 leading-snug line-clamp-2 border-l-2 border-gray-200 dark:border-gray-700 pl-1.5"
          title={`Each iteration:\n${view.procedure}`}
        >
          <span className="uppercase tracking-wide text-gray-400 dark:text-gray-500">each iter:</span> {view.procedure}
        </div>
      )}

      {/* Goal gauge */}
      <Gauge
        label="Goal"
        met={view.cap.met}
        total={view.cap.total}
        tone="goal"
        headerTitle="Acceptance criteria met — the real 'is the goal achieved' gauge. Click to see / edit the criteria."
        countTitle="Acceptance criteria met / total."
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
        headerTitle="This iteration's epics done / total (the current build work). Click to see the epics."
        countTitle="Epics done / total this iteration."
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

      {/* Footer: active marker + switcher */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-700/60">
        <span className="text-3xs text-success-600 dark:text-success-400 px-1" title="This is the active mission for its session.">● active</span>
        <button
          type="button"
          onClick={() => setSwitcherOpen(!switcherOpen)}
          data-testid="mission-switcher-btn"
          className="text-3xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Switch missions"
        >
          Missions ▾
        </button>
      </div>

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
  );
};

export default MissionBlock;
