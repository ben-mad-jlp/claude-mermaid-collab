/**
 * Retry policy for worker-core model/tool calls — pure, provider-agnostic predicates.
 *
 * Pattern informed by opencode's retry approach (exponential backoff honoring
 * `retry-after`, retry 5xx + rate-limits, EXCLUDE context-overflow). Written fresh
 * (the upstream file was not present at the pinned tag) — kept pure + injectable so
 * the loop can wrap it however it likes.
 */

export const RETRY_INITIAL_MS = 2_000;
export const RETRY_FACTOR = 2;
export const RETRY_CAP_MS = 30_000;
export const RETRY_MAX_ATTEMPTS = 5;

/** Backoff for a 0-indexed attempt. Honors a server-provided `retryAfterMs` when
 *  present (loosely capped), else exponential `INITIAL * FACTOR^attempt` capped. */
export function backoffDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, RETRY_CAP_MS * 4);
  }
  const base = RETRY_INITIAL_MS * RETRY_FACTOR ** Math.max(0, attempt);
  return Math.min(base, RETRY_CAP_MS);
}

/** Parse a `retry-after-ms` / `retry-after` header (ms, integer seconds, or an
 *  HTTP-date) into milliseconds. `nowMs` is injected for testability. Returns
 *  undefined when absent/unparseable. */
export function parseRetryAfterMs(
  headers: Record<string, string | undefined> | undefined,
  nowMs: number,
): number | undefined {
  if (!headers) return undefined;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (v != null) lower[k.toLowerCase()] = v;

  const ms = lower['retry-after-ms'];
  if (ms != null) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const ra = lower['retry-after'];
  if (ra != null) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  return undefined;
}

const CONTEXT_OVERFLOW = /context|maximum context length|too long|context_length_exceeded|prompt is too long/i;
const RATE_LIMIT = /rate.?limit|too many requests|overloaded|\b429\b|quota|exhausted|temporarily unavailable/i;
const TRANSIENT_NET = /econnreset|etimedout|enotfound|eai_again|fetch failed|socket hang up|network|timeout/i;

/** Should a thrown error be retried? Retries rate-limits (429), 408, and 5xx, plus
 *  transient network errors. NEVER retries a context-overflow (a longer wait won't
 *  help) or other 4xx. Conservative: unknown → not retryable. */
export function isRetryable(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string } | null;
  if (!e) return false;
  const msg = e.message ?? '';
  if (CONTEXT_OVERFLOW.test(msg)) return false; // explicit non-retry
  const code = e.statusCode ?? e.status;
  if (typeof code === 'number') {
    if (code === 429 || code === 408) return true;
    if (code >= 500) return true;
    if (code >= 400) return false; // other client errors
  }
  return RATE_LIMIT.test(msg) || TRANSIENT_NET.test(msg);
}

/** One retry decision: whether to retry attempt `attempt` (0-indexed) for `err`,
 *  and how long to wait. Stops at RETRY_MAX_ATTEMPTS. */
export function nextRetry(
  err: unknown,
  attempt: number,
  headers: Record<string, string | undefined> | undefined,
  nowMs: number,
): { retry: boolean; delayMs: number } {
  if (attempt >= RETRY_MAX_ATTEMPTS - 1 || !isRetryable(err)) return { retry: false, delayMs: 0 };
  return { retry: true, delayMs: backoffDelayMs(attempt, parseRetryAfterMs(headers, nowMs)) };
}
