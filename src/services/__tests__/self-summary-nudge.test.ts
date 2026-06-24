import { describe, it, expect, beforeEach } from 'bun:test';
import {
  __resetSummaryState,
  shouldSelfNudge,
  runSelfSummaryNudgePass,
  getSelfSummaryNudgeConfig,
  setSelfSummaryNudgeConfig,
} from '../session-summary-loop.ts';
import type { SessionSummaryEntry } from '../session-summary-loop.ts';

function entry(over: Partial<SessionSummaryEntry> = {}): SessionSummaryEntry {
  return {
    project: '/proj/a',
    session: 's1',
    tmux: 'proj_s1',
    paneHash: 'abc',
    paneSeenAt: 1000,
    quietWindows: 3,
    progressState: 'quiet',
    updatedAt: 1000,
    ...over,
  };
}

beforeEach(() => {
  __resetSummaryState();
});

describe('shouldSelfNudge', () => {
  const INTERVAL = 5 * 60_000;

  it('quiet + no question + stale → true', () => {
    expect(shouldSelfNudge(entry(), -Infinity, 1_000_000, INTERVAL)).toBe(true);
  });

  it('active → false', () => {
    expect(shouldSelfNudge(entry({ progressState: 'active' }), -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('stalled → false', () => {
    expect(shouldSelfNudge(entry({ progressState: 'stalled' }), -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('wedged → false', () => {
    expect(shouldSelfNudge(entry({ progressState: 'wedged' }), -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('unknown → false', () => {
    expect(shouldSelfNudge(entry({ progressState: 'unknown' }), -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('structured.question set → false', () => {
    const e = entry({ structured: { paragraph: 'p', status: 'idle', question: 'Do this?' } });
    expect(shouldSelfNudge(e, -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('structured.status === needs-input → false', () => {
    const e = entry({ structured: { paragraph: 'p', status: 'needs-input' } });
    expect(shouldSelfNudge(e, -Infinity, 1_000_000, INTERVAL)).toBe(false);
  });

  it('within intervalMs of lastNudge → false', () => {
    const now = 1_000_000;
    const lastNudge = now - INTERVAL + 1;
    expect(shouldSelfNudge(entry(), lastNudge, now, INTERVAL)).toBe(false);
  });

  it('exactly at intervalMs of lastNudge → true (boundary is inclusive past)', () => {
    const now = 1_000_000;
    const lastNudge = now - INTERVAL;
    expect(shouldSelfNudge(entry(), lastNudge, now, INTERVAL)).toBe(true);
  });

  it('within intervalMs of lastSelfPushAt → false', () => {
    const now = 1_000_000;
    const e = entry({ lastSelfPushAt: now - INTERVAL + 1 });
    expect(shouldSelfNudge(e, -Infinity, now, INTERVAL)).toBe(false);
  });

  it('lastSelfPushAt past intervalMs → true', () => {
    const now = 1_000_000;
    const e = entry({ lastSelfPushAt: now - INTERVAL - 1 });
    expect(shouldSelfNudge(e, -Infinity, now, INTERVAL)).toBe(true);
  });
});

describe('runSelfSummaryNudgePass', () => {
  const INTERVAL = 5 * 60_000;
  let nudgeCalls: Array<{ project: string; session: string; text: string }>;
  let nudgeResult: 'sent' | 'busy' | 'no-tmux';

  function makeDeps(summaries: SessionSummaryEntry[], now = 1_000_000) {
    return {
      listSummaries: () => summaries,
      nudge: async (project: string, session: string, text: string) => {
        nudgeCalls.push({ project, session, text });
        return nudgeResult;
      },
      config: () => ({ enabled: true, intervalMs: INTERVAL }),
      now: () => now,
    };
  }

  beforeEach(() => {
    nudgeCalls = [];
    nudgeResult = 'sent';
  });

  it('enabled:false → no nudges, scanned 0', async () => {
    const e = entry();
    const r = await runSelfSummaryNudgePass({
      listSummaries: () => [e],
      nudge: async () => 'sent',
      config: () => ({ enabled: false, intervalMs: INTERVAL }),
      now: () => 1_000_000,
    });
    expect(r).toEqual({ scanned: 0, eligible: 0, nudged: [] });
    expect(nudgeCalls.length).toBe(0);
  });

  it('one quiet eligible session → nudge called once with update_zen_summary in text, nudged includes it', async () => {
    const e = entry();
    const r = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r.scanned).toBe(1);
    expect(r.eligible).toBe(1);
    expect(r.nudged).toEqual(['s1']);
    expect(nudgeCalls.length).toBe(1);
    expect(nudgeCalls[0].text).toContain('update_zen_summary');
  });

  it("'busy' result → NOT added to nudged, throttle not advanced (re-eligible next call)", async () => {
    nudgeResult = 'busy';
    const e = entry();
    const r = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r.nudged).toEqual([]);
    expect(nudgeCalls.length).toBe(1);
    // second call same now — still eligible (throttle not advanced)
    const r2 = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r2.eligible).toBe(1);
  });

  it("'no-tmux' result → NOT added to nudged, throttle not advanced", async () => {
    nudgeResult = 'no-tmux';
    const e = entry();
    const r = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r.nudged).toEqual([]);
    const r2 = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r2.eligible).toBe(1);
  });

  it('second immediate pass after a sent → throttled (no re-nudge)', async () => {
    const e = entry();
    const r1 = await runSelfSummaryNudgePass(makeDeps([e], 1_000_000));
    expect(r1.nudged).toEqual(['s1']);
    // same now → within intervalMs
    const r2 = await runSelfSummaryNudgePass(makeDeps([e], 1_000_000));
    expect(r2.eligible).toBe(0);
    expect(nudgeCalls.length).toBe(1);
  });

  it('nudge eligible again once now advances past intervalMs', async () => {
    const e = entry();
    await runSelfSummaryNudgePass(makeDeps([e], 1_000_000));
    const r2 = await runSelfSummaryNudgePass(makeDeps([e], 1_000_000 + INTERVAL + 1));
    expect(r2.nudged).toEqual(['s1']);
  });

  it('active session skipped', async () => {
    const e = entry({ progressState: 'active' });
    const r = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r.eligible).toBe(0);
    expect(nudgeCalls.length).toBe(0);
  });

  it('quiet session with parked question skipped', async () => {
    const e = entry({ structured: { paragraph: 'p', status: 'idle', question: 'Push?' } });
    const r = await runSelfSummaryNudgePass(makeDeps([e]));
    expect(r.eligible).toBe(0);
    expect(nudgeCalls.length).toBe(0);
  });

  it('mixed sessions: only the eligible quiet one gets nudged', async () => {
    const active = entry({ session: 'active1', progressState: 'active' });
    const withQ = entry({ session: 'q1', structured: { paragraph: 'p', status: 'idle', question: 'Ok?' } });
    const quiet = entry({ session: 's1' });
    const r = await runSelfSummaryNudgePass(makeDeps([active, withQ, quiet]));
    expect(r.scanned).toBe(3);
    expect(r.nudged).toEqual(['s1']);
  });
});

describe('setSelfSummaryNudgeConfig / getSelfSummaryNudgeConfig', () => {
  it('round-trips enabled and intervalMs', () => {
    setSelfSummaryNudgeConfig({ enabled: false, intervalMs: 120_000 });
    expect(getSelfSummaryNudgeConfig()).toEqual({ enabled: false, intervalMs: 120_000 });
  });

  it('ignores intervalMs <= 0', () => {
    setSelfSummaryNudgeConfig({ intervalMs: 5 * 60_000 });
    setSelfSummaryNudgeConfig({ intervalMs: 0 });
    expect(getSelfSummaryNudgeConfig().intervalMs).toBe(5 * 60_000);
    setSelfSummaryNudgeConfig({ intervalMs: -1 });
    expect(getSelfSummaryNudgeConfig().intervalMs).toBe(5 * 60_000);
  });

  it('resets to env defaults on __resetSummaryState', () => {
    setSelfSummaryNudgeConfig({ enabled: false, intervalMs: 1000 });
    __resetSummaryState();
    const cfg = getSelfSummaryNudgeConfig();
    expect(cfg.enabled).toBe(true); // default ON (no env var set)
    expect(cfg.intervalMs).toBe(5 * 60_000);
  });
});
