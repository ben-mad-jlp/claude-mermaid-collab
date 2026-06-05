/**
 * useDiveIn — the one transition that keeps Bridge and Studio from feeling like
 * two apps (Control-UI vision §5, §7 phase 6).
 *
 * A "dive" selects a session, flips to Studio mode, and fires the same
 * activation side-effects a session card does (spawn the session's terminal,
 * focus its browser tab, open the terminal drawer). Worker cards, stream rows,
 * and escalation "Jump" all route through here so the behavior is identical.
 *
 * The shared-element morph itself is handled by the Framer-Motion `layoutId`
 * pairing between the source card and the Studio cockpit frame (see
 * DiveTransition / StudioShell); this hook owns the state side of the dive.
 */

import { useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { activateSessionCard, type SessionCardData } from '@/components/layout/SessionCard';
import type { Session } from '@/types/session';

export interface DiveTarget {
  project: string;
  session: string;
  serverId?: string;
}

/**
 * Select a session + fire its activation side-effects (terminal/browser/drawer).
 * Shared by the full dive (which also flips to Studio) and the in-place select
 * used inside the Bridge (Bridge P5 signal 6/7: select+show a worker's session
 * BESIDE the live graph without leaving Bridge mode).
 */
function selectSession(
  sessions: Session[],
  setCurrentSession: (s: Session) => void,
  target: DiveTarget,
): void {
  const match: Session | undefined = sessions.find(
    (s) => s.project === target.project && s.name === target.session,
  );
  const serverId = match?.serverId ?? target.serverId ?? 'local';
  const session: Session = match ?? {
    project: target.project,
    name: target.session,
    serverId,
  };

  setCurrentSession(session);

  // Best-effort activation side-effects. Never block on them.
  const card: SessionCardData = {
    serverId,
    project: target.project,
    session: target.session,
    status: 'unknown',
    lastUpdate: 0,
  };
  void activateSessionCard(card).catch(() => {});
}

export function useDiveIn() {
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);
  const setMode = useUIStore((s) => s.setMode);

  return useCallback(
    (target: DiveTarget) => {
      selectSession(sessions, setCurrentSession, target);
      setMode('studio');
    },
    [sessions, setCurrentSession, setMode],
  );
}

/**
 * Bridge P5: select a session + activate it WITHOUT changing mode — the graph
 * stays on screen and (with the artifact viewer open) the Z3 stage swaps to that
 * session's artifacts beside the live FleetGraph. Two-surface model intact.
 */
export function useSelectSessionInPlace() {
  const sessions = useSessionStore((s) => s.sessions);
  const setCurrentSession = useSessionStore((s) => s.setCurrentSession);

  return useCallback(
    (target: DiveTarget) => {
      selectSession(sessions, setCurrentSession, target);
    },
    [sessions, setCurrentSession],
  );
}

export default useDiveIn;
