/**
 * SupervisorPanel — the "Supervisor" sidebar section.
 *
 * Mirrors SubscriptionsPanel's structure. The supervisor identity is the
 * currently-active session (serverId from ServerContext, project/session from
 * props). It declares a set of target sessions it oversees; the authoritative
 * record lives on the server and is mirrored into `useSupervisorStore`.
 *
 * Live status per target is read from the Watching feed (`useSubscriptionStore`,
 * WS-fed). Targets not also in Watching show 'unknown' (see TODO below).
 */
import React, { useState, useMemo, useEffect } from 'react';
import { useSupervisorStore, type SupervisorTarget } from '@/stores/supervisorStore';
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

const SupervisorRow: React.FC<{
  rowKey: string;
  target: SupervisorTarget;
  status: string;
  serverLabel?: string;
  serverIcon?: string;
  onRemove: (key: string) => void;
}> = ({ rowKey, target, status, serverLabel, serverIcon, onRemove }) => {
  return (
    <div className="flex items-center gap-1">
      {/* Colored status card — non-interactive (supervisor targets aren't navigable) */}
      <div
        className={`relative group flex-1 flex items-stretch gap-2 pl-3 pr-2 py-1 rounded text-sm transition-colors min-w-0 overflow-hidden ${statusBg(status)}`}
      >
        {/* Remove button — top-right, appears on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(rowKey);
          }}
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-md border border-gray-300 dark:border-gray-500"
          title="Remove target"
        >
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* Project / Session on two lines */}
        <div className="flex-1 min-w-0 pb-1">
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{target.targetProject.split('/').pop()}</span>
            <ServerIcon
              name={serverIcon}
              size={14}
              className="flex-shrink-0 text-black"
              title={serverLabel ? `Server: ${serverLabel}` : undefined}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{target.targetSession}</span>
          </div>
        </div>
      </div>
      {/* Claude pixel avatar — outside the colored card, right side */}
      <ClaudePixAvatar status={status} />
    </div>
  );
};

export interface SupervisorPanelProps {
  currentProject?: string;
  currentSession?: string;
}

export const SupervisorPanel: React.FC<SupervisorPanelProps> = ({ currentProject, currentSession }) => {
  const { targets, order, loadTargets, addTarget, removeTarget } = useSupervisorStore();
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const { sessions } = useSessionStore();
  const activeSession = useSessionStore((s) => s.currentSession);
  const { servers } = useServers();
  const activeId = activeSession?.serverId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // Persisted status source: map keyed `${serverId}:${project}:${session}` -> status.
  // Polled from GET /api/session-status?project= per distinct (serverId, project).
  const [fetchedStatuses, setFetchedStatuses] = useState<Record<string, string>>({});

  // Supervisor identity = active session. Load its targets from the server.
  useEffect(() => {
    if (activeId && currentProject && currentSession) {
      void loadTargets(activeId, currentProject, currentSession);
    }
  }, [activeId, currentProject, currentSession, loadTargets]);

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

  // Build ordered entries: use stored order, append any keys not yet in order.
  const orderedTargets = useMemo(() => {
    const allKeys = Object.keys(targets);
    const orderedKeys = order.filter((k) => k in targets);
    const unorderedKeys = allKeys.filter((k) => !order.includes(k));
    return [...orderedKeys, ...unorderedKeys].map((k) => [k, targets[k]] as [string, SupervisorTarget]);
  }, [targets, order]);

  // Distinct (serverId, project) pairs among current targets — the unit of
  // the per-project session-status API. Serialized so the poll effect only
  // re-runs when the actual set of pairs changes (not on every render).
  const distinctPairs = useMemo(() => {
    const map = new Map<string, { serverId: string; project: string }>();
    for (const [, t] of orderedTargets) {
      map.set(`${t.serverId}|${t.targetProject}`, {
        serverId: t.serverId,
        project: t.targetProject,
      });
    }
    return Array.from(map.values()).sort((a, b) =>
      `${a.serverId}|${a.project}`.localeCompare(`${b.serverId}|${b.project}`),
    );
  }, [orderedTargets]);
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

  // Merged status per target: live WS status takes precedence, then persisted
  // fetch, then 'unknown'. Both use the same `${serverId}:${project}:${session}` key.
  const statusForKey = (t: SupervisorTarget): string => {
    const key = `${t.serverId}:${t.targetProject}:${t.targetSession}`;
    return subscriptions[key]?.status ?? fetchedStatuses[key] ?? 'unknown';
  };

  // Escalation: any target currently requesting permission needs attention.
  // Uses the SAME merged status so a persisted 'permission' also triggers it.
  // TODO(v1): escalation triggers only on 'permission'; waiting+todos are
  // handled by the supervisor skill, not surfaced as a badge here.
  const escalating = orderedTargets.some(([, t]) => statusForKey(t) === 'permission');

  // Candidate sessions for the add-target picker: active server's sessions,
  // minus the supervisor's own session and any already-targeted ones.
  const candidateSessions = useMemo(() => {
    const targetedKeys = new Set(
      orderedTargets.map(([, t]) => `${t.targetProject}:${t.targetSession}`),
    );
    return sessions.filter((s) => {
      if (activeId && s.serverId && s.serverId !== activeId) return false;
      if (s.project === currentProject && s.name === currentSession) return false;
      if (targetedKeys.has(`${s.project}:${s.name}`)) return false;
      return true;
    });
  }, [sessions, orderedTargets, activeId, currentProject, currentSession]);

  const canAdd = !!activeId && !!currentProject && !!currentSession;

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
            {orderedTargets.length}
          </span>
          {escalating && (
            <span
              className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold animate-pulse"
              title="A target needs attention"
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
        {/* Add-target button */}
        <button
          onClick={() => setShowPicker(true)}
          disabled={!canAdd}
          className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Assign a target session"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {/* Add-target picker modal */}
        {showPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowPicker(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-xl w-80 max-h-96 flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assign a target session</span>
                <button onClick={() => setShowPicker(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto py-1">
                {candidateSessions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                    No sessions available to supervise
                  </div>
                ) : (
                  candidateSessions.map((s) => (
                    <button
                      key={`${s.serverId}:${s.project}:${s.name}`}
                      onClick={() => {
                        if (!canAdd) return;
                        void addTarget(activeId!, currentProject!, currentSession!, s.project, s.name);
                        setShowPicker(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
                    >
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.project.split('/').pop()}</span>
                      <span aria-hidden className="text-gray-400 dark:text-gray-500">/</span>
                      <span className="truncate">{s.displayName || s.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Target items */}
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1">
          {orderedTargets.map(([key, target]) => (
            <SupervisorRow
              key={key}
              rowKey={key}
              target={target}
              status={statusForKey(target)}
              serverLabel={serverLabelById.get(target.serverId)}
              serverIcon={serverIconById.get(target.serverId)}
              onRemove={removeTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
};
