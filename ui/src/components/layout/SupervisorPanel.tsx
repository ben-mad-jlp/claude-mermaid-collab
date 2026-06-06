/**
 * SupervisorPanel — the "Supervisor" sidebar section.
 *
 * Session-centric: lists the sessions the supervisor oversees (the supervised
 * set from `/api/supervisor/supervised`), grouped by project. Each session is
 * rendered with the SAME card the Watching panel uses (SessionCard), so a
 * supervised card shows everything a watched one does (project, server icon,
 * live status, context %, elapsed, avatar) and clicking it behaves identically
 * (create terminal, focus browser tab, open the terminal). Supervisor-specific
 * extras: a 🔒 lock indicator, a ⚠️ open-escalation indicator, and the shield
 * toggle acts as "stop supervising" (DELETE from the supervised set).
 *
 * Full card data (context %, elapsed, serverId) is merged from the Watching
 * feed (`useSubscriptionStore`) when a matching subscription exists; otherwise
 * we fall back to a polled persisted status (`/api/session-status`).
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  useSupervisorStore,
  type SupervisedSession,
} from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';
import { SessionCard, ClaudePixAvatar, type SessionCardData } from '@/components/layout/SessionCard';
import { SupervisorOnboarding } from '@/components/supervisor/SupervisorOnboarding';
import { useUIStore } from '@/stores/uiStore';

/**
 * Reduce a project's session-card statuses to ONE combined health status — the
 * at-a-glance per-project read (mirrors the SessionCard status palette). Severity
 * order: permission (RED) ▸ active (AMBER) ▸ waiting (GREEN) ▸ unknown (GREY).
 */
export function combineCardStatus(statuses: Array<SessionCardData['status']>): SessionCardData['status'] {
  if (statuses.some((s) => s === 'permission')) return 'permission';
  if (statuses.some((s) => s === 'active')) return 'active';
  if (statuses.some((s) => s === 'waiting')) return 'waiting';
  return 'unknown';
}

/** Per-project header background, mirroring SessionCard's statusBg palette. */
export function projectHeaderBg(status: SessionCardData['status']): string {
  switch (status) {
    case 'permission':
      return 'bg-danger-300 dark:bg-danger-900/40 border border-danger-500';
    case 'active':
      return 'card-pulse-amber border border-warning-400';
    case 'waiting':
      return 'bg-success-300 dark:bg-success-900/40 border border-success-500';
    default:
      return 'bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600';
  }
}

export interface SupervisorPanelProps {
  currentProject?: string;
  currentSession?: string;
  onNavigate?: (serverId: string, project: string, session: string) => void;
  /** Called when the user clicks "Open Supervisor" to deep-link into the full SupervisorView. */
  onOpenSupervisorView?: () => void;
}

type IconServer = { id: string; icon?: string; label: string; source?: string; host?: string };

/** The actual local server, used to resolve the 'local' SENTINEL that supervised
 *  rows are stamped with (source==='local', else a loopback host). Pure; (2e3efadd). */
export function localServerOf<T extends { source?: string; host?: string }>(servers: T[]): T | undefined {
  return (
    servers.find((s) => s.source === 'local') ??
    servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost')
  );
}

/** id→icon map that ALSO aliases the 'local' sentinel to the local server's icon,
 *  so a supervised card stamped serverId='local' shows the real local-server icon
 *  instead of the generic fallback (bug 2e3efadd). Pure; unit-tested. */
export function buildServerIconMap(servers: IconServer[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of servers) if (s.icon) m.set(s.id, s.icon);
  const local = localServerOf(servers);
  if (local?.icon) m.set('local', local.icon);
  return m;
}

/** id→label map with the same 'local' aliasing as buildServerIconMap. */
export function buildServerLabelMap(servers: IconServer[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of servers) m.set(s.id, s.label);
  const local = localServerOf(servers);
  if (local) m.set('local', local.label);
  return m;
}

