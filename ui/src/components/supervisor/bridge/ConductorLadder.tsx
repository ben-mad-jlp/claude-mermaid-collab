/**
 * ConductorLadder — per-project 2-stop segmented control for the AUTONOMOUS CONDUCTOR, sitting right
 * next to the daemon on/off ladder (OrchestratorLadder) in the Bridge CommandBar. Same look + feel as
 * the daemon toggle, but backed by the conductor-enable endpoint via the existing useConductorEnabled
 * hook. Replaces the former read-only ConductorStatusBadge so the switch is toggleable in place
 * instead of buried in project settings.
 *
 * Levels: off · on. Default OFF (opt-in autonomy). GET/POST /api/supervisor/conductor (in the hook).
 */
import React, { useCallback } from 'react';
import { useConductorEnabled } from './useConductorEnabled';

type ConductorLevel = 'off' | 'on';
const LEVELS: ConductorLevel[] = ['off', 'on'];

const LEVEL_TITLE: Record<ConductorLevel, string> = {
  off: 'Conductor off — no autonomous mission-driving for this project.',
  on: 'Conductor on — autonomously drives the active mission: grounds gaps, files + approves serving epics for the daemon to build & land, and runs the independent verify.',
};

/** Per-stop heat, matching the daemon ladder: off = neutral gray, on = green. Only the active
 *  stop is bright. */
const STOP_ACTIVE: Record<ConductorLevel, string> = {
  off: 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200',
  on: 'bg-success-500 dark:bg-success-600 text-white',
};

export interface ConductorLadderProps {
  project: string;
}

export const ConductorLadder: React.FC<ConductorLadderProps> = ({ project }) => {
  const { enabled, busy, setEnabled } = useConductorEnabled(project);
  const loaded = enabled !== null;
  // Optimistic default OFF until the GET resolves (matches the backend default).
  const level: ConductorLevel = enabled ? 'on' : 'off';

  const handleSelect = useCallback(
    (next: ConductorLevel) => {
      if (busy || !project || next === level) return;
      void setEnabled(next === 'on');
    },
    [busy, project, level, setEnabled],
  );

  return (
    <div
      data-testid="conductor-ladder"
      data-project={project}
      data-enabled={String(!!enabled)}
      title={LEVEL_TITLE[level]}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 transition-opacity ${busy ? 'opacity-60' : ''} ${loaded ? '' : 'opacity-50'} border-gray-300 dark:border-gray-600`}
    >
      {/* Label so the two adjacent off/on ladders (daemon vs conductor) are distinguishable. */}
      <span className="shrink-0 px-1.5 py-0.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
        Conductor
      </span>
      {LEVELS.map((stop) => {
        const isActive = stop === level;
        const dim = 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700';
        const segColor = isActive ? STOP_ACTIVE[stop] : dim;
        return (
          <button
            key={stop}
            type="button"
            data-testid={`conductor-stop-${stop}`}
            data-active={isActive}
            disabled={busy}
            onClick={() => handleSelect(stop)}
            title={LEVEL_TITLE[stop]}
            className={`px-1.5 py-0.5 transition-colors cursor-pointer disabled:cursor-not-allowed border-l border-gray-300 dark:border-gray-600 ${segColor}`}
          >
            {stop}
          </button>
        );
      })}
    </div>
  );
};

export default ConductorLadder;
