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
import { createPortal } from 'react-dom';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useBrowserStore } from '@/stores/browserStore';
import { useTerminalStore } from '@/stores/terminalStore';
import { useServers } from '@/contexts/ServerContext';
import { getWebSocketClient } from '@/lib/websocket';
import { ServerIcon } from '@/components/ServerIcon';

const CLAUDE_PIX_BASE = '/claudepix';

const capsCache = new Map<string, { tmux: boolean }>();
async function fetchCapabilities(serverId: string): Promise<{ tmux: boolean }> {
  if (capsCache.has(serverId)) return capsCache.get(serverId)!;
  const mc = (window as any).mc;
  if (!mc?.getServerCapabilities) return { tmux: true }; // browser fallback: same-origin to its own server
  // Optimistic on failure/nullish: let the call happen — the server response
  // will flip caps off if tmux truly isn't available.
  const caps = (await mc.getServerCapabilities(serverId).catch(() => null)) ?? { tmux: true };
  capsCache.set(serverId, caps);
  return caps;
}

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
  const prevStatus = useRef(status);
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

      {expanded && createPortal(
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
        </div>,
        document.body
      )}
    </>
  );
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return '>1h';
}

function useElapsed(lastUpdate: number, status: string): string | null {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status === 'unknown') return;
    const elapsed = Date.now() - lastUpdate;
    if (elapsed >= 3_600_000) return; // already >1h, no need to keep ticking
    const interval = elapsed < 60_000 ? 1_000 : 60_000;
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [lastUpdate, status, now]);

  if (status === 'unknown') return null;
  return formatElapsed(now - lastUpdate);
}

