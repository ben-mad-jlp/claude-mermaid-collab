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
  fetchCampaignLevel,
  setCampaignLevel,
} from '@/lib/conductorActivity';
import { LeverStop } from './LeverStop';

type ConductorLevel = 'off' | 'on';

const LEVEL_TITLE: Record<ConductorLevel, string> = {
  off: 'Conductor off — no autonomous mission-driving for this project.',
  on: 'Conductor on — autonomously drives the active mission: grounds gaps, files + approves serving epics for the daemon to build & land, and runs the independent verify.',
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

  const handleFlip = useCallback(
    async (next: ConductorLevel) => {
      await setEnabled(next === 'on');
      return { ok: true as const, level: next };
    },
    [setEnabled],
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
      </span>
      <LeverStop
        testId="conductor"
        label="Conductor"
        project={project}
        failLabel="conductor"
        controlledLevel={enabled === null ? null : enabled ? 'on' : 'off'}
        onFlip={handleFlip}
        titleOn={LEVEL_TITLE.on}
        titleOff={LEVEL_TITLE.off}
        disabled={disabled}
        disabledTitle="Turn the daemon on first — the conductor has nothing to drive without it."
        icon={
          <>
            <path d="M5 19 16 8" />
            <circle cx="18" cy="6" r="2.5" />
          </>
        }
      />
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
      {/* CAMPAIGN — the spend kill switch. Holds the whole campaign pass: probe execution,
          mission forging, and chamber convenes. A convene is a full multi-general LLM
          deliberation (the most expensive automated act in the system), so this lever sits
          here where the operator already reaches to stop autonomous work. */}
      <LeverStop
        testId="campaign"
        label="Campaign"
        project={project}
        fetchLevel={(p) => fetchCampaignLevel(p, serverScope)}
        postLevel={(p, l) => setCampaignLevel(p, l, serverScope)}
        failLabel="campaign"
        titleOn="Campaign on — campaign probes run and the chamber convenes (a full multi-general deliberation) when evidence changes. Click to hold ALL campaign activity and spend."
        titleOff="Campaign off — no probes, no mission forging, no chamber convenes for this project. Click to resume."
        icon={
          <>
            <path d="M4 15V4l9 3.5L4 11" />
            <path d="M4 22v-7" />
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
