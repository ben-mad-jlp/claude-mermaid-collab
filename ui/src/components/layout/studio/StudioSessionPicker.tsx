/**
 * StudioSessionPicker — the in-Studio entry point (Control-UI vision §3).
 *
 * The Studio/Bridge split stripped Studio's left rail down to a single-session
 * spine, which left a standalone simple-workflow user with no way to PICK a
 * session from inside Studio (dive-in only flows from the Bridge). This restores
 * a compact SESSIONS list — the user's watched/recent sessions — rendered with
 * the SAME rich `SessionCard` the old Watching panel / Supervisor panel use
 * (live status, context% gauge, claude avatar, supervise toggle), reusing that
 * component rather than a bespoke text list.
 *
 * Selecting a card sets the current session + flips to Studio and fires the
 * card's normal activation side-effects (`activateSessionCard` — spawn terminal,
 * focus browser), after which the normal Studio rail (chip + ContextChip + todos
 * + ArtifactTree + Servers) renders as designed. Kept Studio-clean: just the
 * cards and the tree below — no Bridge worker-pool chrome, no subscribe modal.
 *
 * It auto-expands when there is no current session (the entry case) and
 * collapses to a thin header once one is selected.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useServers } from '@/contexts/ServerContext';
import { SessionCard, type SessionCardData } from '@/components/layout/SessionCard';
import type { Session } from '@/types/session';

export const StudioSessionPicker: React.FC = () => {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSession = useSessionStore((s) => s.currentSession);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const supervisedList = useSupervisorStore((s) => s.supervised);
  const setMode = useUIStore((s) => s.setMode);
  const { servers } = useServers();

  // Default open when there's nothing selected (the entry case); collapsible.
  const [open, setOpen] = useState(!currentSession);

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

  const supervisedSet = useMemo(
    () => new Set(supervisedList.map((s) => `${s.project}:${s.session}`)),
    [supervisedList],
  );

  // Merge known scope sessions with live watched subscriptions into the rich
  // card's data shape. Subscriptions win (they carry live status / context%).
  const rows = useMemo<Array<{ key: string; sub: SessionCardData }>>(() => {
    const byKey = new Map<string, SessionCardData>();
    for (const s of sessions) {
      const key = `${s.serverId}:${s.project}:${s.name}`;
      byKey.set(key, {
        serverId: s.serverId,
        project: s.project,
        session: s.name,
        status: 'unknown',
        lastUpdate: 0,
      });
    }
    for (const sub of Object.values(subscriptions)) {
      const key = `${sub.serverId}:${sub.project}:${sub.session}`;
      byKey.set(key, {
        serverId: sub.serverId,
        project: sub.project,
        session: sub.session,
        claudeSessionId: sub.claudeSessionId,
        status: sub.status,
        lastUpdate: sub.lastUpdate,
        contextPercent: sub.contextPercent,
      });
    }
    return Array.from(byKey.entries())
      .map(([key, sub]) => ({ key, sub }))
      .sort((a, b) => {
        // Live sessions first, then most-recently-updated, then by name.
        if (b.sub.lastUpdate !== a.sub.lastUpdate) return b.sub.lastUpdate - a.sub.lastUpdate;
        return a.sub.session.localeCompare(b.sub.session);
      });
  }, [sessions, subscriptions]);

  // Click a card → select the session and stay in Studio. The card itself fires
  // activateSessionCard (terminal + browser focus) on click, so we only own the
  // state side here (mirrors useDiveIn without double-firing the side-effects).
  const handleNavigate = useCallback(
    (sub: SessionCardData) => {
      const match = sessions.find((s) => s.project === sub.project && s.name === sub.session);
      // The sessions list carries no serverId, so a `match` would drop the card's
      // owning server and strand document reads on the local origin. Keep any
      // display fields from `match` but always pin the real serverId.
      const session: Session = {
        ...(match ?? {}),
        project: sub.project,
        name: sub.session,
        serverId: sub.serverId,
      };
      setCurrentSession(session);
      setMode('studio');
    },
    [sessions, setCurrentSession, setMode],
  );

  // Supervise toggle — same optimistic-then-reconcile path as the Watching panel.
  const handleToggleSupervise = useCallback(async (sub: SessionCardData, next: boolean) => {
    const mc = (window as any).mc;
    const path = '/api/supervisor/supervised';
    const body = next
      ? { project: sub.project, session: sub.session, source: 'manual' }
      : { project: sub.project, session: sub.session };
    const method = next ? 'POST' : 'DELETE';
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
    if (sub.serverId) void useSupervisorStore.getState().loadSupervised(sub.serverId);
  }, []);

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
        <div className="px-2 pb-2 pt-1 space-y-1 max-h-72 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-2xs text-gray-400 dark:text-gray-500 italic">
              No sessions in scope yet.
            </p>
          ) : (
            rows.map(({ key, sub }) => (
              <SessionCard
                key={key}
                sub={sub}
                serverLabel={serverLabelById.get(sub.serverId)}
                serverIcon={serverIconById.get(sub.serverId)}
                onNavigate={handleNavigate}
                isSelected={
                  !!currentSession &&
                  currentSession.project === sub.project &&
                  currentSession.name === sub.session
                }
                supervised={supervisedSet.has(`${sub.project}:${sub.session}`)}
                onToggleSupervise={handleToggleSupervise}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default StudioSessionPicker;
