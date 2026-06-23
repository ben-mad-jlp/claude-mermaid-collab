// Account-wide Claude Code rate-limit usage — the 5-hour and 7-day (weekly) rolling
// window percentages Claude Code surfaces in its statusline JSON (`rate_limits`).
// Reported by the statusline hook (scripts/statusline.sh), the same path that feeds
// per-session contextPercent. These limits are per ACCOUNT, not per session, so we keep
// a single latest snapshot (last write wins — every session reports the same numbers).

export interface UsageSnapshot {
  /** 5-hour rolling window usage, 0–100. */
  fiveHourPercent: number;
  /** 7-day / weekly rolling window usage, 0–100. */
  sevenDayPercent: number;
  /** When this snapshot was reported (epoch ms). */
  updatedAt: number;
}

let latest: UsageSnapshot | null = null;

export function recordUsage(fiveHourPercent: number, sevenDayPercent: number, now = Date.now()): UsageSnapshot {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  latest = { fiveHourPercent: clamp(fiveHourPercent), sevenDayPercent: clamp(sevenDayPercent), updatedAt: now };
  return latest;
}

export function getUsage(): UsageSnapshot | null {
  return latest;
}
