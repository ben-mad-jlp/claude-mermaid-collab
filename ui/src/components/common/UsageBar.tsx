import React from 'react';
import { useUsageStore } from '@/stores/usageStore';

/**
 * UsageBar — one account-wide rate-limit gauge (5-hour or 7-day window). Extracted from the Zen top
 * bar so the same gauge can be reused in the app Header. Colour mirrors the statusline: green < 50,
 * amber 50–79, red ≥ 80; null (no data yet) is neutral gray.
 */
export const UsageBar: React.FC<{ label: string; percent: number | null }> = ({ label, percent }) => {
  const pct = percent ?? 0;
  const tier =
    percent == null
      ? { fill: 'bg-gray-400 dark:bg-gray-500', text: 'text-gray-400 dark:text-gray-500' }
      : pct >= 80
        ? { fill: 'bg-danger-500', text: 'text-danger-600 dark:text-danger-400' }
        : pct >= 50
          ? { fill: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400' }
          : { fill: 'bg-success-500', text: 'text-success-600 dark:text-success-400' };
  return (
    <div className="flex items-center gap-1.5" title={`${label} usage: ${percent == null ? 'unknown' : `${pct}%`}`}>
      <span className={`text-3xs font-semibold tabular-nums ${tier.text}`}>{label}</span>
      <div className="w-20 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden ring-1 ring-black/5 dark:ring-white/10">
        <div className={`h-full rounded-full transition-all ${tier.fill}`} style={{ width: `${Math.max(percent == null ? 0 : 3, Math.min(pct, 100))}%` }} />
      </div>
      <span className={`text-3xs font-bold tabular-nums w-7 text-right ${tier.text}`}>
        {percent == null ? '—' : `${pct}%`}
      </span>
    </div>
  );
};

/**
 * UsageMeters — the 5h + 7d account-usage gauges, reading the app-wide usageStore directly (hydrated
 * in App.tsx via GET /api/usage + the `claude_usage_update` WS event, so it works anywhere without
 * hoisting). This is what Zen shows at its top; dropped into the app Header it gives the same
 * at-a-glance rate-limit read-out on every screen. Renders nothing until the first snapshot arrives.
 */
export const UsageMeters: React.FC<{ className?: string }> = ({ className }) => {
  const usage = useUsageStore((s) => s.usage);
  if (!usage) return null;
  return (
    <div data-testid="usage-meters" className={`flex items-center gap-3 ${className ?? ''}`}>
      <UsageBar label="5h" percent={usage.fiveHourPercent ?? null} />
      <UsageBar label="7d" percent={usage.sevenDayPercent ?? null} />
    </div>
  );
};

export default UsageBar;
