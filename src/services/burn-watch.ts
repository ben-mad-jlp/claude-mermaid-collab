/**
 * burn-watch.ts — the token-leak ALARM.
 *
 * Reads the burn gauge (spend-ledger `getBurnBySource`) over a rolling window and, when a NON-BUILD
 * source exceeds its per-source call ceiling with no offsetting accepted work, raises ONE deduped
 * operator-gated escalation naming the source. This is what turns the spend ledger from a passive
 * record into an active catcher: a daemon pass re-spinning on an idle system (the exact leak class
 * that motivated this) trips a visible card instead of quietly burning tokens for hours.
 *
 * Build sources (leaf/implement/review/…) are EXEMPT — their spend is expected work and is already
 * tracked per-mission by mission-cost.ts. The alarm watches the daemon OVERHEAD sources: conductor,
 * summary, triage, forge, planner, digest.
 *
 * Advisory, not a brake: it files a card for a human/steward, it does not kill anything. The proof
 * that a source is leaking (its call count) lives in the gauge; the card points there.
 */

import { getBurnBySource, detectBurnLeaks, type BurnThresholds, type BurnRow, type BurnLeak } from './spend-ledger.ts';
import { createEscalation, type Escalation } from './supervisor-store.ts';

/** Alarm cadence — throttle the pass off the every-tick beat (same shape as friction-watch). */
export const BURN_WATCH_INTERVAL_MS = 300_000; // 5 min
/** Rolling lookback the gauge aggregates over for the alarm. */
export const BURN_WINDOW_MS = 60 * 60_000; // 60 min
/** Escalation kind for a suspected token leak. */
export const TOKEN_BURN_KIND = 'token-burn';
/** Sentinel session the alarm files under (a machine signal, like the fail-open sentinel). */
export const BURN_WATCH_SESSION = '__burn_watch__';

/** Build/leaf sources whose spend is expected work — never alarmed on (tracked via mission-cost). */
export const BURN_EXEMPT_SOURCES = new Set<string>([
  'leaf', 'node', 'implement', 'review', 'blueprint', 'verify',
  'driveplan', 'driveexec', 'research', 'grok-node',
]);

/** Stable per-source marker embedded in the card text so the dedup + a later grep can match it. */
export function burnMarker(source: string): string {
  return `[burn:${source}]`;
}

const lastRun = new Map<string, number>();

/** Throttle gate — at most once per BURN_WATCH_INTERVAL_MS per project. First call always runs. */
export function shouldRunBurnWatchPass(project: string, now: number = Date.now()): boolean {
  const last = lastRun.get(project);
  if (last !== undefined && now - last < BURN_WATCH_INTERVAL_MS) return false;
  lastRun.set(project, now);
  return true;
}

/** Test seam: clear the throttle clock. */
export function _resetBurnWatchThrottle(): void {
  lastRun.clear();
}

export interface BurnWatchDeps {
  now?: () => number;
  getBurn?: (o: { project?: string; sinceMs?: number }) => BurnRow[];
  createEsc?: typeof createEscalation;
  listOpen?: () => Escalation[];
  thresholds?: BurnThresholds;
}

/** Human-readable card text for a leak. The CEILING (stable) is included so createEscalation's
 *  (project, session, questionText) dedup collapses repeated windows into one open card; the volatile
 *  call count is intentionally left OUT of the text and lives in the gauge the card points at. */
export function burnCardText(leak: BurnLeak): string {
  return (
    `⚠️ Token-burn alarm ${burnMarker(leak.source)}: source '${leak.source}' is exceeding its LLM-call ` +
    `ceiling (${leak.ceiling} per ${Math.round(BURN_WINDOW_MS / 60_000)} min) with no offsetting accepted ` +
    `work — likely a daemon pass re-spinning on an idle system. Inspect GET /api/usage/burn and ` +
    `investigate or disable the source.`
  );
}

/**
 * One burn-watch pass for a project. Flags each over-ceiling non-build source with a deduped
 * operator-gated escalation. Returns the sources newly flagged this pass. Best-effort; never throws.
 */
export async function runBurnWatchPass(
  project: string,
  deps: BurnWatchDeps = {},
): Promise<{ flagged: string[] }> {
  const now = (deps.now ?? Date.now)();
  const getBurn = deps.getBurn ?? getBurnBySource;
  const createEsc = deps.createEsc ?? createEscalation;

  let rows: BurnRow[];
  try {
    rows = getBurn({ project, sinceMs: now - BURN_WINDOW_MS });
  } catch {
    return { flagged: [] }; // gauge read failed — never break the tick
  }

  const leaks = detectBurnLeaks(rows, {
    thresholds: deps.thresholds,
    productiveSources: BURN_EXEMPT_SOURCES,
  });
  if (leaks.length === 0) return { flagged: [] };

  const flagged: string[] = [];
  for (const leak of leaks) {
    try {
      const { isNew } = createEsc({
        project,
        session: BURN_WATCH_SESSION,
        kind: TOKEN_BURN_KIND,
        operatorGated: true, // a human decides whether it's a real leak or expected load
        questionText: burnCardText(leak),
        todoId: null,
      });
      if (isNew) flagged.push(leak.source);
    } catch {
      /* fail-open per source — one bad card must not sink the rest */
    }
  }
  return { flagged };
}
