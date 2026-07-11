/** Format an epoch (ms) as a compact local wall-clock stamp, e.g. "[14:32 CDT]".
 *  Prefixed to every operator-facing server-injected nudge so a human reading the
 *  session transcript can see WHEN a prompt fired. `now` is passed in (kept pure —
 *  no Date.now() here) so callers stay unit-testable with an injected clock. */
export function fireStamp(now: number): string {
  try {
    return `[${new Date(now).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
    })}]`;
  } catch {
    return `[t=${now}]`;
  }
}
