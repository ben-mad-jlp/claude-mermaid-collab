import { describe, it, expect } from 'vitest';
import { backoffDelayMs, parseRetryAfterMs, isRetryable, nextRetry, RETRY_CAP_MS, RETRY_MAX_ATTEMPTS } from '../retry';

describe('retry', () => {
  it('exponential backoff, capped', () => {
    expect(backoffDelayMs(0)).toBe(2_000);
    expect(backoffDelayMs(1)).toBe(4_000);
    expect(backoffDelayMs(2)).toBe(8_000);
    expect(backoffDelayMs(10)).toBe(RETRY_CAP_MS); // capped
  });

  it('honors a server retry-after over the backoff', () => {
    expect(backoffDelayMs(0, 12_345)).toBe(12_345);
  });

  it('parses retry-after-ms, retry-after seconds, and HTTP-date', () => {
    expect(parseRetryAfterMs({ 'retry-after-ms': '1500' }, 0)).toBe(1500);
    expect(parseRetryAfterMs({ 'Retry-After': '3' }, 0)).toBe(3000); // case-insensitive, seconds
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs({ 'retry-after': 'Thu, 01 Jan 2026 00:00:05 GMT' }, now)).toBe(5000);
    expect(parseRetryAfterMs({ other: 'x' }, 0)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, 0)).toBeUndefined();
  });

  it('retries 429 / 408 / 5xx, not other 4xx', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ statusCode: 408 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
  });

  it('retries rate-limit + transient-network messages', () => {
    expect(isRetryable({ message: 'Rate limited, too many requests' })).toBe(true);
    expect(isRetryable({ message: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ message: 'fetch failed' })).toBe(true);
  });

  it('NEVER retries context-overflow (a longer wait will not help)', () => {
    expect(isRetryable({ message: 'prompt is too long: 200000 tokens' })).toBe(false);
    expect(isRetryable({ status: 429, message: 'maximum context length exceeded' })).toBe(false);
  });

  it('is conservative on unknown errors', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable({})).toBe(false);
    expect(isRetryable({ message: 'something weird' })).toBe(false);
  });

  it('nextRetry stops at the attempt cap', () => {
    expect(nextRetry({ status: 503 }, 0, undefined, 0).retry).toBe(true);
    expect(nextRetry({ status: 503 }, RETRY_MAX_ATTEMPTS - 1, undefined, 0).retry).toBe(false);
    expect(nextRetry({ status: 400 }, 0, undefined, 0).retry).toBe(false);
  });
});
