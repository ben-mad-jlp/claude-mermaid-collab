/**
 * SubscriptionsPanel — the "Watching" section and its Subscribe modal.
 *
 * Mental model after the sidebar-servers refactor:
 * - Servers live in the sidebar (`ServersTreeSection`).
 * - The Subscribe modal lists sessions across ALL known servers (grouped),
 *   and lets the user create new projects + sessions on any server without
 *   switching active. Per-server actions route through `mc.invokeOnServer`;
 *   tokens stay in main.
 * - Subscribed rows carry a `serverId` and a per-server icon chip; their
 *   click actions target the row's server, not the active one.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useServers } from '@/contexts/ServerContext';
import { getWebSocketClient } from '@/lib/websocket';
import { ServerIcon } from '@/components/ServerIcon';
import { SessionCard, capsCache, type SessionCardData } from '@/components/layout/SessionCard';

type SubscribedSession = SessionCardData;

function useSupervisedSessions(): {
  set: Set<string>;
  refresh: () => void;
  setOptimistic: (project: string, session: string, supervised: boolean) => void;
} {
  const [set, setSet] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Apply a toggle to the local set immediately (before the server round-trips),
  // so a supervised card moves groups instantly instead of vanishing until the
  // next poll. The subsequent refresh() reconciles with server truth.
  const setOptimistic = useCallback((project: string, session: string, supervised: boolean) => {
    setSet((prev) => {
      const key = `${project}:${session}`;
      if (supervised === prev.has(key)) return prev;
      const next = new Set(prev);
      if (supervised) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch('/api/supervisor/supervised')
        .then((r) => r.json())
        .then((data: { supervised: { project: string; session: string }[] }) => {
          if (!cancelled) setSet(new Set((data.supervised ?? []).map((s) => `${s.project}:${s.session}`)));
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tick]);

  return { set, refresh, setOptimistic };
}


export interface SubscriptionsPanelProps {
  currentProject?: string;
  onNavigate?: (serverId: string, project: string, session: string) => void;
}

export const SubscriptionsPanel: React.FC<SubscriptionsPanelProps> = ({ currentProject, onNavigate }) => {
  const { subscriptions, order, unsubscribe, subscribe, reorder } = useSubscriptionStore();
  const { sessions, setCurrentSession, currentSession } = useSessionStore();
  const { servers } = useServers();
  // Invalidate capsCache entries for servers that no longer exist, so a
  // re-added server doesn't reuse a stale (possibly wrong) tmux capability.
  useEffect(() => {
    const ids = new Set(servers.map((s) => s.id));
    for (const k of capsCache.keys()) if (!ids.has(k)) capsCache.delete(k);
  }, [servers]);
  const activeId = currentSession?.serverId ?? null;
  const supervised = useSupervisedSessions();
  const [collapsed, setCollapsed] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  // Cross-server session list, populated when the subscribe modal opens.
  // Shape: one entry per (server, project, session). The modal groups by server.
  const [crossServerSessions, setCrossServerSessions] = useState<
    Array<{ serverId: string; serverLabel: string; project: string; name: string; displayName?: string }>
  >([]);
  const [pendingProjects, setPendingProjects] = useState<Record<string, string[]>>({});
  // Per-server registered project list (the unified project registry, kept in
  // lockstep with the supervisor's watched set). Folded into the subscribe modal
  // so a project with NO sessions yet — e.g. one only added from the Bridge rail —
  // still shows here, instead of the list being purely session-derived.
  const [serverProjects, setServerProjects] = useState<Record<string, string[]>>({});
  const [addProjectOpenFor, setAddProjectOpenFor] = useState<string | null>(null);
  const [addProjectInput, setAddProjectInput] = useState('');
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [addSessionOpenFor, setAddSessionOpenFor] = useState<string | null>(null); // composite key "serverId|project"
  const [addSessionInput, setAddSessionInput] = useState('');
  const [addSessionError, setAddSessionError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const serverLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) m.set(s.id, s.label);
    return m;
  }, [servers]);

  const serverIconById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) if (s.icon) m.set(s.id, s.icon);
    return m;
  }, [servers]);

  // Build ordered entries: use stored order, append any keys not yet in order
  const projectSubscriptions = useMemo(() => {
    const allKeys = Object.keys(subscriptions);
    const orderedKeys = order.filter((k) => k in subscriptions);
    const unorderedKeys = allKeys.filter((k) => !order.includes(k));
    return [...orderedKeys, ...unorderedKeys].map((k) => [k, subscriptions[k]] as [string, typeof subscriptions[string]]);
  }, [subscriptions, order]);

  // Rows shown in the Watching list. A supervised session is surfaced in the
  // Supervisor panel instead, so hide it here (the underlying subscription
  // stays — it's what feeds the supervisor card's live status). Stop
  // supervising and it reappears here.
  const visibleSubscriptions = useMemo(
    () => projectSubscriptions.filter(([, sub]) => !supervised.set.has(`${sub.project}:${sub.session}`)),
    [projectSubscriptions, supervised.set],
  );

  const handleDragStart = useCallback((e: React.DragEvent, key: string) => {
    dragKeyRef.current = key;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(key);
  }, []);

  const handleDragEnd = useCallback(() => {
    const fromKey = dragKeyRef.current;
    const toKey = dragOverKey;
    dragKeyRef.current = null;
    setDragOverKey(null);
    if (!fromKey || !toKey || fromKey === toKey) return;
    const keys = projectSubscriptions.map(([k]) => k);
    const fromIdx = keys.indexOf(fromKey);
    const toIdx = keys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;
    keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, fromKey);
    reorder(keys);
  }, [dragOverKey, projectSubscriptions, reorder]);

  // Sessions available for subscribing — filter the cross-server fan-out by
  // existing subscriptions (composite-keyed by serverId).
  const availableSessions = useMemo(() => {
    const subscribedKeys = new Set(projectSubscriptions.map(([key]) => key));
    // Safety net: dedup by (serverId, project, name) before rendering the
    // picker. The registry list() already dedups at the source, but a stale
    // fan-out or a server returning the same session twice would otherwise
    // surface it twice in the subscribe list.
    const seen = new Set<string>();
    const uniqueCrossServer = crossServerSessions.filter((s) => {
      const k = `${s.serverId}:${s.project}:${s.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return uniqueCrossServer
      .filter((s) => !subscribedKeys.has(`${s.serverId}:${s.project}:${s.name}`))
      .sort((a, b) => {
        const labA = a.serverLabel ?? '';
        const labB = b.serverLabel ?? '';
        const labCmp = labA.localeCompare(labB, undefined, { sensitivity: 'base' });
        if (labCmp !== 0) return labCmp;
        const projAFull = a.project ?? '';
        const projBFull = b.project ?? '';
        const projA = projAFull.split('/').pop() ?? projAFull;
        const projB = projBFull.split('/').pop() ?? projBFull;
        const projCmp = projA.localeCompare(projB, undefined, { sensitivity: 'base' });
        if (projCmp !== 0) return projCmp;
        const nameA = (a.displayName || a.name) ?? '';
        const nameB = (b.displayName || b.name) ?? '';
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      });
  }, [crossServerSessions, projectSubscriptions]);

  // Group available sessions by server for the modal.
  const availableByServer = useMemo(() => {
    const map = new Map<string, { label: string; items: typeof availableSessions }>();
    for (const s of availableSessions) {
      const cur = map.get(s.serverId) ?? { label: s.serverLabel, items: [] };
      cur.items.push(s);
      map.set(s.serverId, cur);
    }
    return Array.from(map.entries());
  }, [availableSessions]);

  // Fan-out: when the modal opens, ask main for each server's session list.
  // Falls back to the active-server `sessions` from useSessionStore for plain
  // browser tabs where window.mc isn't present.
  useEffect(() => {
    if (!showDropdown) return;
    let cancelled = false;
    const mc = (window as any).mc;
    (async () => {
      if (mc?.listSessionsForServer && servers.length > 0) {
        // Populate per-server as each resolves rather than awaiting them all —
        // one offline/slow peer (whose fetch sits until its timeout) must not
        // blank out the reachable servers. Each server's slice replaces only
        // its own entries, keyed by serverId.
        const activeIds = new Set(servers.map((s) => s.id));
        // Drop stale entries for servers no longer present, then fill in fresh.
        if (!cancelled) setCrossServerSessions((prev) => prev.filter((e) => activeIds.has(e.serverId)));
        servers.forEach(async (s) => {
          const list = await mc.listSessionsForServer(s.id).catch(() => []);
          if (cancelled) return;
          const slice = list
            .filter((row: any) => row && row.project)
            .map((row: any) => {
              // The server's /api/sessions returns `{ project, session, lastAccess }`;
              // the renderer's sessionStore uses `name`/`displayName`. Normalize.
              const name = row.name ?? row.session ?? '';
              return {
                serverId: s.id,
                serverLabel: s.label,
                project: String(row.project),
                name,
                displayName: row.displayName ?? name,
              };
            });
          setCrossServerSessions((prev) => [...prev.filter((e) => e.serverId !== s.id), ...slice]);
        });
      } else {
        // Plain browser: only the active server's sessions are reachable; tag them.
        if (!cancelled) {
          setCrossServerSessions(
            sessions.map((s) => ({
              serverId: activeId ?? '',
              serverLabel: serverLabelById.get(activeId ?? '') ?? '(local)',
              project: s.project,
              name: s.name,
              displayName: s.displayName,
            }))
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [showDropdown, servers, sessions, activeId, serverLabelById, refreshTick]);

  // Fan-out the unified project list per server when the modal opens, so projects
  // without sessions (e.g. added from the Bridge rail) still appear in the picker.
  useEffect(() => {
    if (!showDropdown) return;
    let cancelled = false;
    const mc = (window as any).mc;
    if (!mc?.invokeOnServer || servers.length === 0) return;
    const activeIds = new Set(servers.map((s) => s.id));
    setServerProjects((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id))));
    servers.forEach(async (s) => {
      const res = await mc.invokeOnServer(s.id, { path: '/api/projects', method: 'GET' }).catch(() => null);
      if (cancelled || !res?.ok) return;
      const paths = ((res.body as any)?.projects ?? [])
        .map((p: any) => (typeof p === 'string' ? p : p?.path))
        .filter((p: any): p is string => typeof p === 'string');
      setServerProjects((prev) => ({ ...prev, [s.id]: paths }));
    });
    return () => { cancelled = true; };
  }, [showDropdown, servers, refreshTick]);

  const handleAddProject = useCallback(async (serverId: string) => {
    const path = addProjectInput.trim();
    if (!path.startsWith('/')) {
      setAddProjectError('Path must be absolute (start with "/")');
      return;
    }
    const mc = (window as any).mc;
    if (mc?.invokeOnServer) {
      const res = await mc.invokeOnServer(serverId, {
        path: '/api/projects',
        method: 'POST',
        body: { path },
      }).catch(() => null);
      if (res?.ok) {
        setRefreshTick((t) => t + 1);
        setAddProjectInput('');
        setAddProjectOpenFor(null);
        setAddProjectError(null);
        return;
      }
      // Server rejected — keep the form open so the user sees the error.
      setAddProjectError(
        typeof res?.body === 'object' && res?.body && 'error' in res.body
          ? String((res.body as any).error)
          : `Server rejected (${res?.status ?? 'no response'})`,
      );
      return;
    }
    // No bridge (browser tab): fall back to a renderer-only pending project
    // so the user can still author a session under it via Task E's flow.
    setPendingProjects((p) => ({
      ...p,
      [serverId]: Array.from(new Set([...(p[serverId] ?? []), path])),
    }));
    setAddProjectInput('');
    setAddProjectOpenFor(null);
  }, [addProjectInput]);

  const handleAddSession = useCallback(async (serverId: string, project: string) => {
    const name = addSessionInput.trim();
    if (!name) {
      setAddSessionError('Session name required');
      return;
    }
    const mc = (window as any).mc;
    if (!mc?.invokeOnServer) {
      setAddSessionError('Adding sessions requires the desktop app');
      return;
    }
    const res = await mc.invokeOnServer(serverId, {
      path: '/api/sessions',
      method: 'POST',
      body: { project, session: name },
    }).catch(() => null);
    if (!res?.ok) {
      setAddSessionError(
        typeof res?.body === 'object' && res?.body && 'error' in res.body
          ? String((res.body as any).error)
          : `Server rejected (${res?.status ?? 'no response'})`
      );
      return;
    }
    // Auto-subscribe so the new session lands in Watching immediately.
    subscribe(serverId, project, name);
    // Launch a Claude worker into the new session (tmux -> claude -> /collab).
    // Creating a session is the "spin one up" action, so it owns the launch;
    // subscribing to an already-running session does NOT (that's just watching).
    void mc.invokeOnServer(serverId, {
      path: '/api/ide/launch-session',
      method: 'POST',
      body: { project, session: name, allowedTools: 'Bash Edit Write Read mcp__plugin_mermaid-collab_mermaid' },
    });
    // If this was a pending project, promote it: server now knows about it,
    // so drop from pendingProjects.
    setPendingProjects((p) => {
      const list = p[serverId] ?? [];
      const filtered = list.filter((q) => q !== project);
      if (filtered.length === list.length) return p;
      return { ...p, [serverId]: filtered };
    });
    setRefreshTick((t) => t + 1);
    setAddSessionInput('');
    setAddSessionOpenFor(null);
    setAddSessionError(null);
  }, [addSessionInput, subscribe]);

  // Navigate to a watched row. Side-effects (create terminal, focus browser
  // tab) fire via per-server IPC in the row click handler — they target the
  // row's serverId without touching the active server. Here we only update
  // local state for SAME-server rows. For cross-server rows we do nothing:
  // the active server stays put, the URL stays put, and the row's per-server
  // actions still fire.
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const handleNavigate = useCallback(
    (sub: SubscribedSession) => {
      if (sub.serverId && activeId && sub.serverId !== activeId) {
        return; // cross-server — never switch active or update local context
      }
      const target = sessions.find((s) => s.project === sub.project && s.name === sub.session);
      if (target) setCurrentSession(target);
      // The Bridge is per-project — clicking a watched session drives the Bridge
      // to that session's project.
      setActiveProject(sub.project);
      onNavigate?.(sub.serverId ?? activeId ?? '', sub.project, sub.session);
    },
    [sessions, setCurrentSession, setActiveProject, onNavigate, activeId],
  );

  const handleToggleSupervise = useCallback(
    async (sub: SubscribedSession, next: boolean) => {
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = next
        ? { project: sub.project, session: sub.session, source: 'manual' }
        : { project: sub.project, session: sub.session };
      const method = next ? 'POST' : 'DELETE';
      // Optimistically move the card between the Watching and Supervisor groups
      // so it doesn't blink out and wait for the next poll/reload. Both the
      // Watching filter (local set) and the Supervisor panel (store) are updated
      // up front, then reconciled with the server below.
      supervised.setOptimistic(sub.project, sub.session, next);
      useSupervisorStore.getState().setSupervisedLocal(
        { project: sub.project, session: sub.session, source: 'manual', serverId: sub.serverId },
        next,
      );
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(sub.serverId, { path, method, body });
      } else {
        await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
      // Reconcile both views with server truth.
      supervised.refresh();
      if (sub.serverId) void useSupervisorStore.getState().loadSupervised(sub.serverId);
    },
    [supervised],
  );

  const handleSubscribe = useCallback(
    (serverId: string, project: string, sessionName: string) => {
      subscribe(serverId, project, sessionName);
      setShowDropdown(false);
    },
    [subscribe],
  );

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span>Watching</span>
          <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">
            {visibleSubscriptions.length}
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
        {/* Subscribe button */}
        <button
          onClick={() => setShowDropdown(true)}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Subscribe to a session"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* Subscribe modal */}
        {showDropdown && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDropdown(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl w-80 max-h-96 flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Watch a session</span>
                <button onClick={() => setShowDropdown(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto py-1">
                {(() => {
                  const groupMap = new Map(availableByServer);
                  // Ensure every known server has a group entry so the user can
                  // still add a project even if no sessions are reachable yet.
                  const rendered: Array<[string, { label: string; items: typeof availableSessions }]> = [];
                  for (const srv of servers) {
                    const existing = groupMap.get(srv.id);
                    rendered.push([srv.id, existing ?? { label: srv.label, items: [] }]);
                    groupMap.delete(srv.id);
                  }
                  // Append any leftover groups (e.g. sessions for servers no longer in `servers`).
                  for (const [id, group] of groupMap) rendered.push([id, group]);

                  if (rendered.length === 0) {
                    return (
                      <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                        No sessions available to watch
                      </div>
                    );
                  }

                  return rendered.map(([serverId, group]) => {
                    const hasContent =
                      group.items.length > 0 || (pendingProjects[serverId]?.length ?? 0) > 0;
                    return (
                    <details key={serverId} open={hasContent} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700">
                      <summary className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2">
                        <ServerIcon name={serverIconById.get(serverId)} size={14} title={group.label} />
                        <span>{group.label}</span>
                        <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">{group.items.length}</span>
                      </summary>
                      {/* New project affordance */}
                      <div className="px-4 py-1.5 flex items-center gap-2">
                        {addProjectOpenFor === serverId ? (
                          <>
                            <input
                              autoFocus
                              type="text"
                              value={addProjectInput}
                              placeholder="/absolute/path"
                              onChange={(e) => { setAddProjectInput(e.target.value); setAddProjectError(null); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); void handleAddProject(serverId); }
                                else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setAddProjectOpenFor(null);
                                  setAddProjectInput('');
                                  setAddProjectError(null);
                                }
                              }}
                              className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                            />
                            <button
                              onClick={() => void handleAddProject(serverId)}
                              className="text-xs px-2 py-1 rounded bg-accent-600 text-white hover:bg-accent-700"
                            >
                              Add
                            </button>
                            <button
                              onClick={() => {
                                setAddProjectOpenFor(null);
                                setAddProjectInput('');
                                setAddProjectError(null);
                              }}
                              className="text-xs px-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              title="Cancel"
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              setAddProjectOpenFor(serverId);
                              setAddProjectInput('');
                              setAddProjectError(null);
                            }}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                          >
                            + New project
                          </button>
                        )}
                      </div>
                      {addProjectOpenFor === serverId && addProjectError && (
                        <div className="px-4 pb-1 text-xs text-danger-500">{addProjectError}</div>
                      )}
                      {(() => {
                        // Union of distinct projects: real items + pending.
                        const realProjects: string[] = [];
                        const seen = new Set<string>();
                        for (const it of group.items) {
                          if (!seen.has(it.project)) {
                            seen.add(it.project);
                            realProjects.push(it.project);
                          }
                        }
                        const pending = pendingProjects[serverId] ?? [];
                        // Order: pending projects first (newly created, empty),
                        // then existing/real projects. Header → + New project →
                        // pending → existing (each with + New session).
                        const pendingOnly: string[] = [];
                        for (const p of pending) {
                          if (!seen.has(p)) {
                            seen.add(p);
                            pendingOnly.push(p);
                          }
                        }
                        // Registered projects with no sessions yet (e.g. added from
                        // the Bridge rail) — fold them in so the list corresponds
                        // with the Bridge instead of being purely session-derived.
                        const registeredOnly: string[] = [];
                        for (const p of serverProjects[serverId] ?? []) {
                          if (!seen.has(p)) {
                            seen.add(p);
                            registeredOnly.push(p);
                          }
                        }
                        // Pending (just-created, empty) projects stay pinned on
                        // top; the rest are sorted alphabetically by display name.
                        const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
                        const byName = (a: string, b: string) =>
                          baseName(a).localeCompare(baseName(b), undefined, { sensitivity: 'base' });
                        const allProjects = [
                          ...pendingOnly,
                          ...[...registeredOnly, ...realProjects].sort(byName),
                        ];
                        return allProjects.map((project) => {
                          const isPending = pending.includes(project) && !realProjects.includes(project);
                          const projectItems = group.items.filter((s) => s.project === project);
                          const compositeKey = `${serverId}|${project}`;
                          const sessionOpen = addSessionOpenFor === compositeKey;
                          return (
                            <details key={`proj:${serverId}:${project}`} className="group/proj">
                              <summary
                                className="pl-7 pr-4 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5 cursor-pointer list-none hover:bg-gray-50 dark:hover:bg-gray-700/50 [&::-webkit-details-marker]:hidden"
                                title={project}
                              >
                                <span
                                  aria-hidden
                                  className="text-gray-400 dark:text-gray-500 transition-transform group-open/proj:rotate-90"
                                >
                                  ▸
                                </span>
                                <span>{project.split('/').filter(Boolean).pop() ?? project}</span>
                                {isPending && (
                                  <span className="text-gray-400 dark:text-gray-500 font-normal">(new — empty)</span>
                                )}
                              </summary>
                              {projectItems.map((s) => (
                                <button
                                  key={`${s.serverId}:${s.project}:${s.name}`}
                                  onClick={() => handleSubscribe(s.serverId, s.project, s.name)}
                                  className="w-full text-left pl-10 pr-4 py-1.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
                                >
                                  <span aria-hidden className="text-gray-400 dark:text-gray-500">·</span>
                                  <span>{s.displayName || s.name}</span>
                                </button>
                              ))}
                              <div className="pl-10 pr-4 py-1.5 flex items-center gap-2">
                                {sessionOpen ? (
                                  <>
                                    <input
                                      autoFocus
                                      type="text"
                                      value={addSessionInput}
                                      placeholder="session-name"
                                      onChange={(e) => { setAddSessionInput(e.target.value); setAddSessionError(null); }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); void handleAddSession(serverId, project); }
                                        else if (e.key === 'Escape') {
                                          e.preventDefault();
                                          setAddSessionOpenFor(null);
                                          setAddSessionInput('');
                                          setAddSessionError(null);
                                        }
                                      }}
                                      className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                                    />
                                    <button
                                      onClick={() => void handleAddSession(serverId, project)}
                                      className="text-xs px-2 py-1 rounded bg-accent-600 text-white hover:bg-accent-700"
                                    >
                                      Add
                                    </button>
                                    <button
                                      onClick={() => {
                                        setAddSessionOpenFor(null);
                                        setAddSessionInput('');
                                        setAddSessionError(null);
                                      }}
                                      className="text-xs px-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                      title="Cancel"
                                    >
                                      ×
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setAddSessionOpenFor(compositeKey);
                                      setAddSessionInput('');
                                      setAddSessionError(null);
                                    }}
                                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                  >
                                    + New session
                                  </button>
                                )}
                              </div>
                              {sessionOpen && addSessionError && (
                                <div className="px-4 pb-1 text-xs text-danger-500">{addSessionError}</div>
                              )}
                            </details>
                          );
                        });
                      })()}
                    </details>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subscription items */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1">
          {visibleSubscriptions.map(([key, sub]) => (
            <SessionCard
              key={key}
              subKey={key}
              sub={sub}
              serverLabel={serverLabelById.get(sub.serverId)}
              serverIcon={serverIconById.get(sub.serverId)}
              onNavigate={handleNavigate}
              onUnsubscribe={unsubscribe}
              draggable
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragOver={dragOverKey === key}
              isSelected={
                !!currentSession &&
                currentSession.project === sub.project &&
                currentSession.name === sub.session
              }
              supervised={supervised.set.has(`${sub.project}:${sub.session}`)}
              onToggleSupervise={handleToggleSupervise}
            />
          ))}
        </div>
      )}
    </div>
  );
};
