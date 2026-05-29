/**
 * SupervisorPanel — the "Supervisor" sidebar section.
 *
 * v2 model: the supervisor view is roadmap-centric. The active session's
 * serverId is the routing id used to load watched projects, their roadmap
 * items, escalations and locks from `useSupervisorStore`.
 *
 * Live status per roadmap-bound session is read from the Watching feed
 * (`useSubscriptionStore`, WS-fed), falling back to a polled persisted status.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  useSupervisorStore,
  type RoadmapItem,
  type Escalation,
  type Lock,
} from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';

// ---------------------------------------------------------------------------
// Duplicated from SubscriptionsPanel.tsx (ClaudePixAvatar + its helpers are
// module-private there). A future refactor could extract these to a shared
// module (e.g. components/ClaudePixAvatar.tsx) and have both panels import it.
// ---------------------------------------------------------------------------
const CLAUDE_PIX_BASE = '/claudepix';

const ANIMATIONS: Record<string, string[]> = {
  active:     ['work_coding.html', 'dance_bounce_dj.html', 'dance_sway_dj.html', 'dance_djmix.html'],
  waiting:    ['expression_wink.html', 'expression_sleep.html', 'idle_breathe.html', 'idle_blink.html', 'idle_look_around.html'],
  permission: ['expression_surprise.html', 'dance_bounce.html'],
  unknown:    ['idle_breathe.html', 'idle_blink.html', 'idle_look_around.html'],
};

function pickAnimation(status: string): string {
  const pool = ANIMATIONS[status] ?? ANIMATIONS.unknown;
  return `${CLAUDE_PIX_BASE}/${pool[Math.floor(Math.random() * pool.length)]}`;
}

const ClaudePixAvatar: React.FC<{ status: string }> = ({ status }) => {
  const [src] = useState(() => pickAnimation(status));
  const prevStatus = React.useRef(status);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      setCurrentSrc(pickAnimation(status));
    }
  }, [status]);

  return (
    <>
      <div
        className="flex-shrink-0 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
        title="Click to expand"
      >
        <iframe
          src={currentSrc}
          title="Claude"
          scrolling="no"
          frameBorder="0"
          sandbox="allow-scripts"
          className="rounded-sm overflow-hidden pointer-events-none"
          style={{ width: 44, height: 44, imageRendering: 'pixelated', background: 'transparent', display: 'block' }}
        />
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setExpanded(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <iframe
              src={currentSrc}
              title="Claude (expanded)"
              scrolling="no"
              frameBorder="0"
              sandbox="allow-scripts"
              style={{ width: '80vmin', height: '80vmin', imageRendering: 'pixelated', background: 'transparent', display: 'block' }}
            />
            <button
              onClick={() => setExpanded(false)}
              className="absolute -top-4 -right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-gray-800/90 text-gray-700 dark:text-gray-200 shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-colors text-sm font-bold"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
};

function statusBg(status: string): string {
  return status === 'permission'
    ? 'bg-red-300 hover:bg-red-400 border border-red-500'
    : status === 'active'
      ? 'card-pulse-amber border border-amber-400'
      : status === 'waiting'
        ? 'bg-green-300 hover:bg-green-400 border border-green-500'
        : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';
}

// Small inline pill class for a roadmap item's own status.
function statusChipClass(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700';
    case 'in_progress':
    case 'in-progress':
      return 'bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700';
    case 'blocked':
      return 'bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700';
    default:
      return 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600';
  }
}

export interface SupervisorPanelProps {
  currentProject?: string;
  currentSession?: string;
}

export const SupervisorPanel: React.FC<SupervisorPanelProps> = ({ currentProject, currentSession }) => {
  const activeId = useSessionStore((s) => s.currentSession)?.serverId ?? null;
  // Routing scope for supervisor API calls. The supervisor store is GLOBAL
  // (server-side), so its data is the same regardless of which server we route
  // through; fall back to 'local' so the panel still loads when no server is
  // active (e.g. the standalone sidebar). When a desktop bridge is present,
  // 'local' resolves to the local server via the fetch fallback.
  const serverScope = activeId ?? 'local';

  const {
    watchedProjects,
    roadmapByProject,
    escalations,
    locks,
    loadProjects,
    loadRoadmap,
    loadEscalations,
    resolveEscalation,
    loadLocks,
  } = useSupervisorStore();

  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
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
      const launchBody = { project: supervisorProject, session: supervisorSession, role: 'supervisor', invokeSkill: '/supervisor' };
      if (mc?.invokeOnServer) await mc.invokeOnServer(serverId, { path: '/api/ide/launch-session', method: 'POST', body: launchBody });
      else await fetch('/api/ide/launch-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(launchBody) });
    } catch { /* best-effort */ }
    finally { setStartingSup(false); }
  };
  // Persisted status source: map keyed `${serverId}:${project}:${session}` -> status.
  // Polled from GET /api/session-status?project= per distinct (serverId, project).
  const [fetchedStatuses, setFetchedStatuses] = useState<Record<string, string>>({});

  // Load projects / escalations / locks for the active routing server.
  useEffect(() => {
    void loadProjects(serverScope);
    void loadEscalations(serverScope);
    void loadLocks(serverScope);
  }, [serverScope, loadProjects, loadEscalations, loadLocks]);

  // Load roadmap for each watched project.
  const watchedKey = watchedProjects.map((p) => p.project).join('|');
  useEffect(() => {
    for (const p of watchedProjects) {
      void loadRoadmap(serverScope, p.project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverScope, watchedKey, loadRoadmap]);

  const serverIconById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of servers) if (s.icon) m.set(s.id, s.icon);
    return m;
  }, [servers]);
  const activeServerIcon = activeId ? serverIconById.get(activeId) : undefined;

  // Distinct (activeId, project) pairs derived from roadmap items that name a
  // session — the unit of the per-project session-status API.
  const distinctPairs = useMemo(() => {
    if (!activeId) return [] as Array<{ serverId: string; project: string }>;
    const map = new Map<string, { serverId: string; project: string }>();
    for (const [project, items] of Object.entries(roadmapByProject)) {
      if (items.some((it) => it.sessionName)) {
        map.set(`${activeId}|${project}`, { serverId: activeId, project });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.serverId}|${a.project}`.localeCompare(`${b.serverId}|${b.project}`),
    );
  }, [activeId, roadmapByProject]);
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
          const key = `${p.serverId}:${row.project}:${row.session}`;
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

  // Merged live status: WS status takes precedence, then persisted fetch, then 'unknown'.
  const liveStatus = (project: string, session: string): string => {
    const key = `${activeId}:${project}:${session}`;
    return subscriptions[key]?.status ?? fetchedStatuses[key] ?? 'unknown';
  };

  // Set of locked `${project}:${session}` pairs.
  const lockSet = useMemo(
    () => new Set(locks.map((l: Lock) => `${l.project}:${l.session}`)),
    [locks],
  );

  const hasOpenEscalation = escalations.some((e) => e.status === 'open');
  const openEscalations = escalations.filter((e) => e.status === 'open');

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
            {watchedProjects.length}
          </span>
          {hasOpenEscalation && (
            <span
              className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse"
              title="An escalation needs attention"
            >
              !
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
        <button
          onClick={handleStartSupervisor}
          disabled={startingSup}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
          title="Start supervisor (launch + /collab + /supervisor)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M6 4l10 6-10 6V4z" /></svg>
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-3">
          {watchedProjects.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-500 dark:text-gray-400 text-center">
              No supervised projects
            </div>
          ) : (
            watchedProjects.map((wp) => {
              const items = [...(roadmapByProject[wp.project] ?? [])].sort((a, b) => a.ord - b.ord);
              return (
                <div key={wp.project} className="space-y-1">
                  {/* Project sub-header */}
                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                      {wp.project.split('/').pop()}
                    </span>
                    <ServerIcon
                      name={activeServerIcon}
                      size={14}
                      className="flex-shrink-0 text-gray-500 dark:text-gray-400"
                    />
                  </div>

                  {/* Roadmap items */}
                  {items.map((item: RoadmapItem) => {
                    const status = item.sessionName
                      ? liveStatus(wp.project, item.sessionName)
                      : 'unknown';
                    const locked =
                      item.sessionName && lockSet.has(`${wp.project}:${item.sessionName}`);
                    return (
                      <div key={item.id} className="flex items-center gap-1">
                        <div
                          className={`flex-1 flex items-center gap-2 pl-3 pr-2 py-1 rounded text-sm min-w-0 overflow-hidden ${
                            item.sessionName
                              ? statusBg(status)
                              : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <span
                            className={`text-xs truncate flex-1 ${
                              item.sessionName ? 'text-black' : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {item.title}
                          </span>
                          {locked && (
                            <span
                              className="flex-shrink-0 text-black"
                              title="Locked by this session"
                              aria-label="locked"
                            >
                              🔒
                            </span>
                          )}
                          <span
                            className={`flex-shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusChipClass(item.status)}`}
                          >
                            {item.status}
                          </span>
                        </div>
                        {item.sessionName && <ClaudePixAvatar status={status} />}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}

          {/* Escalations inbox */}
          {openEscalations.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Escalations
                </span>
                <span className="text-xs text-red-500 font-normal">{openEscalations.length}</span>
              </div>
              {openEscalations.map((e: Escalation) => (
                <div
                  key={e.id}
                  className="px-2 py-1.5 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-1"
                >
                  <div className="text-xs text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                    {e.questionText}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {`${e.project.split('/').pop()} / ${e.session}`}
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        void resolveEscalation(serverScope, e.id, 'resolved');
                      }}
                      className="px-2 py-0.5 text-[11px] rounded bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700 transition-colors"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => {
                        /* TODO(v2): wire up navigation to the escalating session */
                      }}
                      className="px-2 py-0.5 text-[11px] rounded bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 transition-colors"
                      title="Jump to session"
                    >
                      Jump to session
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
