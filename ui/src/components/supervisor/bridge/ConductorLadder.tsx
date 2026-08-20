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
import {
  kickConductor,
  fetchAutoFixLevel,
  setAutoFixLevel,
  fetchExplorerLevel,
  setExplorerLevel,
  type LeverLevel,
} from '@/lib/conductorActivity';

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

/**
 * One off/on OPERATOR LEVER stop, in the ladder's own idiom: a stroked 24-viewBox icon +
 * the current level, one click to flip, disabled while the write is in flight, and the
 * failure surfaced INLINE (never a modal, never a silent flip).
 *
 * Shared by AutoFix (holds the repair forge) and Explorer (holds explore dispatch): both
 * are per-project off/on switches with an identical contract, default 'on'.
 */
interface LeverStopProps {
  /** data-testid prefix: `<testId>-toggle`, `<testId>-level`, `<testId>-error`. */
  testId: string;
  label: string;
  project: string;
  fetchLevel: (project: string) => Promise<{ ok: boolean; level: LeverLevel; error?: string }>;
  postLevel: (project: string, level: LeverLevel) => Promise<{ ok: boolean; level?: LeverLevel; error?: string }>;
  /** Word used in the generic failure line when the server sends no message. */
  failLabel: string;
  titleOn: string;
  titleOff: string;
  /** SVG children, drawn inside the shared stroked 24-viewBox frame. */
  icon: React.ReactNode;
}

const LeverStop: React.FC<LeverStopProps> = ({
  testId, label, project, fetchLevel, postLevel, failLabel, titleOn, titleOff, icon,
}) => {
  const [level, setLevel] = useState<LeverLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the CURRENT level on mount (and whenever the project changes).
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void fetchLevel(project).then((r) => {
      if (cancelled) return;
      setLevel(r.level);
      if (!r.ok) setError(r.error ?? `${failLabel} read failed`);
    });
    return () => { cancelled = true; };
  }, [project, fetchLevel, failLabel]);

  const handleClick = useCallback(async () => {
    if (busy || !project || level === null) return;
    const next: LeverLevel = level === 'on' ? 'off' : 'on';
    setBusy(true);
    setError(null);
    const r = await postLevel(project, next);
    // Adopt the SERVER's value, not the requested one — a refused write (transient path)
    // must not read back as a successful flip.
    if (r.ok) setLevel(r.level ?? next);
    else setError(r.error ?? `${failLabel} failed`);
    setBusy(false);
  }, [busy, project, level, postLevel, failLabel]);

  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        data-lever-level={level ?? 'unknown'}
        data-lever-busy={String(busy)}
        disabled={busy || level === null}
        aria-label={`${label} ${level ?? 'loading'} — click to toggle`}
        onClick={() => { void handleClick(); }}
        title={error ? error : level === 'off' ? titleOff : titleOn}
        className={`px-1.5 py-0.5 flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${
          error ? 'text-danger-500' : level === 'off' ? 'text-gray-400 dark:text-gray-500' : 'text-success-600 dark:text-success-500'
        } ${busy ? 'animate-pulse' : ''}`}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
        <span data-testid={`${testId}-level`}>{label} {level ?? '…'}</span>
      </button>
      {/* Failure surfaces INLINE (no modal) so a refused/failed write can never read as a
          silent success on the switch itself. */}
      {error && (
        <span
          data-testid={`${testId}-error`}
          role="status"
          className="shrink-0 px-1.5 py-0.5 whitespace-nowrap border-l border-gray-300 dark:border-gray-600 text-danger-500"
        >
          {error}
        </span>
      )}
    </>
  );
};

export interface ConductorLadderProps {
  project: string;
  /** Server that owns this project — every read/write below routes to it. */
  serverScope?: string;
}

