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

/** A 'pass-ran' heartbeat older than this is treated as NOT running (a crashed/hung node leaves
 *  the heartbeat stamped; the server-side pass timeout is well under this). */
const RUNNING_FRESH_MS = 5 * 60 * 1000;

function relTime(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export interface ConductorLadderProps {
  project: string;
}

export const ConductorLadder: React.FC<ConductorLadderProps> = ({ project }) => {
  const { enabled, lastPass, busy, setEnabled } = useConductorEnabled(project);
  const loaded = enabled !== null;
  // Optimistic default OFF until the GET resolves (matches the backend default).
  const level: ConductorLevel = enabled ? 'on' : 'off';

  // Local clock so the "running" freshness + relative last-run time stay current between the
  // hook's 10s polls (the last-pass heartbeat only changes when a pass actually runs).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  const tickAt = typeof lastPass?.tickAt === 'number' ? lastPass.tickAt : null;
  // A pass is IN-FLIGHT when its interim heartbeat reason is still 'pass-ran' and fresh.
  const running = !!enabled && lastPass?.reason === 'pass-ran' && tickAt != null && now - tickAt < RUNNING_FRESH_MS;
  const lastRunLabel = tickAt != null ? relTime(tickAt, now) : null;

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
    void fetchLevel().catch(() => {});
    const id = setInterval(() => { void fetchLevel().catch(() => {}); }, 10_000);
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
      {/* Label so the two adjacent off/on ladders (daemon vs conductor) are distinguishable.
          When on, a status dot shows LIVE activity: amber+pulse while a pass is in-flight, else green. */}
      <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {enabled && (
          <span
            aria-hidden="true"
            data-testid="conductor-run-dot"
            className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-warning-500 animate-pulse' : 'bg-success-500'}`}
          />
        )}
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
      {/* Last-pass readout: proves the conductor is actually running (not just switched on). */}
      {enabled && (
        <span
          data-testid="conductor-last-pass"
          data-running={String(running)}
          title={
            tickAt != null
              ? `${running ? 'Conductor pass running now (started' : 'Last conductor pass'} ${lastRunLabel}${running ? ')' : ''} · ${new Date(tickAt).toLocaleString()}`
              : 'No conductor pass recorded yet'
          }
          className="shrink-0 px-1.5 py-0.5 tabular-nums whitespace-nowrap border-l border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
        >
          {running ? 'running…' : lastRunLabel ?? '—'}
        </span>
      )}
    </div>
  );
};

export default ConductorLadder;
