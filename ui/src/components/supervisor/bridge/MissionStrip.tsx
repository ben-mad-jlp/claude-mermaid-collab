/**
 * MissionStrip — a thin, clickable SUMMARY of the active mission.
 *
 * Design feedback 2026-07-13: this bar shows a glanceable summary only
 * (title · status · iteration · mini Goal/Build gauges). Clicking anywhere on it
 * opens the mission detail in the shared inspector pane (MissionDetailPanel) —
 * the same on-demand pane epic/todo detail uses. The old inline `Missions ▾`
 * dropdown and the expandable gauge popovers moved into that pane.
 */

import React from 'react';
import { stripKindPrefix } from '@/lib/todoKind';
import { StatusPill, missionView, isMissionCompleted } from './rail/missionShared';
import { useMissions } from './rail/useMissions';

export interface MissionStripProps {
  serverId: string;
  project: string;
  session?: string;
  /** Open the mission detail in the shared inspector pane. */
  onOpenMissions: () => void;
}

/** A tiny read-only met/total gauge for the summary bar. */
const MiniGauge: React.FC<{ label: string; met: number; total: number; tone: 'goal' | 'build' }> = ({
  label,
  met,
  total,
  tone,
}) => {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  const fill = tone === 'goal' ? 'bg-success-500' : 'bg-info-500';
  return (
    <div className="shrink-0 min-w-[4.5rem]" title={`${label}: ${met}/${total} met`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-3xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
        <span className="text-2xs font-mono tabular-nums text-gray-600 dark:text-gray-300">{met}/{total}</span>
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className={`h-1 ${fill} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const MissionStrip: React.FC<MissionStripProps> = ({ serverId, project, onOpenMissions }) => {
  const { missions } = useMissions(serverId, project);

  const m = missions.find((m) => m.mission?.active !== false && !isMissionCompleted(m))
    ?? missions.find((m) => !isMissionCompleted(m))
    ?? null;

  // No active mission — still a click target so the pane (switcher + New) is reachable.
  if (!m) {
    return (
      <button
        type="button"
        data-testid="mission-strip"
        onClick={onOpenMissions}
        title="Open missions"
        className="flex w-full items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
      >
        <span className="text-3xs text-gray-400 dark:text-gray-500 italic" data-testid="mission-strip-idle-label">
          No active mission{missions.length > 0 ? ` (${missions.length} total)` : ''}
        </span>
        <span className="ml-auto shrink-0 text-3xs text-gray-400 dark:text-gray-500">Missions ›</span>
      </button>
    );
  }

  const view = missionView(m);

  return (
    <button
      type="button"
      data-testid="mission-strip"
      onClick={onOpenMissions}
      title="Open mission detail"
      className="flex w-full items-center gap-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
    >
      {/* Mission title */}
      <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 min-w-0 truncate">
        {stripKindPrefix(m.node?.title ?? 'Mission')}
      </span>

      {/* Status pill */}
      <StatusPill status={view.status} />

      {/* Terminal badges */}
      <div className="flex items-center gap-1 text-3xs text-gray-500 dark:text-gray-400 shrink-0">
        {view.stopped && !view.converged && (
          <span data-testid="mission-stopped" className="text-gray-500 dark:text-gray-400 font-semibold whitespace-nowrap">
            stopped{view.stopReason === 'max-iterations' ? ' (max iters)' : ''}
          </span>
        )}
      </div>

      {/* Read-only mini gauges */}
      <MiniGauge label="Goal" met={view.cap.met} total={view.cap.total} tone="goal" />
      <MiniGauge label="Build" met={view.mech.done} total={view.mech.total} tone="build" />
    </button>
  );
};

export default MissionStrip;