export const ConductorLadder: React.FC<ConductorLadderProps> = ({ project, serverScope = 'local' }) => {
  const { enabled, lastPass, busy, setEnabled } = useConductorEnabled(project, serverScope);
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
      const data = await apiGet(`/api/orchestrator/level?project=${encodeURIComponent(project)}`, serverScope);
      if (!cancelled && typeof data.level === 'string') setDaemonOn(data.level !== 'off');
    };
    void fetchLevel().catch(() => {});
    const id = setInterval(() => { void fetchLevel().catch(() => {}); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [project, serverScope]);

  const disabled = busy || daemonOn === false;

  const handleSelect = useCallback(
    (next: ConductorLevel) => {
      if (disabled || !project || next === level) return;
      void setEnabled(next === 'on');
    },
    [disabled, project, level, setEnabled],
  );

  // OPERATOR KICK — the escape hatch, sitting with the on/off stops because that is where an
  // operator already goes to act on the conductor. One click arms ONE forced pass (the flag is
  // consumed by the pass that uses it); it is meaningless while the conductor is off or the
  // daemon is off, so it disables with them.
  const [kicking, setKicking] = useState(false);
  const [kickNote, setKickNote] = useState<{ ok: boolean; text: string } | null>(null);
  const handleKick = useCallback(async () => {
    if (kicking || !project) return;
    setKicking(true);
    setKickNote(null);
    const r = await kickConductor(project, undefined, serverScope);
    setKickNote(r.ok ? { ok: true, text: 'kick armed — next pass runs' } : { ok: false, text: r.error ?? 'kick failed' });
    setKicking(false);
  }, [kicking, project]);

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
      {/* KICK — a lightning bolt in the same stroked 24-viewBox style as the Bridge header icons.
          Forces exactly ONE pass past the fingerprint debounce; the flag is consumed by that pass
          and never sticks. `title` carries the outcome so the ladder stays one compact row. */}
      <button
        type="button"
        data-testid="conductor-kick"
        data-kick-state={kickNote ? (kickNote.ok ? 'ok' : 'error') : kicking ? 'busy' : 'idle'}
        disabled={kicking || disabled || !enabled}
        aria-label="Force one conductor pass"
        onClick={() => { void handleKick(); }}
        title={
          kickNote
            ? kickNote.text
            : !enabled
              ? 'Turn the conductor on first — there is no pass to force.'
              : 'Force one conductor pass now, ignoring the debounce (one-shot).'
        }
        className={`px-1.5 py-0.5 flex items-center transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 border-l border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 ${
          kickNote && !kickNote.ok ? 'text-danger-500' : 'text-gray-500 dark:text-gray-400'
        } ${kicking ? 'animate-pulse' : ''}`}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </button>
      {/* AUTOFIX — holds the daemon's repair-forge pass (the only pass that spends nodes
          unasked). Findings are still recorded; only the FORGE is held. */}
      <LeverStop
        testId="autofix"
        label="AutoFix"
        project={project}
        fetchLevel={(p) => fetchAutoFixLevel(p, serverScope)}
        postLevel={(p, l) => setAutoFixLevel(p, l, serverScope)}
        failLabel="autofix"
        titleOn="AutoFix on — the daemon batches bugfix requests and forges a repair mission for approval. Click to hold it."
        titleOff="AutoFix off — the daemon will NOT forge repair missions from batched bugfix requests. Findings are still recorded. Click to turn on."
        icon={
          <>
            <path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3z" />
            <path d="M14.7 6.3 18 3l3 3-3.3 3.3" />
          </>
        }
      />
      {/* EXPLORER — holds explore-leaf DISPATCH. Explores are still FILED and still
          PROMOTED into the 'Explore runs' epic while it is off (nothing is lost); they
          simply queue, and the claim-suppression report names `explorer-off` for each. */}
      <LeverStop
        testId="explorer"
        label="Explorer"
        project={project}
        fetchLevel={(p) => fetchExplorerLevel(p, serverScope)}
        postLevel={(p, l) => setExplorerLevel(p, l, serverScope)}
        failLabel="explorer"
        titleOn="Explorer on — filed explore leaves are claimed and run as usual. Click to hold dispatch."
        titleOff="Explorer off — explore leaves are still filed and promoted, but NOT claimed (they queue; the claim-suppression report names explorer-off). Click to drain the queue."
        icon={
          <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </>
        }
      />
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
          className="shrink-0 px-1.5 py-0.5 tabular-nums whitespace-nowrap border-l border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
        >
          {running ? 'running…' : lastRunLabel ?? '—'}
          {!running && lastPass?.status ? (
            // A pass that died mid-flight (killed process / sidecar restart) never stamped its
            // terminal reason, so its persisted status is still the literal 'running…'. Since it is
            // NOT actually running (stale), show 'interrupted' rather than a misleading 'running…'.
            <span data-testid="conductor-status-line" className="opacity-90"> · {lastPass.reason === 'pass-ran' ? 'interrupted' : lastPass.status}</span>
          ) : null}
        </span>
      )}
    </div>
  );
};

export default ConductorLadder;
