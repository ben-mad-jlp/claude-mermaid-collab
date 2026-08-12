/**
 * Cooldown gate for reconnect-driven resyncs (sidecar-pin feedback loop, 2026-08-11/12):
 * a busy server drops WS connections → every client reconnects → each reconnect fired a
 * full resyncBridge() (5 fetches, one of them O(git-branches) server-side) → the server
 * got busier → more drops. 2,341 reconnects were logged in one storm. The gate breaks
 * the loop on the client edge: the first call in a quiet period fires immediately
 * (a genuine reconnect still resyncs with no lag), and any burst inside the cooldown
 * window coalesces into ONE trailing call at the window boundary — so a storm costs one
 * resync per window instead of one per reconnect.
 */

export const RECONNECT_RESYNC_COOLDOWN_MS = 15_000;

export interface CooldownGate {
  (): void;
  /** Drop any pending trailing call (component unmount). */
  cancel(): void;
}

export function makeCooldownGate(
  fn: () => void,
  cooldownMs: number = RECONNECT_RESYNC_COOLDOWN_MS,
  now: () => number = Date.now,
): CooldownGate {
  let lastFiredAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    lastFiredAt = now();
    fn();
  };
  const gate = () => {
    if (timer != null) return; // a trailing call is already scheduled — coalesce
    const elapsed = now() - lastFiredAt;
    if (elapsed >= cooldownMs) {
      fire();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, cooldownMs - elapsed);
  };
  gate.cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  return gate;
}
