import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  __resetSummaryState,
  getSessionSummary,
  listSessionSummaries,
  snapshotSummaryMessages,
  SUMMARY_SNAPSHOT_MAX_AGE_MS,
  pushSessionSummary,
  refreshSummaryNow,
  getSelfSummaryNudgeConfig,
  setSelfSummaryNudgeConfig,
} from '../session-summary-loop.ts';

// Isolate SQLite/disk per test via MERMAID_DATA_DIR.
beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-summary-'));
  __resetSummaryState();
});

const P = '/proj/alpha';
const S = 'worker-1';

describe('pushSessionSummary (self-summary)', () => {
  it('folds a pushed structured summary into the cache as FRESH + broadcasts', () => {
    const msgs: unknown[] = [];
    const r = pushSessionSummary(P, S, { paragraph: 'We are wiring self-summary.', status: 'working' }, (m) => msgs.push(m));
    expect(r.ok).toBe(true);
    const e = getSessionSummary(P, S)!;
    expect(e.structured?.paragraph).toBe('We are wiring self-summary.');
    expect(e.refreshState).toBe('fresh');
    expect(e.summaryPaneHash).toBe(e.paneHash); // pushed → answerable (paneStillMatches)
    expect(msgs.length).toBe(1);
    expect((msgs[0] as { type: string }).type).toBe('session_summary_updated');
  });

  it('carries a pushed open-question through to the card payload', () => {
    const msgs: Array<Record<string, unknown>> = [];
    pushSessionSummary(P, S, { paragraph: 'Done — which way?', status: 'idle', question: 'Ship or iterate?', suggestedAnswers: ['Ship', 'Iterate'] }, (m) => msgs.push(m as Record<string, unknown>));
    const st = (msgs[0]?.structured ?? {}) as { question?: string; suggestedAnswers?: string[] };
    expect(st.question).toBe('Ship or iterate?');
    expect(st.suggestedAnswers).toEqual(['Ship', 'Iterate']);
  });

  it('rejects an invalid payload (no paragraph / valid status)', () => {
    expect(pushSessionSummary(P, S, { foo: 1 }).ok).toBe(false);
    expect(pushSessionSummary(P, S, { paragraph: 'x', status: 'bogus' }).ok).toBe(false);
  });

  it('derives progressState from status on first push (working→active, idle→quiet)', () => {
    const r1 = pushSessionSummary(P, S, { paragraph: 'Working on it.', status: 'working' });
    expect(r1.ok).toBe(true);
    expect(getSessionSummary(P, S)!.progressState).toBe('active');

    const S2 = 'worker-2';
    pushSessionSummary(P, S2, { paragraph: 'All done.', status: 'idle' });
    expect(getSessionSummary(P, S2)!.progressState).toBe('quiet');
  });

  it('a second push overwrites the paragraph/status and keeps refreshState fresh', () => {
    pushSessionSummary(P, S, { paragraph: 'First.', status: 'working' });
    pushSessionSummary(P, S, { paragraph: 'Second.', status: 'idle' });
    const e = getSessionSummary(P, S)!;
    expect(e.structured?.paragraph).toBe('Second.');
    expect(e.refreshState).toBe('fresh');
  });
});

describe('listSessionSummaries / snapshotSummaryMessages (read-model)', () => {
  it('listSessionSummaries returns every pushed entry', () => {
    pushSessionSummary(P, S, { paragraph: 'a', status: 'working' });
    pushSessionSummary(P, 'worker-2', { paragraph: 'b', status: 'idle' });
    expect(listSessionSummaries()).toHaveLength(2);
  });

  it('snapshotSummaryMessages mirrors the live broadcast shape for each cached entry', () => {
    pushSessionSummary(P, S, { paragraph: 'Snapshot me.', status: 'working' });
    const snap = snapshotSummaryMessages();
    expect(snap).toHaveLength(1);
    expect(snap[0]!.type).toBe('session_summary_updated');
    expect(snap[0]!.project).toBe(P);
    expect(snap[0]!.session).toBe(S);
    expect((snap[0]!.structured as { paragraph: string }).paragraph).toBe('Snapshot me.');
  });

  it('empty cache → empty snapshot/list', () => {
    expect(listSessionSummaries()).toHaveLength(0);
    expect(snapshotSummaryMessages()).toHaveLength(0);
  });
});

describe('refreshSummaryNow (vestigial stub — pane-scrape/interpret retired)', () => {
  it('returns ok:false, reason:no-ws when no WS is present', async () => {
    const result = await refreshSummaryNow(P, S, { hasWs: () => false });
    expect(result).toEqual({ ok: false, reason: 'no-ws' });
  });

  it('returns ok:false, reason:capture-failed when WS is present (no pane to read)', async () => {
    const result = await refreshSummaryNow(P, S, { hasWs: () => true });
    expect(result).toEqual({ ok: false, reason: 'capture-failed' });
  });
});

describe('getSelfSummaryNudgeConfig / setSelfSummaryNudgeConfig', () => {
  it('reflects env defaults after reset', () => {
    const cfg = getSelfSummaryNudgeConfig();
    expect(typeof cfg.enabled).toBe('boolean');
    expect(cfg.intervalMs).toBeGreaterThan(0);
  });

  it('setSelfSummaryNudgeConfig updates enabled/intervalMs; ignores non-positive intervalMs', () => {
    setSelfSummaryNudgeConfig({ enabled: false, intervalMs: 120_000 });
    expect(getSelfSummaryNudgeConfig()).toEqual({ enabled: false, intervalMs: 120_000 });

    setSelfSummaryNudgeConfig({ intervalMs: 0 });
    expect(getSelfSummaryNudgeConfig().intervalMs).toBe(120_000); // ignored
  });
});

describe('snapshotSummaryMessages staleness filter (66-ghost flood regression)', () => {
  it('excludes entries older than SUMMARY_SNAPSHOT_MAX_AGE_MS from the connect replay', () => {
    pushSessionSummary(P, 'live-1', { paragraph: 'fresh work', status: 'working' });
    pushSessionSummary(P, 'dead-1', { paragraph: 'ancient work', status: 'idle' });
    const now = Date.now();
    // Fresh window → both replay.
    expect(snapshotSummaryMessages(now)).toHaveLength(2);
    // Advance past the window → nothing replays (dead sessions stay dead).
    expect(snapshotSummaryMessages(now + SUMMARY_SNAPSHOT_MAX_AGE_MS + 1)).toHaveLength(0);
  });
});
