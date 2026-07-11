import type { MissionSummary, MissionPhase, MissionStatus } from '@/stores/supervisorStore';
import { stripKindPrefix } from '@/lib/todoKind';

/**
 * Zen mission-awareness (pure). A session that OWNS an active, non-terminal mission
 * is a "conductor". The key distinction Zen needs: WHOSE TURN is it?
 *   - EXECUTE with epics still building → the DAEMON's turn. The conductor is
 *     CORRECTLY idle (waiting on the build) — this is a purposeful pause, not dead
 *     rest, so the card stays calm/green, ranks low, and its idle-Pulse is suppressed.
 *   - DISCOVER / PLAN / VERIFY (or EXECUTE with no epics yet) → the CONDUCTOR's move.
 *     This is the moment a mission-loop nudge fires; the card reads "your move"
 *     (amber) and floats up.
 * Terminal (converged/stopped) or inactive missions return null (no conducting view).
 *
 * Derived from mission PHASE + rollup — never inferred from idle timing (that heuristic
 * is brittle). Consumed by ZenMode (ranking + Pulse suppression) and ZenSessionCard
 * (turn-aware tint + the mission ribbon).
 */

export type ConductorTurn = 'daemon' | 'conductor';

export interface ConductingView {
  turn: ConductorTurn;
  phase: MissionPhase;
  status: MissionStatus;
  goal: string;
  /** Compact micro-label for the card, e.g. "daemon building 2/3" or "your move · plan". */
  label: string;
  capability: { met: number; total: number };
  mechanical: { done: number; total: number };
}

const TERMINAL_PHASES = new Set<MissionPhase>(['converged', 'stopped']);

/** Display-only: tear the role label off the mission title for the card ribbon.
 *  This never decides a role — the mission-ness of `m` is settled by `m.mission`
 *  before this is called. Becomes a no-op once stage C strips stored prefixes. */
function goalOf(title: string): string {
  return stripKindPrefix(title).trim() || 'mission';
}

export function conductingView(m?: MissionSummary | null): ConductingView | null {
  if (!m) return null;
  const mi = m.mission ?? ({} as MissionSummary['mission']);
  if (mi.active === false) return null; // paused mission — not the session's live driver
  const phase = (m.rollup?.phase ?? mi.phase) as MissionPhase | undefined;
  if (!phase || TERMINAL_PHASES.has(phase)) return null;

  const status = (m.rollup?.status ?? 'needs-discovery') as MissionStatus;
  const capability = m.rollup?.capability ?? { met: 0, total: 0 };
  const mechanical = m.rollup?.mechanical ?? { done: 0, total: 0 };
  const goal = goalOf(m.node?.title ?? 'mission');

  // Prefer status for turn decision when available.
  if (status === 'building') {
    const label = `daemon building ${mechanical.done}/${mechanical.total}`;
    return { turn: 'daemon', phase, status, goal, label, capability, mechanical };
  }

  // EXECUTE with epics still in flight = the daemon is building; the conductor waits (fallback for payloads without status).
  if (phase === 'execute' && mechanical.total > 0 && mechanical.done < mechanical.total) {
    return { turn: 'daemon', phase, status, goal, label: `daemon building ${mechanical.done}/${mechanical.total}`, capability, mechanical };
  }

  // Otherwise it's the conductor's move (judgment, or execute with nothing to build).
  const label =
    status === 'needs-verify' ? 'your move · verify'
    : status === 'needs-discovery' ? 'your move · discover'
    : phase === 'discover' ? 'your move · discover'
    : phase === 'plan' ? 'your move · plan'
    : phase === 'verify' ? 'your move · verify'
    : phase === 'execute' && mechanical.total > 0 ? 'wrapping up · verify next'
    : 'your move · needs an epic';
  return { turn: 'conductor', phase, status, goal, label, capability, mechanical };
}
