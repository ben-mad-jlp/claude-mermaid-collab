import { GONE_MS } from '@/stores/subscriptionStore';
import type { Escalation } from '@/stores/supervisorStore';
import { selectTriageStack, type SessionSummary, type TriageStackOpts } from '@/lib/triageSelectors';

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
 *  painted on frozen data is the exact lie this guards against.
 *
 *  Zone-0 folds the SAME triage truth Zone-1 promotes from (selectTriageStack) —
 *  needs-you decisions AND wedged/unknown sessions — so the across-the-room verdict
 *  can never read "All clear" green over a session the FocusCard simultaneously
 *  flags as stuck (review finding 899f33a7). Tone is graded: URGENT (red) when
 *  something needs you NOW — a wedged session or a waiting decision; ATTENTION
 *  (amber, the "come closer" signal) when only unknown-liveness sessions remain
 *  (finding 416e00bb — the amber branch was previously never emitted). Takes the
 *  same `opts` (cleared/only-you) as the stack so an optimistically-cleared item
 *  drops the bar in lockstep with the focus slot. */
export function selectVerdict(
  openEscalations: Escalation[],
  sessionSummaries: Record<string, SessionSummary>,
  freshness: Freshness,
  now: number,
  opts: TriageStackOpts = {},
): Verdict {
  if (!freshness.live) {
    const line =
      freshness.lastRefreshAt > 0
        ? `NOT UPDATING — reconnecting (last good ${fmtHHMM(freshness.lastRefreshAt)})`
        : 'NOT UPDATING — reconnecting…';
    return { tone: 'disconnected', line, updatedAt: freshness.lastRefreshAt };
  }
  const stack = selectTriageStack(openEscalations, sessionSummaries, now, opts);
  if (stack.length === 0) return { tone: 'clear', line: 'All clear', updatedAt: now };

  let stuck = 0;
  let decisions = 0;
  let unknown = 0;
  for (const it of stack) {
    if (it.kind === 'wedge') stuck++;
    else if (it.kind === 'escalation') decisions++;
    else unknown++; // 'unknown' liveness
  }

  const parts: string[] = [];
  if (stuck) parts.push(`${stuck} session${stuck === 1 ? '' : 's'} stuck`);
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? '' : 's'} waiting`);
  if (unknown) parts.push(`${unknown} session${unknown === 1 ? '' : 's'} unknown`);

  const tone: VerdictTone = stuck > 0 || decisions > 0 ? 'urgent' : 'attention';
  return { tone, line: parts.join(' · '), updatedAt: now };
}
