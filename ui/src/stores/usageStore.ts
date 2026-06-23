import { create } from 'zustand';

// Account-wide Claude Code rate-limit usage (5-hour + 7-day rolling windows), reported by
// the statusline hook → POST /api/usage-update → WS `claude_usage_update`. Account-global,
// so a single snapshot (not per-session). Drives the two usage bars at the top of Zen.
export interface UsageSnapshot {
  fiveHourPercent: number;
  sevenDayPercent: number;
  updatedAt: number;
}

interface UsageState {
  usage: UsageSnapshot | null;
  setUsage: (usage: UsageSnapshot) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  usage: null,
  setUsage: (usage) => set({ usage }),
}));
