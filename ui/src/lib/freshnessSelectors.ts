import { GONE_MS } from '@/stores/subscriptionStore';
import type { Escalation } from '@/stores/supervisorStore';

export interface Freshness {
  /** We've heard from the read-model pipe within GONE_MS. A connected-but-silent
   *  socket goes NOT live past the cutoff — that's the dead-man's switch. */
  live: boolean;
  /** Last WS message wall-clock (0 if none received yet). */
  lastRefreshAt: number;
}

/** Read-model freshness — keyed off the heartbeat clock, NOT raw socket state.
 *  `live` requires a real prior message (`> 0`) within `goneMs`. The `> 0` guard
 *  makes the initial state (lastWsMessageAt: 0, "never heard") correctly NOT live.
 *  Boundary `now - lastWsMessageAt === goneMs` is still live (`<=`). */
export function selectFreshness(
  lastWsMessageAt: number,
  now: number,
  goneMs: number = GONE_MS,
): Freshness {
  const live = lastWsMessageAt > 0 && now - lastWsMessageAt <= goneMs;
  return { live, lastRefreshAt: lastWsMessageAt };
}

export type VerdictTone = 'clear' | 'attention' | 'urgent' | 'disconnected';

export interface Verdict {
  tone: VerdictTone;
  line: string;
  updatedAt: number;
}

/** HH:MM in the viewer's locale/timezone. Exported for the unit test. */
export function fmtHHMM(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The Verdict Bar's single source of truth. DEAD-MAN'S SWITCH FIRST: a stale
 *  feed overrides everything — a calm "All clear" (or even "N decisions waiting")
 *  painted on frozen data is the exact lie this guards against. */
export function selectVerdict(
  openEscalations: Escalation[],
  freshness: Freshness,
  now: number,
): Verdict {
  if (!freshness.live) {
    const line =
      freshness.lastRefreshAt > 0
        ? `NOT UPDATING — reconnecting (last good ${fmtHHMM(freshness.lastRefreshAt)})`
        : 'NOT UPDATING — reconnecting…';
    return { tone: 'disconnected', line, updatedAt: freshness.lastRefreshAt };
  }
  const n = openEscalations.length;
  if (n === 0) return { tone: 'clear', line: 'All clear', updatedAt: now };
  return {
    tone: 'urgent',
    line: `${n} decision${n === 1 ? '' : 's'} waiting`,
    updatedAt: now,
  };
}
