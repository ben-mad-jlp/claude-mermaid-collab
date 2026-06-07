/**
 * StewardPanel — the "Steward" sidebar section (Steward P3, design §6/§7).
 *
 * Top of the role ladder in DOM order (Steward ▸ Supervisor ▸ Coordinator/Planner
 * ▸ workers): the human's autonomous stand-in for escalation triage. Clones the
 * SupervisorPanel three-state front door — none → "Become the Steward" /
 * crashed → "Restart" / running → the observability dashboard — driven off the
 * INDEPENDENT 'steward' identity row (/api/supervisor/steward-identity, polled 10s).
 *
 * The running dashboard LEADS with liveness, then surfaces the SCARY metric loud
 * (override-accepts this session — todos the steward forced past the gate), the
 * deferred-count + queue depth/age derived from the escalation table (the source
 * of truth; the WS feed only narrates), and [Pause] / [Take over] controls. It
 * derives entirely from the supervisor store — no new load-bearing state.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { ClaudePixAvatar, activateSessionCard, useElapsed, type SessionCardData } from '@/components/layout/SessionCard';
import { selectOpenEscalations, selectStewardDeferred } from '@/components/supervisor/bridge/escalationSelectors';

export interface StewardPanelProps {
  currentProject?: string;
  currentSession?: string;
}

/**
 * StewardCard — the steward's own status card, mirroring the watched-session
 * SessionCard: status-colored body, project/session, a live elapsed badge, the
 * dancing-Claude avatar, and click→open-its-tmux. No supervise/shield toggle
 * (the steward is a global role, not a supervisable worker).
 */
