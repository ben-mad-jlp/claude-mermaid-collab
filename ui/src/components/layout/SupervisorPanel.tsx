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
  type Escalation,
  type SupervisedSession,
} from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';
import { SessionCard, activateSessionCard, type SessionCardData } from '@/components/layout/SessionCard';

export interface SupervisorPanelProps {
  currentProject?: string;
  currentSession?: string;
  onNavigate?: (serverId: string, project: string, session: string) => void;
  /** Called when the user clicks "Open Supervisor" to deep-link into the full SupervisorView. */
  onOpenSupervisorView?: () => void;
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
    escalations,
    loadSupervised,
    loadEscalations,
    resolveEscalation,
  } = useSupervisorStore();

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const storeCurrentSession = useSessionStore((s) => s.currentSession);
  const { servers } = useServers();
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
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, loadSupervised, loadEscalations]);

  const serverIconById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) if (s.icon) m.set(s.id, s.icon);
    return m;
  }, [servers]);
  const serverLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) m.set(s.id, s.label);
    return m;
  }, [servers]);
  const activeServerIcon = activeId ? serverIconById.get(activeId) : undefined;

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

  const openEscalations = escalations.filter((e) => e.status === 'open');

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
      {!collapsed && (
        <div className="px-2 pb-2">
          {supervised.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
              No supervised sessions
            </div>
          ) : (
            byProject.map(({ project, sessions: projSessions }, i) => (
              <div
                key={project}
                className={`space-y-1 ${i > 0 ? 'mt-2 pt-2 border-t border-gray-200 dark:border-gray-700' : ''}`}
              >
                {/* Supervised sessions — same card as Watching */}
                {projSessions.map((s) => {
                  const card = cardDataFor(s);
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
            ))
          )}

          {/* Escalations inbox */}
          {openEscalations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 px-1 pb-1.5">
                <span className="text-2xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Escalations
                </span>
                <span className="text-gray-400 dark:text-gray-500 font-normal text-xs">
                  {openEscalations.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {openEscalations.map((e: Escalation) => (
                  <div
                    key={e.id}
                    className="px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 space-y-1"
                  >
                    <div className="text-2xs font-medium text-gray-500 dark:text-gray-400 truncate">
                      {`${e.project.split('/').pop()} / ${e.session}`}
                    </div>
                    <div className="text-xs font-mono leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                      {e.questionText}
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        onClick={() => {
                          const sub = findSubscription(e.project, e.session) ?? {
                            serverId: activeId ?? 'local',
                            project: e.project,
                            session: e.session,
                            status: 'unknown' as const,
                            lastUpdate: Date.now(),
                          };
                          // Same as clicking a card: select the session AND fire
                          // the per-server side-effects (terminal + browser focus).
                          handleNavigate(sub);
                          void activateSessionCard(sub, serverLabelById.get(sub.serverId));
                        }}
                        className="px-2 py-0.5 text-2xs font-medium rounded bg-gray-200 text-gray-700 border border-gray-300 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 transition-colors"
                        title="Jump to session"
                      >
                        Jump to session
                      </button>
                      <button
                        onClick={() => {
                          void resolveEscalation(serverScope, e.id, 'resolved');
                        }}
                        className="px-2 py-0.5 text-2xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        title="Mark resolved and remove from inbox"
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
