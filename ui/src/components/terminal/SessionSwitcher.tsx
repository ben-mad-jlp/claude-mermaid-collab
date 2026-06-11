/**
 * SessionSwitcher — left rail of the terminal pane (replaces the at-a-glance role
 * the old tab strip played).
 *
 * Lists every OPEN terminal session (terminalStore tabs) across servers, each row
 * with a liveness status dot. Selecting a row flips the single persistent console
 * to that (serverId, session) target — it does not spawn/teardown a PTY.
 *
 * Liveness is DERIVED INLINE from existing signals — subscriptionStore freshness +
 * the supervisor todo cache — via the shared `deriveLiveness`/`currentTodoFor`
 * (the same source the WorkerRoster/supervised cards use). NO new WS events or
 * polling are introduced (constraint b2fe36b1): the only timer here is the local
 * staleness re-tick, exactly as WorkerRoster does it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useServers } from '@/contexts/ServerContext';
import { ServerIcon } from '@/components/ServerIcon';
import {
  currentTodoFor,
  deriveLiveness,
  roleGlyph,
  type Liveness,
} from '@/lib/liveness';
import type { TerminalTab } from '@/stores/terminalStore';

export interface SessionSwitcherProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
}

type SubStatus = 'active' | 'waiting' | 'permission' | 'unknown';

/** Dot color by session status, matching the WorkerRoster / left-tree palette:
 *  permission = red (needs you), active = amber (working), waiting = green
 *  (ready/idle-waiting), unknown = grey. A stale session holding a todo (crashed)
 *  reads red. */
function statusDot(status: SubStatus, crashed: boolean): string {
  if (crashed) return 'bg-danger-500';
  switch (status) {
    case 'permission':
      return 'bg-danger-500';
    case 'active':
      return 'bg-warning-500';
    case 'waiting':
      return 'bg-success-500';
    default:
      return 'bg-gray-300 dark:bg-gray-600';
  }
}

export const SessionSwitcher: React.FC<SessionSwitcherProps> = ({ tabs, activeTabId, onSelect }) => {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const todosByProject = useSupervisorStore((s) => s.todosByProject);
  const { servers } = useServers();

  // Local staleness re-tick — re-evaluates liveness without a fresh store event.
  // This is NOT polling a server; it only re-reads timestamps already in memory.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Flatten the cached todos once so `currentTodoFor` can find a session's claim.
  const allTodos = useMemo(
    () => Object.values(todosByProject).flat(),
    [todosByProject],
  );

  const rows = useMemo(() => {
    const subs = Object.values(subscriptions);
    return tabs.map((tab) => {
      // Match the tab to its subscription on the stable (project, session)
      // identity, preferring an exact serverId match — tab.serverId can be the
      // 'local' sentinel while the subscription carries the real server id.
      const exact = subs.find(
        (s) => s.project === tab.project && s.session === tab.session && s.serverId === tab.serverId,
      );
      const sub = exact ?? subs.find((s) => s.project === tab.project && s.session === tab.session);
      const status: SubStatus = sub?.status ?? 'unknown';
      const currentTodo = currentTodoFor(tab.session, allTodos);
      const liveness: Liveness = deriveLiveness(
        { status, lastUpdate: sub?.lastUpdate ?? null },
        currentTodo,
        now,
      );
      // Resolve the 'local' sentinel to the real local server (same as the drawer
      // / supervised cards): worker tabs carry serverId='local'.
      const srv =
        servers.find((s) => s.id === tab.serverId) ??
        ((!tab.serverId || tab.serverId === 'local')
          ? (servers.find((s) => s.source === 'local') ??
             servers.find((s) => s.host === '127.0.0.1' || s.host === 'localhost'))
          : undefined);
      const serverLabel = tab.serverLabel || srv?.label || '(unknown)';
      return { tab, status, liveness, srv, serverLabel };
    });
  }, [tabs, subscriptions, allTodos, now, servers]);

  return (
    <div
      data-testid="session-switcher"
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0,
        borderRight: '1px solid #30363d', background: '#161b22',
        overflowY: 'auto',
      }}
    >
      {rows.length === 0 ? (
        <div style={{ color: '#6e7681', fontSize: 11, padding: 8 }}>No sessions open</div>
      ) : (
        rows.map(({ tab, status, liveness, srv, serverLabel }) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              data-testid={`switcher-row-${tab.session}`}
              title={`${tab.title} · ${serverLabel} · ${liveness === 'crashed' ? 'unresponsive' : status}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', cursor: 'pointer', textAlign: 'left',
                fontSize: 12, color: '#c9d1d9',
                background: isActive ? '#0d1117' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2px solid #58a6ff' : '2px solid transparent',
                opacity: liveness === 'active' || isActive ? 1 : 0.7,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden="true"
                className={statusDot(status, liveness === 'crashed')}
                style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%' }}
              />
              <span aria-hidden="true" style={{ flexShrink: 0 }}>{roleGlyph(tab.session)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tab.title}
              </span>
              {!tab.hideServerIcon && <ServerIcon name={srv?.icon} size={12} title={`server: ${serverLabel}`} />}
            </button>
          );
        })
      )}
    </div>
  );
};

export default SessionSwitcher;
