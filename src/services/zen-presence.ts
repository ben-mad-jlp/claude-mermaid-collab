// Zen-presence registry — "is a human actively LOOKING at the Zen view right now?"
//
// WHY: the session-summary loop (interpret pane-scrape + self-summary nudge) used to
// fire whenever ANY browser was connected (wsPresent). That burns plan tokens in the
// background even when nobody is watching the Zen card. This registry lets the loop
// gate on actual Zen visibility: the Zen UI POSTs a lightweight heartbeat while it is
// MOUNTED and the tab is VISIBLE (document.visibilityState==='visible'); the loop only
// summarizes/nudges while a heartbeat is fresh. Stop looking → summaries go (cheaply)
// stale and refresh the next time you open Zen.
//
// In-memory + process-local by design: a single fresh timestamp is all the signal we
// need. A restart simply re-seeds on the next heartbeat (≤ the heartbeat interval).

/** A heartbeat older than this is treated as "not viewing" (the UI beats well inside it). */
export const ZEN_PRESENCE_TTL_MS = 30_000;

let lastViewedAt = 0;

/** Record a Zen-view heartbeat (the UI calls this via POST /api/zen/viewing). */
export function markZenViewed(now: number = Date.now()): void {
  lastViewedAt = now;
}

/** True when a Zen-view heartbeat arrived within the TTL — i.e. someone is watching. */
export function isZenActivelyViewed(now: number = Date.now(), ttlMs: number = ZEN_PRESENCE_TTL_MS): boolean {
  return lastViewedAt > 0 && now - lastViewedAt <= ttlMs;
}

/** Diagnostic snapshot (used by a debug route / tests). */
export function getZenPresence(now: number = Date.now()): { lastViewedAt: number; ageMs: number | null; active: boolean } {
  return {
    lastViewedAt,
    ageMs: lastViewedAt > 0 ? now - lastViewedAt : null,
    active: isZenActivelyViewed(now),
  };
}

/** Test-only: reset the registry. */
export function _resetZenPresence(): void {
  lastViewedAt = 0;
}