export const SupervisorPanel: React.FC<SupervisorPanelProps> = ({ currentProject, currentSession, onNavigate, onOpenSupervisorView }) => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  // Routing scope for supervisor API calls. The supervisor store is GLOBAL
  // (server-side), so its data is the same regardless of which server we route
  // through; fall back to 'local' so the panel still loads when no server is
  // active (e.g. the standalone sidebar). When a desktop bridge is present,
  // 'local' resolves to the local server via the fetch fallback.
  const serverScope = activeId ?? 'local';

  const {
    supervised,
    config,
    liveness,
    loadSupervised,
    loadEscalations,
    loadConfig,
    loadLiveness,
  } = useSupervisorStore();

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const storeCurrentSession = useSessionStore((s) => s.currentSession);
  const { servers } = useServers();
  const collapsedProjects = useUIStore((s) => s.supervisorCollapsedProjects);
  const toggleSupervisorProject = useUIStore((s) => s.toggleSupervisorProject);
  const [collapsed, setCollapsed] = useState(false);
  const [startingSup, setStartingSup] = useState(false);

  const handleStartSupervisor = async () => {
    const serverId = serverScope;
    setStartingSup(true);
    try {
      const mc = (window as any).mc;
      const cfgRes = mc?.invokeOnServer
        ? await mc.invokeOnServer(serverId, { path: '/api/supervisor/config', method: 'GET' })
        : { ok: true, body: await (await fetch('/api/supervisor/config')).json() };
      const cfg = cfgRes?.body ?? {};
      const supervisorProject = cfg.supervisorProject;
      const supervisorSession = cfg.supervisorSession;
      if (!supervisorProject || !supervisorSession) return;
      const launchBody = { project: supervisorProject, session: supervisorSession, role: 'supervisor', invokeSkill: '/supervisor', allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid' };
      if (mc?.invokeOnServer) await mc.invokeOnServer(serverId, { path: '/api/ide/launch-session', method: 'POST', body: launchBody });
      else await fetch('/api/ide/launch-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(launchBody) });
    } catch { /* best-effort */ }
    finally { setStartingSup(false); }
  };

  // Open the supervisor's own session console in a terminal tab. The supervisor
  // isn't a supervised/watched card, so this is the only way to view it in-app.
  // Resolve its project/session from /api/supervisor/config, then reuse the
  // exact card-click side-effects (create terminal + focus + openFor).
  const handleOpenConsole = async () => {
    // Resolve a REAL server id for routing: the terminal WS goes through
    // /_per-server/<serverId>/… which the proxy resolves against the registered
    // server list, so 'local' (the routing fallback) won't connect and the tab
    // opens blank. Prefer the active server if it's a known server, else the
    // local sidecar, else the first server.
    const localServer =
      servers.find((s) => s.source === 'local') ??
      servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost');
    const serverId =
      (activeId && servers.some((s) => s.id === activeId)) ? activeId
      : localServer?.id ?? servers[0]?.id ?? serverScope;
    try {
      const mc = (window as any).mc;
      const cfgRes = mc?.invokeOnServer
        ? await mc.invokeOnServer(serverId, { path: '/api/supervisor/config', method: 'GET' })
        : { ok: true, body: await (await fetch('/api/supervisor/config')).json() };
      const cfg = cfgRes?.body ?? {};
      const project = cfg.supervisorProject;
      const session = cfg.supervisorSession;
      if (!project || !session) return;
      // Open the supervisor's console as a distinct tab: a custom title
      // ("collab-supervisor") disambiguates it from any supervised worker also
      // named "supervisor", and the server icon is hidden on this tab.
      await useTerminalStore.getState().openFor(project, session, {
        serverId,
        serverLabel: serverLabelById.get(serverId),
        title: 'collab-supervisor',
        hideServerIcon: true,
      });
    } catch { /* best-effort */ }
  };
  // Persisted status source: map keyed `${serverId}:${project}:${session}` -> status.
  // Polled from GET /api/session-status?project= per distinct (serverId, project).
  const [fetchedStatuses, setFetchedStatuses] = useState<Record<string, string>>({});

  // Load supervised sessions / escalations for the active routing server, and
  // refresh on an interval so newly-supervised sessions appear.
  useEffect(() => {
    const refresh = () => {
      void loadSupervised(serverScope);
      void loadEscalations(serverScope);
      // Config + liveness drive the front-door state ('none' / 'crashed' /
      // 'running'); poll them on the same cadence so the panel flips to the
      // Restart front door within the staleness window when the supervisor dies.
      void loadConfig(serverScope);
      void loadLiveness(serverScope);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, loadSupervised, loadEscalations, loadConfig, loadLiveness]);

  // Front-door state: no config saved → 'none' (Become the Supervisor); config
  // present but the heartbeat has gone stale (or never registered) → 'crashed'
  // (Restart front door); config present and the heartbeat is fresh → 'running'
  // (the live dashboard below). `liveness === null` means we haven't polled yet,
  // so don't flash the crashed door before the first identity response lands.
  const hasConfig = !!(config?.supervisorProject && config?.supervisorSession);
  const supervisorState: 'none' | 'crashed' | 'running' = !hasConfig
    ? 'none'
    : liveness == null || liveness.running
      ? 'running'
      : 'crashed';

  // Supervised rows are stamped with the 'local' SENTINEL (serverScope = activeId
  // ?? 'local'), but these maps are keyed by REAL server ids — so a 'local' row
  // missed and fell back to the generic/alien icon (bug 2e3efadd). The map builders
  // alias 'local' → the actual local server's icon/label (tested helpers; also
  // handle a loopback-host local server). activeServerIcon falls back to 'local'.
  const serverIconById = useMemo(() => buildServerIconMap(servers), [servers]);
  const serverLabelById = useMemo(() => buildServerLabelMap(servers), [servers]);
  const activeServerIcon = (activeId ? serverIconById.get(activeId) : undefined) ?? serverIconById.get('local');

  // Supervised sessions grouped by project (the session-centric view).
  const byProject = useMemo(() => {
    const m = new Map<string, SupervisedSession[]>();
    for (const s of supervised) {
      const arr = m.get(s.project) ?? [];
      arr.push(s);
      m.set(s.project, arr);
    }
    return Array.from(m.entries())
      .map(([project, sessions]) => ({
        project,
        sessions: sessions.sort((a, b) => a.session.localeCompare(b.session)),
      }))
      .sort((a, b) => a.project.localeCompare(b.project));
  }, [supervised]);

  // Distinct (activeId, project) pairs from supervised sessions — the unit of
  // the per-project session-status API.
  const distinctPairs = useMemo(() => {
    const map = new Map<string, { serverId: string; project: string }>();
    for (const s of supervised) {
      map.set(`${activeId}|${s.project}`, { serverId: activeId ?? '', project: s.project });
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.serverId}|${a.project}`.localeCompare(`${b.serverId}|${b.project}`),
    );
  }, [activeId, supervised]);
  // Stable primitive dependency so the poll effect re-runs only when the
  // actual set of (serverId, project) pairs changes, not on every render.
  const distinctPairsKey = useMemo(
    () => distinctPairs.map((p) => `${p.serverId}|${p.project}`).join('\n'),
    [distinctPairs],
  );

  // Poll persisted statuses from GET /api/session-status?project= for each
  // distinct (serverId, project). Server-aware via mc.invokeOnServer when the
  // desktop bridge is present, otherwise plain fetch. Rows older than 120s are
  // treated as 'unknown' (stale). Live WS events layer on top of this below.
  useEffect(() => {
    const pairs = distinctPairs;
    if (pairs.length === 0) {
      setFetchedStatuses({});
      return;
    }

    let cancelled = false;
    const STALE_MS = 120_000;

    const fetchOne = async (
      serverId: string,
      project: string,
    ): Promise<Array<{ project: string; session: string; status: string; updatedAt?: number }>> => {
      const path = `/api/session-status?project=${encodeURIComponent(project)}`;
      const mc = (window as any).mc;
      try {
        if (mc?.invokeOnServer) {
          const res = await mc.invokeOnServer(serverId, { path, method: 'GET' });
          if (res?.ok && res.body && typeof res.body === 'object') {
            return (res.body as any).statuses ?? [];
          }
          return [];
        }
        const r = await fetch(path);
        if (!r.ok) return [];
        const data = await r.json();
        return data.statuses ?? [];
      } catch {
        return [];
      }
    };

    const poll = async () => {
      const now = Date.now();
      const results = await Promise.all(pairs.map((p) => fetchOne(p.serverId, p.project)));
      if (cancelled) return;
      const map: Record<string, string> = {};
      pairs.forEach((p, i) => {
        for (const row of results[i]) {
          const stale = typeof row.updatedAt === 'number' && now - row.updatedAt > STALE_MS;
          // Keyed by project:session (serverId-agnostic) so lookups don't depend
          // on which server we routed through — supervised rows may carry a
          // different/blank serverId than the active one.
          const key = `${row.project}:${row.session}`;
          map[key] = stale ? 'unknown' : row.status;
        }
      });
      if (!cancelled) setFetchedStatuses(map);
    };

    void poll();
    const id = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [distinctPairsKey]);

  // Find the Watching-feed subscription that matches a project+session (any
  // serverId). It carries the live status, context %, lastUpdate, and the
  // serverId we should route per-server actions through.
  const findSubscription = useCallback(
    (project: string, session: string): SessionCardData | undefined => {
      for (const sub of Object.values(subscriptions)) {
        if (sub.project === project && sub.session === session) return sub as SessionCardData;
      }
      return undefined;
    },
    [subscriptions],
  );

  // Build full card data for a supervised session: prefer the live subscription
  // entry, fall back to the polled persisted status. Resolve a serverId for
  // per-server routing from the subscription, the supervised record, or active.
  const cardDataFor = useCallback(
    (s: SupervisedSession): SessionCardData => {
      const matched = findSubscription(s.project, s.session);
      const status = (matched?.status && matched.status !== 'unknown'
        ? matched.status
        : (fetchedStatuses[`${s.project}:${s.session}`] as SessionCardData['status'])) ?? 'unknown';
      const serverId = matched?.serverId || s.serverId || activeId || 'local';
      return {
        serverId,
        project: s.project,
        session: s.session,
        claudeSessionId: matched?.claudeSessionId,
        status,
        lastUpdate: matched?.lastUpdate ?? Date.now(),
        contextPercent: matched?.contextPercent,
      };
    },
    [findSubscription, fetchedStatuses, activeId],
  );

  // Navigate: mirror the Watching panel — update local session state for
  // same-server rows (the card's click side-effects handle terminal/browser).
  const handleNavigate = useCallback(
    (sub: SessionCardData) => {
      if (sub.serverId && activeId && sub.serverId !== activeId) return; // cross-server — don't switch active
      const target = sessions.find((x) => x.project === sub.project && x.name === sub.session);
      if (target) setCurrentSession(target);
      onNavigate?.(sub.serverId ?? activeId ?? '', sub.project, sub.session);
    },
    [sessions, setCurrentSession, onNavigate, activeId],
  );

  // Stop supervising (or, defensively, start) — DELETE/POST the supervised set
  // then refresh. In this panel every card is supervised, so this removes it.
  const handleToggleSupervise = useCallback(
    async (sub: SessionCardData, next: boolean) => {
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = next
        ? { project: sub.project, session: sub.session, source: 'manual' }
        : { project: sub.project, session: sub.session };
      const method = next ? 'POST' : 'DELETE';
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(serverScope, { path, method, body });
      } else {
        await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
      void loadSupervised(serverScope);
    },
    [serverScope, loadSupervised],
  );

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>Supervisor</span>
          <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
            {supervised.length}
          </span>
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
        {onOpenSupervisorView && (
          <button
            onClick={onOpenSupervisorView}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Open Supervisor view"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2v-4M14 4h4m0 0v4m0-4L10 10" />
            </svg>
          </button>
        )}
        <button
          onClick={handleOpenConsole}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Open supervisor console in a terminal tab"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 8l2.5 2-2.5 2M10 13h4.5" />
          </svg>
        </button>
        <button
          onClick={handleStartSupervisor}
          disabled={startingSup}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
          title="Start supervising — launches the supervisor session with /collab + /supervisor"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l10 6-10 6V4z" /></svg>
        </button>
      </div>

      {/* Body */}
      {!collapsed && supervisorState !== 'running' ? (
        // No running supervisor: render the front door instead of the dashboard.
        // 'none' → Become the Supervisor onboarding; 'crashed' → Restart card
        // (config present but the heartbeat went stale). SupervisorOnboarding
        // loads/saves config itself via the store, so it stays in sync.
        <div className="pb-2">
          <SupervisorOnboarding
            serverId={serverScope}
            state={supervisorState}
            lastSession={config?.supervisorSession}
          />
        </div>
      ) : !collapsed ? (
        <div className="px-2 pb-2">
          {supervised.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
              No supervised sessions
            </div>
          ) : (
            byProject.map(({ project, sessions: projSessions }, i) => {
              const cards = projSessions.map((s) => cardDataFor(s));
              // Combined per-project health: reduce every card's status to one.
              const combined = combineCardStatus(cards.map((c) => c.status));
              const isProjCollapsed = !!collapsedProjects[project];
              const projName = project.split('/').filter(Boolean).pop() ?? project;
              return (
                <div key={project} className={i > 0 ? 'mt-2' : ''}>
                  {/* Per-project collapsible header: dancing-Claude avatar (dances
                      when any worker is active), the combined-state color, and a
                      collapse toggle whose state is persisted in uiStore. */}
                  <button
                    type="button"
                    data-testid="supervisor-project-header"
                    data-project={project}
                    data-combined-status={combined}
                    aria-expanded={!isProjCollapsed}
                    onClick={() => toggleSupervisorProject(project)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium text-gray-800 dark:text-gray-100 ${projectHeaderBg(combined)}`}
                  >
                    <span className="flex-shrink-0">
                      <ClaudePixAvatar status={combined} />
                    </span>
                    <span className="truncate" title={project}>{projName}</span>
                    <span className="text-gray-500 dark:text-gray-400 font-normal">{projSessions.length}</span>
                    <svg
                      className={`w-3 h-3 ml-auto transition-transform ${isProjCollapsed ? '-rotate-90' : ''}`}
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

                  {/* Supervised sessions — same card as Watching. Hidden when the
                      project group is collapsed. */}
                  {!isProjCollapsed && (
                    <div className="space-y-1 mt-1">
                      {projSessions.map((s, idx) => {
                        const card = cards[idx];
                        const isSelected =
                          !!storeCurrentSession &&
                          storeCurrentSession.project === s.project &&
                          storeCurrentSession.name === s.session;
                        return (
                          <SessionCard
                            key={s.session}
                            sub={card}
                            serverLabel={serverLabelById.get(card.serverId) ?? undefined}
                            serverIcon={serverIconById.get(card.serverId) ?? activeServerIcon}
                            onNavigate={handleNavigate}
                            isSelected={isSelected}
                            supervised
                            onToggleSupervise={handleToggleSupervise}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Escalations inbox REMOVED — scoped escalations now live ONLY in the
              Bridge's NeedsYouZone (Z1). The main left column no longer surfaces
              them, to keep a single source of "needs you". */}
        </div>
      ) : null}
    </div>
  );
};
