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
        <div className="flex-1 min-w-0 flex items-center gap-1">
          {/* The steward's project basename and session are both "steward", and
              the section header already says "Steward" — so show the name once. */}
          <span className="text-xs text-black truncate">{card.session}</span>
          {elapsed && <span className="text-3xs text-black tabular-nums ml-auto">{elapsed}</span>}
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
  // Live 3-way mode (persistent; default derived from the legacy switch when the
  // field is absent). Distinct from the build-time env arm and the transient pause.
  const stewardMode = stewardLiveness?.mode ?? (stewardLiveness?.switchedOn !== false ? 'auto' : 'off');

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
        // Running dashboard — the steward's own status card (colors + dancing
        // Claude + click→tmux), the ON/OFF auto-act switch, and one compact
        // status line (override is the loud part; queue/deferred/oldest inline).
        <div className="px-2.5 pb-2 space-y-1.5">
          <StewardCard card={stewardCard} />

          {/* Mode (off / auto / dogfood) is controlled from the main header
              role switches; here we just show the live mode + heartbeat. */}
          <div className="flex items-center gap-1.5 text-2xs text-gray-500 dark:text-gray-400">
            <span>{stewardLiveness?.running ? 'Live' : 'Heartbeat stale'}</span>
            <span className="ml-auto font-semibold uppercase tracking-wide capitalize">{stewardMode}</span>
          </div>

          {/* One compact status line. Override is the loud signal (red when >0,
              also mirrored as N⚡ in the header); the rest sit inline. */}
          <div className="flex items-center gap-2 text-3xs text-gray-500 dark:text-gray-400">
            <span
              data-testid="steward-override-count"
              className={`font-bold ${overrideAccepts > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-gray-600 dark:text-gray-300'}`}
              title="Override-accepts this session — todos the steward forced past the gate"
            >
              {overrideAccepts}⚡ override
            </span>
            <span title="Open escalations">· {open.length} queue</span>
            <span title="Deferred to you">· {deferred.length} deferred</span>
            <span title="Oldest open escalation">
              · {queueAgeMs == null ? 'none' : `${Math.floor(queueAgeMs / 60000)}m`} oldest
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default StewardPanel;
