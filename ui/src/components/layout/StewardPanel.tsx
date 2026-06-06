/**
 * StewardPanel — the "Steward" sidebar section (Steward P3, design §6/§7).
 *
 * Top of the role ladder in DOM order (Steward ▸ Supervisor ▸ Coordinator/Planner
 * ▸ workers): the human's autonomous stand-in for escalation triage. Clones the
 * SupervisorPanel three-state front door — none → "Launch the Steward" /
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
import { useServers } from '@/contexts/ServerContext';
import { SessionCard, type SessionCardData } from '@/components/layout/SessionCard';
import { buildServerIconMap, buildServerLabelMap } from '@/components/layout/SupervisorPanel';
import { selectOpenEscalations, selectStewardDeferred } from '@/components/supervisor/bridge/escalationSelectors';

export interface StewardPanelProps {
  currentProject?: string;
  currentSession?: string;
}

export const StewardPanel: React.FC<StewardPanelProps> = ({ currentProject }) => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  const serverScope = activeId ?? 'local';

  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const escalations = useSupervisorStore((s) => s.escalations);
  const loadEscalations = useSupervisorStore((s) => s.loadEscalations);

  const project = currentProject ?? '';
  const [collapsed, setCollapsed] = useState(false);
  const [starting, setStarting] = useState(false);
  // Fixed session name — the steward always launches as 'steward', mirroring how
  // the supervisor launches from a fixed config name. No prompting (user: "I
  // don't care what we name it — just be named steward like the supervisor one.").
  const stewardSession = 'steward';

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

  // The steward session is (project, 'steward'). Render it as a real SessionCard
  // — the same card the Watching/supervised lists use — so the human can open
  // its terminal + focus it like any supervised session. Merge live status from
  // the Watching feed (subscriptionStore); fall back to 'unknown' when no live
  // subscription exists yet. Routing scope mirrors SupervisorPanel: real server
  // ids resolve icons/labels, with the 'local' sentinel aliased to the local one.
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const { servers } = useServers();
  const serverIconById = useMemo(() => buildServerIconMap(servers), [servers]);
  const serverLabelById = useMemo(() => buildServerLabelMap(servers), [servers]);
  const activeServerIcon = (activeId ? serverIconById.get(activeId) : undefined) ?? serverIconById.get('local');

  const stewardCard: SessionCardData = useMemo(() => {
    const matched = Object.values(subscriptions).find(
      (sub) => sub.project === project && sub.session === stewardSession,
    ) as SessionCardData | undefined;
    const status = (matched?.status && matched.status !== 'unknown' ? matched.status : 'unknown') as SessionCardData['status'];
    return {
      serverId: matched?.serverId || activeId || 'local',
      project,
      session: stewardSession,
      claudeSessionId: matched?.claudeSessionId,
      status,
      lastUpdate: matched?.lastUpdate ?? Date.now(),
      contextPercent: matched?.contextPercent,
    };
  }, [subscriptions, project, activeId]);

  // Card-click navigation — mirror SupervisorPanel: update local session state
  // for same-server rows (the card's own click side-effects open the terminal +
  // focus the browser tab via activateSessionCard).
  const handleNavigate = useCallback(
    (sub: SessionCardData) => {
      if (sub.serverId && activeId && sub.serverId !== activeId) return;
      const target = sessions.find((x) => x.project === sub.project && x.name === sub.session);
      if (target) setCurrentSession(target);
    },
    [sessions, setCurrentSession, activeId],
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
    if (!project) return;
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
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(serverScope, { path: '/api/ide/launch-session', method: 'POST', body: launchBody });
      } else {
        await fetch('/api/ide/launch-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(launchBody),
        });
      }
    } catch {
      /* best-effort */
    } finally {
      setStarting(false);
    }
  }, [project, serverScope]);

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
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
        // Front door: 'none' → Become the Steward, 'crashed' → Restart. Inline
        // (self-contained clone) so the panel owns the steward launch flow.
        <div className="px-3 pb-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 space-y-3">
            <div className="text-center space-y-1">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {stewardState === 'none' ? 'Launch the Steward' : 'Steward — not running'}
              </h2>
              <p className="text-2xs text-gray-500 dark:text-gray-400 leading-relaxed">
                The human&apos;s autonomous stand-in for escalation triage — answers what it safely can,
                routes the rest to you. A second steward supersedes the first (the free kill-switch).
              </p>
            </div>
            <div className="text-2xs text-gray-400 dark:text-gray-500 font-mono truncate" title={project}>
              {project || 'no project scope'}
            </div>
            <button
              data-testid="steward-launch"
              onClick={() => void handleLaunch()}
              disabled={starting || !project}
              className="w-full py-1.5 px-3 text-xs font-semibold rounded bg-info-600 hover:bg-info-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting
                ? stewardState === 'none'
                  ? 'Starting…'
                  : 'Restarting…'
                : stewardState === 'none'
                  ? 'Launch the Steward'
                  : 'Restart steward'}
            </button>
          </div>
        </div>
      ) : (
        // Running dashboard — leads with liveness, then the loud scary metric.
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-1.5 text-2xs text-gray-500 dark:text-gray-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-success-500" aria-hidden="true" />
            <span>Live</span>
            {stewardLiveness?.identity?.session && (
              <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{stewardLiveness.identity.session}</span>
            )}
            {/* Live ON/OFF switch — the human's runtime off-switch. */}
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

          {/* The steward's own session, as a real SessionCard — clickable to open
              its terminal + focus the browser tab, exactly like a supervised one. */}
          <div data-testid="steward-session-card">
            <SessionCard
              sub={stewardCard}
              serverLabel={serverLabelById.get(stewardCard.serverId) ?? undefined}
              serverIcon={serverIconById.get(stewardCard.serverId) ?? activeServerIcon}
              onNavigate={handleNavigate}
              isSelected={false}
              supervised
              onToggleSupervise={() => {}}
            />
          </div>

          {/* SCARY metric — override-accepts this session, surfaced LOUD. */}
          <div
            data-testid="steward-override-count"
            className={`rounded-lg border px-3 py-2 ${
              overrideAccepts > 0
                ? 'border-danger-300 dark:border-danger-700 bg-danger-50 dark:bg-danger-900/20'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            }`}
          >
            <div className="text-2xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Override-accepts this session</div>
            <div className={`text-lg font-bold ${overrideAccepts > 0 ? 'text-danger-700 dark:text-danger-300' : 'text-gray-700 dark:text-gray-300'}`}>
              {overrideAccepts}
            </div>
          </div>

          {/* Queue observability — depth, age, and the steward-deferred count. */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1.5">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{open.length}</div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">queue</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1.5">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{deferred.length}</div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">deferred</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-1 py-1.5">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {queueAgeMs == null ? '—' : `${Math.floor(queueAgeMs / 60000)}m`}
              </div>
              <div className="text-3xs text-gray-500 dark:text-gray-400">oldest</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              data-testid="steward-pause"
              onClick={() => void stewardControl('pause')}
              className="flex-1 py-1.5 px-3 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Pause
            </button>
            <button
              data-testid="steward-takeover"
              onClick={() => void stewardControl('takeover')}
              className="flex-1 py-1.5 px-3 text-xs font-medium rounded border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
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
