import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Globe } from 'lucide-react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { getWebSocketClient } from '@/lib/websocket';

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
          allowtransparency="true"
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
              allowtransparency="true"
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
  project: string;
  session: string;
  claudeSessionId?: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
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

function useBrowserSessions(): Set<string> {
  const [sessions, setSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Poll every 15 seconds
    const poll = () => {
      fetch('/api/browser/sessions')
        .then(r => r.json())
        .then((data: { sessions: string[] }) => setSessions(new Set(data.sessions)))
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 15000);

    // Subscribe to WS updates
    const sub = getWebSocketClient().onMessage((msg: any) => {
      if (msg.type === 'browser_tab_update') {
        setSessions(prev => {
          const next = new Set(prev);
          if (msg.active) next.add(msg.session);
          else next.delete(msg.session);
          return next;
        });
      }
    });

    return () => {
      clearInterval(interval);
      sub.unsubscribe();
    };
  }, []);

  return sessions;
}

const SubscriptionRow: React.FC<{
  subKey: string;
  sub: SubscribedSession;
  onNavigate: (project: string, session: string) => void;
  onUnsubscribe: (key: string) => void;
  onDragStart: (e: React.DragEvent, key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragEnd: () => void;
  isDragOver: boolean;
  tmuxActive: boolean;
  browserActive: boolean;
}> = ({ subKey, sub, onNavigate, onUnsubscribe, onDragStart, onDragOver, onDragEnd, isDragOver, tmuxActive, browserActive }) => {
  const elapsed = useElapsed(sub.lastUpdate, sub.status);

  const statusBg =
    sub.status === 'permission'
      ? 'bg-red-300 hover:bg-red-400 border border-red-500'
      : sub.status === 'active'
        ? 'card-pulse-amber border border-amber-400'
        : sub.status === 'waiting'
          ? 'bg-green-300 hover:bg-green-400 border border-green-500'
          : 'bg-gray-200 hover:bg-gray-300 border border-gray-300';

  return (
    <div className={`flex items-center gap-1 ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}`}>
      {/* Colored status card */}
      <div
        className={`relative group flex-1 flex items-stretch gap-2 pl-3 pr-2 py-1 rounded text-sm cursor-pointer transition-colors min-w-0 ${statusBg}`}
        draggable
        onDragStart={(e) => onDragStart(e, subKey)}
        onDragOver={(e) => onDragOver(e, subKey)}
        onDragEnd={onDragEnd}
        onClick={() => {
          onNavigate(sub.project, sub.session);
          fetch('/api/ide/create-terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sub.session }),
          }).catch(() => {});
          if (browserActive) {
            fetch('/api/browser/focus-tab', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: sub.session }),
            }).catch(() => {});
          }
        }}
      >
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{sub.project.split('/').pop()}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-black truncate">{sub.session}</span>
            {sub.contextPercent !== undefined && sub.contextPercent >= 70 && (
              <span
                className={`flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded-full ${
                  sub.contextPercent >= 80
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {sub.contextPercent}%
              </span>
            )}
            {elapsed && (
              <span className="text-[10px] text-black tabular-nums flex-shrink-0 ml-auto">
                {elapsed}
              </span>
            )}
          </div>
        </div>
        {/* text content only now — buttons moved outside */}
      </div>
      {/* Action buttons — outside the card, own bordered section, square columns */}
      <div className="flex items-center flex-shrink-0 gap-1 px-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            fetch('/api/ide/create-terminal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: sub.session }),
            }).catch(() => {});
          }}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-all hover:opacity-80 active:scale-90 active:brightness-75 ${tmuxActive ? 'bg-green-300 text-green-900' : 'bg-red-300 text-red-900'}`}
          title={tmuxActive ? `Replace tmux session "${sub.session}"` : `Create tmux session "${sub.session}"`}
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            fetch('/api/browser/create-tab', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: sub.session }),
            }).catch(() => {});
          }}
          className={`flex items-center justify-center w-7 h-7 rounded-full transition-all hover:opacity-80 active:scale-90 active:brightness-75 ${browserActive ? 'bg-green-300 text-green-900' : 'bg-red-300 text-red-900'}`}
          title={browserActive ? `Chrome tab: ${sub.session}` : 'Open Chrome tab'}
        >
          <Globe className="w-5 h-5" />
        </button>
      </div>
      {/* Claude pixel avatar — outside the colored card, right side */}
      <ClaudePixAvatar status={sub.status} />
    </div>
  );
};


export interface SubscriptionsPanelProps {
  currentProject?: string;
  onNavigate?: (project: string, session: string) => void;
}

export const SubscriptionsPanel: React.FC<SubscriptionsPanelProps> = ({ currentProject, onNavigate }) => {
  const { subscriptions, order, unsubscribe, subscribe, reorder } = useSubscriptionStore();
  const { sessions, setCurrentSession } = useSessionStore();
  const tmuxSessions = useTmuxSessions();
  const browserSessions = useBrowserSessions();
  const [collapsed, setCollapsed] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);

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

  // Sessions available for subscribing (not already subscribed, from all projects)
  const availableSessions = useMemo(() => {
    const subscribedKeys = new Set(
      projectSubscriptions.map(([key]) => key),
    );
    return sessions
      .filter((s) => !subscribedKeys.has(`${s.project}:${s.name}`))
      .sort((a, b) => {
        const projA = a.project.split('/').pop() ?? a.project;
        const projB = b.project.split('/').pop() ?? b.project;
        const projCmp = projA.localeCompare(projB, undefined, { sensitivity: 'base' });
        if (projCmp !== 0) return projCmp;
        const nameA = a.displayName || a.name;
        const nameB = b.displayName || b.name;
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      });
  }, [sessions, projectSubscriptions]);

  const handleNavigate = useCallback(
    (project: string, sessionName: string) => {
      const target = sessions.find(
        (s) => s.project === project && s.name === sessionName,
      );
      if (target) {
        setCurrentSession(target);
        onNavigate?.(project, sessionName);
      }
    },
    [sessions, setCurrentSession, onNavigate],
  );

  const handleSubscribe = useCallback(
    (project: string, sessionName: string) => {
      subscribe(project, sessionName);
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
            onClick={() => {
              for (const [, sub] of projectSubscriptions) {
                fetch('/api/ide/create-terminal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ session: sub.session }),
                }).catch(() => {});
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
                {availableSessions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                    No sessions available to watch
                  </div>
                ) : (
                  availableSessions.map((s) => (
                    <button
                      key={`${s.project}:${s.name}`}
                      onClick={() => handleSubscribe(s.project, s.name)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="text-gray-400 dark:text-gray-500">{s.project.split('/').pop()}</span>
                      <span className="text-gray-400 dark:text-gray-500"> / </span>
                      <span className="text-gray-900 dark:text-gray-100">{s.displayName || s.name}</span>
                    </button>
                  ))
                )}
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
              onNavigate={handleNavigate}
              onUnsubscribe={unsubscribe}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragOver={dragOverKey === key}
              tmuxActive={tmuxSessions.has(sub.session)}
              browserActive={browserSessions.has(sub.session)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
