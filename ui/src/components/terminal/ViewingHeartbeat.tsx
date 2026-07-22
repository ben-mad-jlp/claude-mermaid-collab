import { useEffect } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';

/**
 * ViewingHeartbeat — desktop-terminal presence beat.
 *
 * The session-summary interpret pass (which produces the `structured` suggestion the
 * ghost render below relies on) is gated on `isZenActivelyViewed()` — a fresh
 * `POST /api/zen/viewing` heartbeat. The Zen UI beats it while its card view is open;
 * the DESKTOP terminal view never did, so a session watched only from the terminal
 * never got interpreted → no suggestion ever rendered.
 *
 * This mounts alongside the terminal composer and beats the SAME endpoint (reusing
 * `pingViewing`, no parallel gate) while:
 *   - this view is MOUNTED, AND
 *   - the tab is VISIBLE (document.visibilityState === 'visible'), AND
 *   - a real session is bound (project + session non-empty and not `disabled`).
 *
 * COST FLOOR (deliberate): we NEVER beat when the tab is hidden or no session is
 * bound. When the beat stops (unmount / hidden / unbound), presence goes stale within
 * the 30s TTL and the interpret pass stops — no token burn when unwatched. The
 * interval (~10s) sits comfortably inside that TTL so an actively-viewed session
 * stays fresh.
 *
 * Renders nothing.
 */

/** Beat cadence — comfortably inside ZEN_PRESENCE_TTL_MS (30s). */
export const VIEWING_HEARTBEAT_INTERVAL_MS = 10_000;

interface ViewingHeartbeatProps {
  serverId: string;
  project: string;
  session: string;
  /** No live/bound console → do not beat (mirrors the composer's disabled gate). */
  disabled?: boolean;
}

export function ViewingHeartbeat({ serverId, project, session, disabled = false }: ViewingHeartbeatProps) {
  const pingViewing = useSupervisorStore((s) => s.pingViewing);

  useEffect(() => {
    // Session-bound gate: an empty project/session (no attached console) or an
    // explicitly-disabled composer means there is nothing to keep fresh — never beat.
    if (disabled || !project || !session) return;

    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      pingViewing(serverId);
    };
    beat(); // immediate, so opening/binding the terminal re-arms interpret on the next tick
    const id = setInterval(beat, VIEWING_HEARTBEAT_INTERVAL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [serverId, project, session, disabled, pingViewing]);

  return null;
}

export default ViewingHeartbeat;