interface SubscribedSession {
  serverId: string;
  project: string;
  session: string;
  claudeSessionId?: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

function tmuxBaseName(project: string, session: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x';
  const basename = project.split('/').filter(Boolean).pop() ?? 'project';
  return `mc-${slug(basename)}-${slug(session)}`;
}

function useTmuxSessions(): Set<string> {
  const [sessions, setSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch('/api/ide/tmux-sessions')
        .then(r => r.json())
        .then((data: { sessions: string[] }) => {
          if (!cancelled) setSessions(new Set(data.sessions));
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return sessions;
}

function useSupervisedSessions(): { set: Set<string>; refresh: () => void } {
  const [set, setSet] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

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

  return { set, refresh };
}


const SubscriptionRow: React.FC<{
  subKey: string;
  sub: SubscribedSession;
  serverLabel?: string;
  serverIcon?: string;
  onNavigate: (sub: SubscribedSession) => void;
  onUnsubscribe: (key: string) => void;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragEnd: () => void;
  isDragOver: boolean;
  isSelected: boolean;
  tmuxActive: boolean;
  supervised: boolean;
  onToggleSupervise: (sub: SubscribedSession, next: boolean) => void;
}> = ({ subKey, sub, serverLabel, serverIcon, onNavigate, onUnsubscribe, onDragStart, onDragOver, onDragEnd, isDragOver, isSelected, tmuxActive, supervised, onToggleSupervise }) => {
  const elapsed = useElapsed(sub.lastUpdate, sub.status);

  const statusBg =
    sub.status === 'permission'
      ? 'bg-red-300 hover:bg-red-400 border border-red-500'
      : sub.status === 'active'
        ? 'card-pulse-amber border border-amber-400'
        : sub.status === 'waiting'
          ? 'bg-green-300 hover:bg-green-400 border border-green-500'
          : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';

  const ctx = sub.contextPercent;
  const ctxHigh = ctx !== undefined && ctx > 78;
  const ctxWarn = ctx !== undefined && ctx > 68 && ctx <= 78;

  return (
    <div className={`flex items-center gap-1 ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}`}>
      {/* Colored status card */}
      <div
        className={`relative group flex-1 flex items-stretch gap-2 pl-3 pr-2 py-1 rounded text-sm cursor-pointer transition-colors min-w-0 overflow-hidden ${statusBg} ${ctxHigh ? 'ring-2 ring-red-500 ring-inset' : ''}`}
        draggable
        onDragStart={(e) => onDragStart(e, subKey)}
        onDragOver={(e) => onDragOver(e, subKey)}
        onDragEnd={onDragEnd}
        onClick={async () => {
          // Per-server IPC: keep "active server" unchanged when clicking an
          // off-active row. Terminal + browser-focus get routed at sub.serverId.
          onNavigate(sub);
          const mc = (window as any).mc;
          const caps = await fetchCapabilities(sub.serverId);
          if (caps.tmux) {
            if (mc?.invokeOnServer) {
              void mc.invokeOnServer(sub.serverId, {
                path: '/api/ide/create-terminal',
                method: 'POST',
                body: { session: sub.session, project: sub.project },
              });
            } else {
              fetch('/api/ide/create-terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: sub.session, project: sub.project }),
              }).catch(() => {});
            }
          }
          // Always fire browser focus — not gated by tmux capability.
          if (mc?.invokeOnServer) {
            void mc.invokeOnServer(sub.serverId, {
              path: '/api/browser/focus-tab',
              method: 'POST',
              body: { session: sub.session },
            });
          } else {
            fetch('/api/browser/focus-tab', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: sub.session }),
            }).catch(() => {});
          }
          useBrowserStore.getState().activateSession(sub.session);
          void useTerminalStore.getState().openFor(sub.project, sub.session, {
            serverId: sub.serverId,
            serverLabel,
          });
        }}
      >
        {/* Selected-session indicator — accent bar on the left edge */}
        {isSelected && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent-600 dark:bg-accent-400 rounded-l"
          />
        )}
        {/* Unsubscribe button — top-left, appears on hover */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnsubscribe(subKey);
          }}
          className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-md border border-gray-300 dark:border-gray-500"
          title="Unsubscribe"
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
            <span className="text-xs text-black truncate">{sub.project.split('/').pop()}</span>
            <ServerIcon
              name={serverIcon}
              size={14}
              className="flex-shrink-0 text-black"
              title={serverLabel ? `Server: ${serverLabel}` : undefined}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{sub.session}</span>
            {(ctxHigh || ctxWarn) && (
              <span className={`flex-shrink-0 text-[10px] font-bold tabular-nums px-1 py-0.5 rounded leading-none ${ctxHigh ? 'bg-red-500 text-white' : 'bg-yellow-400 text-yellow-900'}`}>
                {ctx}%
              </span>
            )}
            {elapsed && (
              <span className="text-[10px] text-black tabular-nums flex-shrink-0 ml-auto">
                {elapsed}
              </span>
            )}
          </div>
        </div>
        {/* Context bar — pinned to bottom of card */}
        {ctx !== undefined && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
            <div
              className={`h-full transition-all ${
                ctxHigh ? 'bg-red-500 animate-pulse' : ctxWarn ? 'bg-yellow-500' : 'bg-green-400/60'
              }`}
              style={{ width: `${Math.min(ctx, 100)}%` }}
            />
          </div>
        )}
      </div>
      {/* Action buttons — outside the card, own bordered section, square columns */}
      <div className="flex items-center flex-shrink-0 gap-1 px-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSupervise(sub, !supervised);
          }}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-all hover:opacity-80 active:scale-90 active:brightness-75 ${supervised ? 'bg-green-300 text-green-900' : 'bg-gray-200 text-gray-500'}`}
          title={supervised ? 'Stop supervising' : 'Supervise this session'}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.661 2.237a.531.531 0 01.678 0 11.947 11.947 0 007.078 2.749.5.5 0 01.479.425c.069.52.104 1.05.104 1.59 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 01-.332 0C5.26 16.564 2 12.163 2 7c0-.538.035-1.069.104-1.589a.5.5 0 01.48-.425 11.947 11.947 0 007.077-2.75zM10 8a2 2 0 100-4 2 2 0 000 4zm0 1.5c-1.66 0-3 1.12-3 2.5v.5h6v-.5c0-1.38-1.34-2.5-3-2.5z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            const caps = await fetchCapabilities(sub.serverId);
            if (!caps.tmux) return;
            const mc = (window as any).mc;
            if (mc?.invokeOnServer) {
              void mc.invokeOnServer(sub.serverId, {
                path: '/api/ide/create-terminal',
                method: 'POST',
                body: { session: sub.session, project: sub.project },
              });
            } else {
              fetch('/api/ide/create-terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: sub.session, project: sub.project }),
              }).catch(() => {});
            }
          }}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-all hover:opacity-80 active:scale-90 active:brightness-75 ${tmuxActive ? 'bg-green-300 text-green-900' : 'bg-red-300 text-red-900'}`}
          title={tmuxActive ? `Replace tmux session "${sub.session}"` : `Create tmux session "${sub.session}"`}
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {/* Claude pixel avatar — outside the colored card, right side */}
      <ClaudePixAvatar status={sub.status} />
    </div>
  );
};


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
  const tmuxSessions = useTmuxSessions();
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
    return crossServerSessions
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
        const results = await Promise.all(
          servers.map(async (s) => {
            const list = await mc.listSessionsForServer(s.id).catch(() => []);
            return list
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
          })
        );
        if (!cancelled) setCrossServerSessions(results.flat());
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
  const handleNavigate = useCallback(
    (sub: SubscribedSession) => {
      if (sub.serverId && activeId && sub.serverId !== activeId) {
        return; // cross-server — never switch active or update local context
      }
      const target = sessions.find((s) => s.project === sub.project && s.name === sub.session);
      if (target) setCurrentSession(target);
      onNavigate?.(sub.serverId ?? activeId ?? '', sub.project, sub.session);
    },
    [sessions, setCurrentSession, onNavigate, activeId],
  );

  const handleToggleSupervise = useCallback(
    async (sub: SubscribedSession, next: boolean) => {
      const mc = (window as any).mc;
      const path = '/api/supervisor/supervised';
      const body = next
        ? { project: sub.project, session: sub.session, source: 'manual' }
        : { project: sub.project, session: sub.session };
      const method = next ? 'POST' : 'DELETE';
      if (mc?.invokeOnServer) {
        await mc.invokeOnServer(sub.serverId, { path, method, body });
      } else {
        await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }
      supervised.refresh();
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
            {projectSubscriptions.length}
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
        {/* Open all watched sessions in IDE */}
        {projectSubscriptions.length > 0 && (
          <button
            onClick={async () => {
              const mc = (window as any).mc;
              for (const [, sub] of projectSubscriptions) {
                const caps = await fetchCapabilities(sub.serverId);
                if (!caps.tmux) continue;
                if (mc?.invokeOnServer && sub.serverId) {
                  void mc.invokeOnServer(sub.serverId, {
                    path: '/api/ide/create-terminal',
                    method: 'POST',
                    body: { session: sub.session, project: sub.project },
                  });
                } else {
                  fetch('/api/ide/create-terminal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session: sub.session, project: sub.project }),
                  }).catch(() => {});
                }
              }
            }}
            className="px-2 py-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Open all watched sessions in IDE"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
            </svg>
          </button>
        )}
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
                        <div className="px-4 pb-1 text-xs text-red-500">{addProjectError}</div>
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
                        const allProjects = [...pendingOnly, ...realProjects];
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
                                <div className="px-4 pb-1 text-xs text-red-500">{addSessionError}</div>
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
          {projectSubscriptions.map(([key, sub]) => (
            <SubscriptionRow
              key={key}
              subKey={key}
              sub={sub}
              serverLabel={serverLabelById.get(sub.serverId)}
              serverIcon={serverIconById.get(sub.serverId)}
              onNavigate={handleNavigate}
              onUnsubscribe={unsubscribe}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragOver={dragOverKey === key}
              isSelected={
                !!currentSession &&
                currentSession.project === sub.project &&
                currentSession.name === sub.session
              }
              tmuxActive={tmuxSessions.has(tmuxBaseName(sub.project, sub.session))}
              supervised={supervised.set.has(`${sub.project}:${sub.session}`)}
              onToggleSupervise={handleToggleSupervise}
            />
          ))}
        </div>
      )}
    </div>
  );
};
