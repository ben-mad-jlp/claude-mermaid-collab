/**
 * StudioSessionPicker — the in-Studio entry point (Control-UI vision §3).
 *
 * The Studio/Bridge split stripped Studio's left rail down to a single-session
 * spine, which left a standalone simple-workflow user with no way to PICK a
 * session from inside Studio (dive-in only flows from the Bridge). This restores
 * a compact, Studio-clean SESSIONS list — the user's watched/recent sessions —
 * without re-adding the Bridge worker pool's orchestration chrome.
 *
 * Selecting a session reuses the exact dive side-effects (`useDiveIn`:
 * setCurrentSession + activateSessionCard), after which the normal Studio rail
 * (chip + ContextChip + todos + ArtifactTree + Servers) renders as designed.
 *
 * It auto-expands when there is no current session (the entry case) and
 * collapses to a thin header once one is selected.
 */

import React, { useMemo, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useDiveIn } from '@/hooks/useDiveIn';

type Status = 'active' | 'waiting' | 'permission' | 'unknown' | 'none';

interface PickerRow {
  key: string;
  project: string;
  session: string;
  serverId: string;
  status: Status;
  lastUpdate: number;
}

function statusDot(status: Status): string {
  switch (status) {
    case 'active':
      return 'bg-success-500';
    case 'waiting':
    case 'permission':
      return 'bg-warning-500';
    default:
      return 'bg-gray-300 dark:bg-gray-600';
  }
}

export const StudioSessionPicker: React.FC = () => {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSession = useSessionStore((s) => s.currentSession);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const diveIn = useDiveIn();

  // Default open when there's nothing selected (the entry case); collapsible.
  const [open, setOpen] = useState(!currentSession);

  const rows = useMemo<PickerRow[]>(() => {
    const byKey = new Map<string, PickerRow>();
    // Known sessions for the current scope.
    for (const s of sessions) {
      const key = `${s.serverId}:${s.project}:${s.name}`;
      byKey.set(key, {
        key,
        project: s.project,
        session: s.name,
        serverId: s.serverId,
        status: 'none',
        lastUpdate: 0,
      });
    }
    // Enrich / add live watched sessions from subscriptions.
    for (const sub of Object.values(subscriptions)) {
      const key = `${sub.serverId}:${sub.project}:${sub.session}`;
      byKey.set(key, {
        key,
        project: sub.project,
        session: sub.session,
        serverId: sub.serverId,
        status: sub.status,
        lastUpdate: sub.lastUpdate,
      });
    }
    return Array.from(byKey.values()).sort((a, b) => {
      // Live sessions first, then most-recently-updated, then by name.
      if (b.lastUpdate !== a.lastUpdate) return b.lastUpdate - a.lastUpdate;
      return a.session.localeCompare(b.session);
    });
  }, [sessions, subscriptions]);

  return (
    <div data-testid="studio-session-picker" className="border-b border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-3xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span aria-hidden="true" className="text-2xs">{open ? '▾' : '▸'}</span>
        <span>Sessions</span>
        <span className="ml-auto text-gray-400 dark:text-gray-500 normal-case">{rows.length}</span>
      </button>

      {open && (
        <div className="pb-1 max-h-56 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-2xs text-gray-400 dark:text-gray-500 italic">
              No sessions in scope yet.
            </p>
          ) : (
            rows.map((r) => {
              const isCurrent =
                currentSession?.project === r.project && currentSession?.name === r.session;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => diveIn({ project: r.project, session: r.session, serverId: r.serverId })}
                  data-testid={`studio-session-${r.session}`}
                  title={`${r.project} / ${r.session}`}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    isCurrent
                      ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`shrink-0 w-2 h-2 rounded-full ${statusDot(r.status)}`} aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate font-medium">{r.session}</span>
                  {r.status !== 'none' && (
                    <span className="shrink-0 text-3xs text-gray-400 dark:text-gray-500">{r.status}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default StudioSessionPicker;
