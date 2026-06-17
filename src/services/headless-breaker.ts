/**
 * Process-wide circuit breaker for HEADLESS (node-invoker) launches — PAW P3.
 *
 * The leaf-executor NEVER backs off, sleeps, or retries on a rate cap. It detects
 * `rateLimited`, yields a `paused` outcome, and returns immediately. THIS module
 * (driven by the always-on coordinator daemon) owns ALL pause/resume/backoff/
 * circuit-breaking — one place, one source of timing truth.
 *
 * State is in-memory and per-process (NOT a todo status — todo-store has no
 * `paused` state). Per-process is correct for v1: the cap is per-claude.ai-account
 * and all headless nodes share that one account, so a per-project gate would let
 * project B keep hammering the same capped account.
 *
 * A clock is injected (`now: () => number`, default `Date.now`) so the whole module
 * is unit-testable with no timers and no live claude.
 */

import type { LeafRunResult } from './leaf-executor';

/** The minimal resume state the executor yields on a pause (mirrors
 *  `LeafRunResult.paused`). */
export type LeafPaused = NonNullable<LeafRunResult['paused']>;

export const BASE_BACKOFF_MS = 60_000; // 1 min
export const MAX_BACKOFF_MS = 30 * 60_000; // 30 min ceiling
export const MAX_TOTAL_WAIT_MS = 2 * 60 * 60_000; // 2h → exhaustion

interface PausedEntry {
  project: string;
  todoId: string;
  paused: LeafPaused;
  /** epoch ms of the first trip in the current open streak (for exhaustion). */
  firstTrippedAt: number;
}

// ── process-wide mutable state ───────────────────────────────────────────────
let openUntil = 0; // epoch ms; headless launches suppressed while now < openUntil
let consecutiveTrips = 0; // for exponential backoff when capReset is unknown
let firstTrippedAt = 0; // start of the current open streak (0 ⇒ not open)
const pausedLeaves = new Map<string, PausedEntry>(); // key = `${project}:${todoId}`

const key = (project: string, todoId: string): string => `${project}:${todoId}`;

/**
 * Trip the breaker. Sets `openUntil` to `capReset` if the CLI surfaced a real reset
 * time (UNCONFIRMED — see node-invoker CAP_RESET stub), else to `now + backoff`
 * where backoff is exponential in `consecutiveTrips`, capped at MAX_BACKOFF_MS.
 * Always takes the LATER of the current and new `openUntil` (never shortens a hold).
 */
export function tripBreaker(capReset?: number, now: number = Date.now()): void {
  consecutiveTrips += 1;
  if (firstTrippedAt === 0) firstTrippedAt = now;
  if (capReset && capReset > now) {
    openUntil = Math.max(openUntil, capReset);
  } else {
    const backoff = Math.min(
      BASE_BACKOFF_MS * 2 ** (consecutiveTrips - 1),
      MAX_BACKOFF_MS,
    );
    openUntil = Math.max(openUntil, now + backoff);
  }
}

/** TRUE while the cap window is open (headless launches must be suppressed). */
export function breakerOpen(now: number = Date.now()): boolean {
  return now < openUntil;
}

/** Epoch ms the breaker is open until (0 ⇒ closed/never tripped). */
export function breakerOpenUntil(): number {
  return openUntil;
}

/** Clear all breaker state — call on a successful headless spawn or daemon reset.
 *  Resets the backoff streak so the NEXT trip starts from BASE_BACKOFF_MS again. */
export function resetBreaker(): void {
  openUntil = 0;
  consecutiveTrips = 0;
  firstTrippedAt = 0;
  pausedLeaves.clear();
}

/** Reset ONLY the exponential-backoff streak (consecutiveTrips) so the NEXT trip
 *  starts from BASE_BACKOFF_MS again. Unlike resetBreaker(), this leaves the current
 *  `openUntil` hold AND the pausedLeaves registry intact — call it on a healthy signal
 *  (an ACCEPTED leaf) where the account is demonstrably serving requests again, without
 *  disturbing other leaves still legitimately paused on the cap. */
export function resetBreakerStreak(): void {
  consecutiveTrips = 0;
  firstTrippedAt = 0;
}

/** Record a paused leaf for bookkeeping + exhaustion tracking. The actual
 *  re-dispatch rides the ordinary claim loop (the todo is released back to `ready`
 *  on pause); this registry records `firstTrippedAt` for the exhaustion sweep and
 *  carries `startNodesSpent` forward on resume. */
export function enqueuePausedLeaf(
  project: string,
  todoId: string,
  paused: LeafPaused,
  now: number = Date.now(),
): void {
  const k = key(project, todoId);
  const existing = pausedLeaves.get(k);
  pausedLeaves.set(k, {
    project,
    todoId,
    paused,
    // Preserve the first trip time across repeated pauses of the same leaf so the
    // 2h exhaustion ceiling measures the whole streak, not just the latest pause.
    firstTrippedAt: existing?.firstTrippedAt ?? now,
  });
}

/** The carried `nodesSpent` for a known-paused leaf (so a resumed run seeds its
 *  budget and total spawns across pause/resume cycles stay bounded by NODE_BUDGET).
 *  0 if the leaf isn't in the registry. */
export function pausedNodesSpent(project: string, todoId: string): number {
  return pausedLeaves.get(key(project, todoId))?.paused.nodesSpent ?? 0;
}

/** Drop a leaf from the registry — call once it resumes successfully or is parked. */
export function recordResume(project: string, todoId: string): void {
  pausedLeaves.delete(key(project, todoId));
}

/** All paused leaves for a project (snapshot — safe to mutate the registry during
 *  iteration of the result). */
export function pausedLeavesFor(project: string): PausedEntry[] {
  return [...pausedLeaves.values()].filter((e) => e.project === project);
}

/** Resume-eligible entries: NONE while the window is open; once closed, returns AND
 *  clears the whole registry. (Resume itself rides the ordinary claim loop; this is
 *  the bookkeeping drain.) */
export function drainResumable(now: number = Date.now()): PausedEntry[] {
  if (breakerOpen(now)) return [];
  const out = [...pausedLeaves.values()];
  pausedLeaves.clear();
  return out;
}

/** TRUE when a paused leaf has been held continuously past MAX_TOTAL_WAIT_MS (the
 *  account is effectively out of quota for the billing window) — the daemon then
 *  escalates + parks it BLOCKED rather than waiting forever. */
export function breakerExhausted(firstAt: number, now: number = Date.now()): boolean {
  if (firstAt === 0) return false;
  return now - firstAt >= MAX_TOTAL_WAIT_MS;
}
