/**
 * ConductorLadder — per-project 2-stop segmented control for the AUTONOMOUS CONDUCTOR, sitting right
 * next to the daemon on/off ladder (OrchestratorLadder) in the Bridge CommandBar. Same look + feel as
 * the daemon toggle, but backed by the conductor-enable endpoint via the existing useConductorEnabled
 * hook. Replaces the former read-only ConductorStatusBadge so the switch is toggleable in place
 * instead of buried in project settings.
 *
 * Levels: off · on. Default OFF (opt-in autonomy). GET/POST /api/supervisor/conductor (in the hook).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useConductorEnabled, apiGet } from './useConductorEnabled';

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

  // The conductor DEPENDS on the daemon: it only directs the daemon (files epics + promotes leaves
  // to ready) — with the daemon off nothing builds, so the server no-ops the conductor. Reflect that
  // here by disabling the switch when the daemon level is 'off'. Poll the same endpoint the daemon
  // ladder uses so this stays in sync as the daemon is toggled next to it.
  const [daemonOn, setDaemonOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const fetchLevel = async () => {
      const data = await apiGet(`/api/orchestrator/level?project=${encodeURIComponent(project)}`);
      if (!cancelled && typeof data.level === 'string') setDaemonOn(data.level !== 'off');
    };
    void fetchLevel();
    const id = setInterval(fetchLevel, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [project]);

  const disabled = busy || daemonOn === false;

  const handleSelect = useCallback(
    (next: ConductorLevel) => {
      if (disabled || !project || next === level) return;
      void setEnabled(next === 'on');
    },
    [disabled, project, level, setEnabled],
  );

  const daemonOff = daemonOn === false;
  const containerTitle = daemonOff
    ? 'Conductor requires the daemon on — it directs the daemon (files epics for it to build & land), so it does nothing while the daemon is off.'
    : LEVEL_TITLE[level];

  return (
    <div
      data-testid="conductor-ladder"
      data-project={project}
      data-enabled={String(!!enabled)}
      data-daemon-off={String(daemonOff)}
      title={containerTitle}
      className={`flex items-center rounded overflow-hidden border text-3xs font-medium select-none shrink-0 transition-opacity ${busy ? 'opacity-60' : ''} ${daemonOff ? 'opacity-40' : ''} ${loaded ? '' : 'opacity-50'} border-gray-300 dark:border-gray-600`}
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
            disabled={disabled}
            onClick={() => handleSelect(stop)}
            title={daemonOff ? 'Turn the daemon on first — the conductor has nothing to drive without it.' : LEVEL_TITLE[stop]}
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