const StewardCard: React.FC<{ card: SessionCardData }> = ({ card }) => {
  const elapsed = useElapsed(card.lastUpdate, card.status);
  const statusBg =
    card.status === 'permission'
      ? 'bg-danger-300 hover:bg-danger-400 border border-danger-500'
      : card.status === 'active'
        ? 'card-pulse-amber border border-warning-400'
        : card.status === 'waiting'
          ? 'bg-success-300 hover:bg-success-400 border border-success-500'
          : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';
  return (
    <div className="flex items-center gap-1">
      <div
        data-testid="steward-card"
        onClick={() => void activateSessionCard(card)}
        title="Open the steward's tmux console"
        className={`relative flex-1 flex items-center gap-2 pl-3 pr-2 py-1 rounded text-sm cursor-pointer transition-colors min-w-0 overflow-hidden ${statusBg}`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs text-black truncate">{card.session}</div>
          <div className="flex items-center gap-1">
            <span className="text-3xs text-black/70 truncate">{card.project.split('/').pop()}</span>
            {elapsed && <span className="text-3xs text-black tabular-nums ml-auto">{elapsed}</span>}
          </div>
        </div>
      </div>
      <ClaudePixAvatar status={card.status} />
    </div>
  );
};

export const StewardPanel: React.FC<StewardPanelProps> = ({ currentProject }) => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';

  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const escalations = useSupervisorStore((s) => s.escalations);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);

  const [collapsed, setCollapsed] = useState(false);
  // Steward default path mirrors the supervisor: a fixed global workspace
  // (~/.mermaid-collab/steward) resolved from /api/supervisor/steward-config —
  // NOT the current active project. The steward is a fleet-wide role.
  const [stewardProject, setStewardProject] = useState('');
  const [stewardSession, setStewardSession] = useState('');
  const [starting, setStarting] = useState(false);

  // Resolve the steward's default project + session from the server config once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mc = (window as any).mc;
        const res = mc?.invokeOnServer
          ? await mc.invokeOnServer(serverScope, { path: '/api/supervisor/steward-config', method: 'GET' })
          : { body: await (await fetch('/api/supervisor/steward-config')).json() };
        const cfg = res?.body ?? {};
        if (cancelled) return;
        if (cfg.stewardProject) setStewardProject(cfg.stewardProject);
        if (cfg.stewardSession) setStewardSession((prev) => prev || cfg.stewardSession);
      } catch {
        /* best-effort; falls back to currentProject below */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverScope]);

  // The project the steward operates as. Prefer the config-resolved global path;
  // fall back to the current project only until the config resolves.
  const project = stewardProject || currentProject || '';

  // Poll the steward's independent liveness + override count, and the escalation
  // set the dashboard reads, on the same 10s cadence as the Supervisor panel.
  useEffect(() => {
    const refresh = () => {
      void loadStewardIdentity(serverScope, project || undefined);
      void loadEscalations(serverScope);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, project, loadStewardIdentity, loadEscalations]);

  // Front-door state: no steward ever registered → 'none' (Become the Steward);
  // an identity exists but its heartbeat went stale → 'crashed' (Restart); fresh
  // heartbeat → 'running' (the dashboard). `stewardLiveness == null` means we
  // haven't polled yet — treat as running so we don't flash crashed on first paint.
  const stewardState: 'none' | 'crashed' | 'running' =
    stewardLiveness == null
      ? 'running'
      : stewardLiveness.identity == null
        ? 'none'
        : stewardLiveness.running
          ? 'running'
          : 'crashed';

  const open = useMemo(() => selectOpenEscalations(escalations, project), [escalations, project]);
  const deferred = useMemo(() => selectStewardDeferred(open), [open]);
  // Oldest open escalation's age — the "queue age" the dashboard surfaces.
  const queueAgeMs = useMemo(() => {
    if (open.length === 0) return null;
    const oldest = open.reduce((min, e) => Math.min(min, e.createdAt), open[0].createdAt);
    return Date.now() - oldest;
  }, [open]);

  const overrideAccepts = stewardLiveness?.overrideAccepts ?? 0;
  // Live ON/OFF switch (persistent; default ON when unknown). Distinct from the
  // build-time env arm and the transient pause.
  const switchedOn = stewardLiveness?.switchedOn !== false;

  // The steward's own status card — same colors + dancing-Claude + click→tmux as
  // a watched session. Its live status comes from the steward tmux session's
  // subscription (the same WS feed driving every other card); fall back to the
  // liveness heartbeat (running → idle/green, stale → unknown/gray).
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const stewardSessionName = stewardLiveness?.identity?.session ?? stewardSession;
  const stewardSub = useMemo(
    () => Object.values(subscriptions).find((s) => s.project === project && s.session === stewardSessionName),
    [subscriptions, project, stewardSessionName],
  );
  const stewardCard: SessionCardData = useMemo(
    () => ({
      serverId: stewardSub?.serverId || activeId || 'local',
      project,
      session: stewardSessionName,
      status:
        stewardSub?.status && stewardSub.status !== 'unknown'
          ? stewardSub.status
          : stewardLiveness?.running
            ? 'waiting'
            : 'unknown',
      lastUpdate: stewardSub?.lastUpdate ?? stewardLiveness?.identity?.updatedAt ?? Date.now(),
      contextPercent: stewardSub?.contextPercent,
    }),
    [stewardSub, activeId, project, stewardSessionName, stewardLiveness],
  );

  // Flip the steward's runtime on/off switch, then refresh so the rendered state
  // reflects the server (survives the 10s poll). Optimistic + best-effort.
  const setStewardEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        const body = { enabled };
        const mc = (window as any).mc;
        if (mc?.invokeOnServer) {
          await mc.invokeOnServer(serverScope, { path: '/api/supervisor/steward/enabled', method: 'POST', body });
        } else {
          await fetch('/api/supervisor/steward/enabled', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }
      } catch {
        /* best-effort */
      } finally {
        void loadStewardIdentity(serverScope, project || undefined);
      }
    },
    [serverScope, project, loadStewardIdentity],
  );

  const handleLaunch = useCallback(async () => {
    if (!project || !stewardSession) return;
    setStarting(true);
    try {
      const launchBody = {
        project,
        session: stewardSession,
        role: 'steward',
        invokeSkill: '/steward',
        allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid',
      };
      const mc = (window as any).mc;
      let result: { started?: boolean; reason?: string } = {};
      if (mc?.invokeOnServer) {
        const res = await mc.invokeOnServer(serverScope, { path: '/api/ide/launch-session', method: 'POST', body: launchBody });
        result = res?.body ?? {};
      } else {
        const res = await fetch('/api/ide/launch-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(launchBody),
        });
        result = await res.json().catch(() => ({}));
      }
      // The launch spawns a tmux claude session that registers as steward only
      // after it boots + runs /steward (~30–60s) — so the panel won't flip to
      // the dashboard immediately. Surface an outright launch failure so a silent
      // no-op (e.g. no-tmux / no-project-dir) doesn't look like nothing happened.
      if (result.started === false) {
        alert(`Steward failed to start: ${result.reason ?? 'unknown'}`);
      }
    } catch (err) {
      alert(`Steward failed to start: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setStarting(false);
      // Kick an immediate identity refresh so the dashboard appears as soon as
      // the session registers, rather than waiting for the next 10s poll.
      void loadStewardIdentity(serverScope, project || undefined);
    }
  }, [project, stewardSession, serverScope, loadStewardIdentity]);

  // [Pause] / [Take over] — best-effort control calls. The steward control
  // endpoints land in a later phase; until then these degrade to no-ops (the
  // free human-reclaim is also available by registering a new steward session).
  const stewardControl = useCallback(
    async (action: 'pause' | 'takeover') => {
      try {
        await fetch(`/api/supervisor/steward/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project }),
        });
      } catch {
        /* best-effort */
      }
    },
    [project],
  );

  return (
    <div data-testid="steward-panel" data-state={stewardState} className="border-b border-gray-200 dark:border-gray-700">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span role="img" aria-label="steward">🛡</span>
        <span>Steward</span>
        {stewardState === 'running' && overrideAccepts > 0 && (
          <span className="ml-1 text-2xs font-bold text-danger-600 dark:text-danger-400" title="Override-accepts this session">
            {overrideAccepts}⚡
          </span>
        )}
        <svg
          className={`w-3 h-3 ml-auto text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {collapsed ? null : stewardState !== 'running' ? (
        // Front door: a single Start/Restart button. Project + session come from
        // the server steward-config (the dedicated global steward workspace), so
        // no name/location inputs or description are needed.
        <div className="px-2.5 pb-2">
          <button
            data-testid="steward-launch"
            onClick={() => void handleLaunch()}
            disabled={starting || !project || !stewardSession}
            className="w-full py-1 px-3 text-2xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting
              ? stewardState === 'none'
                ? 'Starting…'
                : 'Restarting…'
              : stewardState === 'none'
                ? 'Start steward'
                : 'Restart steward'}
          </button>
        </div>
      ) : (
        // Running dashboard — leads with the steward's own status card (colors +
        // dancing Claude + click→tmux, like a watched session), then ON/OFF, a
        // tight metric grid (override is the scary cell), then controls.
        <div className="px-2.5 pb-2 space-y-1.5">
          <StewardCard card={stewardCard} />

          {/* Live ON/OFF switch — the human's runtime off-switch. */}
          <div className="flex items-center gap-1.5 text-2xs text-gray-500 dark:text-gray-400">
            <span>{stewardLiveness?.running ? 'Live' : 'Heartbeat stale'}</span>
            <button
              data-testid="steward-enabled-toggle"
              data-enabled={switchedOn}
              onClick={() => void setStewardEnabled(!switchedOn)}
              title={switchedOn ? 'Steward is ON — auto-acting. Click to turn OFF (all escalations route to you).' : 'Steward is OFF — all escalations route to you. Click to turn ON.'}
              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-semibold border transition-colors ${
                switchedOn
                  ? 'border-success-400 text-success-700 dark:text-success-300 bg-success-50 dark:bg-success-900/30'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${switchedOn ? 'bg-success-500' : 'bg-gray-400'}`} aria-hidden="true" />
              {switchedOn ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Compact metric grid — override (scary, danger-tinted when >0), then
              queue depth / steward-deferred / oldest age. */}
          <div className="grid grid-cols-4 gap-1 text-center">
            <div
              data-testid="steward-override-count"
              className={`rounded border px-1 py-1 ${
                overrideAccepts > 0
                  ? 'border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
              title="Override-accepts this session"
            >
              <div className={`text-sm font-bold ${overrideAccepts > 0 ? 'text-danger-700 dark:text-danger-300' : 'text-gray-700 dark:text-gray-300'}`}>{overrideAccepts}</div>
              <div className={`text-3xs ${overrideAccepts > 0 ? 'text-danger-500 dark:text-danger-400' : 'text-gray-500 dark:text-gray-400'}`}>override</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{open.length}</div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">queue</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{deferred.length}</div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">deferred</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {queueAgeMs == null ? '—' : `${Math.floor(queueAgeMs / 60000)}m`}
              </div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">oldest</div>
            </div>
          </div>

          <div className="flex gap-1.5">
            <button
              data-testid="steward-pause"
              onClick={() => void stewardControl('pause')}
              className="flex-1 py-1 px-2 text-2xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Pause
            </button>
            <button
              data-testid="steward-takeover"
              onClick={() => void stewardControl('takeover')}
              className="flex-1 py-1 px-2 text-2xs font-medium rounded border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            >
              Take over
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StewardPanel;
