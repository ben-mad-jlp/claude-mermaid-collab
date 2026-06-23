import { describe, it, expect } from 'vitest';
import type { Escalation } from '@/stores/supervisorStore';
import { selectFreshness, selectVerdict, fmtHHMM, type Freshness } from './freshnessSelectors';
import type { SessionSummary } from './triageSelectors';

const GONE = 15 * 60_000;
const NOW = 1_000_000;

const esc = (id: string): Escalation =>
  ({ id, project: 'p', session: 's', kind: 'decision', questionText: 'q',
     status: 'open', createdAt: 0 }) as Escalation;

const fresh = (over: Partial<Freshness> = {}): Freshness =>
  ({ live: true, lastRefreshAt: NOW, ...over });

describe('selectFreshness', () => {
  it('never-heard (lastWsMessageAt = 0) is NOT live', () => {
    const f = selectFreshness(0, NOW, GONE);
    expect(f.live).toBe(false);
    expect(f.lastRefreshAt).toBe(0);
  });

  it('recent message is live', () => {
    const f = selectFreshness(NOW - 1000, NOW, GONE);
    expect(f.live).toBe(true);
    expect(f.lastRefreshAt).toBe(NOW - 1000);
  });

  it('exactly at the cutoff (now - last === goneMs) is STILL live', () => {
    const f = selectFreshness(NOW - GONE, NOW, GONE);
    expect(f.live).toBe(true);
  });

  it('one ms past the cutoff is NOT live', () => {
    const f = selectFreshness(NOW - GONE - 1, NOW, GONE);
    expect(f.live).toBe(false);
    expect(f.lastRefreshAt).toBe(NOW - GONE - 1);
  });

  it('defaults goneMs to the 15-min cutoff when omitted', () => {
    expect(selectFreshness(NOW - (GONE - 60_000), NOW).live).toBe(true);
    expect(selectFreshness(NOW - (GONE + 60_000), NOW).live).toBe(false);
  });
});

describe('fmtHHMM', () => {
  it('formats as locale HH:MM (TZ/locale-independent assertion)', () => {
    const ts = NOW;
    expect(fmtHHMM(ts)).toBe(
      new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    );
  });
});

// A session summary keyed for sessionSummaries; defaults to a benign 'active' state.
const summ = (over: Partial<SessionSummary> & { session: string }): SessionSummary =>
  ({ project: 'p', progressState: 'active', paneSeenAt: 0, updatedAt: 0, ...over });
const byKey = (...ss: SessionSummary[]): Record<string, SessionSummary> =>
  Object.fromEntries(ss.map((s) => [`${s.project}::${s.session}`, s]));

describe('selectVerdict', () => {
  it('DEAD-MAN: stale feed beats NON-EMPTY escalations (critical invariant)', () => {
    const v = selectVerdict([esc('e1'), esc('e2')], {}, fresh({ live: false }), NOW);
    expect(v.tone).toBe('disconnected');
    expect(v.line).toContain('NOT UPDATING');
    expect(v.line).not.toContain('decisions waiting');
    expect(v.updatedAt).toBe(NOW);
  });

  it('stale with a prior good time includes the formatted last-good time', () => {
    const last = NOW - GONE - 5000;
    const v = selectVerdict([], {}, fresh({ live: false, lastRefreshAt: last }), NOW);
    expect(v.tone).toBe('disconnected');
    expect(v.line).toContain(fmtHHMM(last));
    expect(v.updatedAt).toBe(last);
  });

  it('stale and never-heard (lastRefreshAt 0) omits the last-good suffix', () => {
    const v = selectVerdict([], {}, fresh({ live: false, lastRefreshAt: 0 }), NOW);
    expect(v.tone).toBe('disconnected');
    expect(v.line).toBe('NOT UPDATING — reconnecting…');
    expect(v.updatedAt).toBe(0);
  });

  it('live + nothing pending → all clear', () => {
    const v = selectVerdict([], {}, fresh(), NOW);
    expect(v.tone).toBe('clear');
    expect(v.line).toBe('All clear');
    expect(v.updatedAt).toBe(NOW);
  });

  it('a benign (active) session does not disturb all-clear', () => {
    const v = selectVerdict([], byKey(summ({ session: 'a', progressState: 'active' })), fresh(), NOW);
    expect(v.tone).toBe('clear');
    expect(v.line).toBe('All clear');
  });

  it('live + one escalation → singular', () => {
    const v = selectVerdict([esc('e1')], {}, fresh(), NOW);
    expect(v.tone).toBe('urgent');
    expect(v.line).toBe('1 decision waiting');
    expect(v.updatedAt).toBe(NOW);
  });

  it('live + many escalations → plural', () => {
    const v = selectVerdict([esc('e1'), esc('e2'), esc('e3')], {}, fresh(), NOW);
    expect(v.tone).toBe('urgent');
    expect(v.line).toBe('3 decisions waiting');
  });

  // Review 899f33a7: a wedged session with NO escalation must NOT read "All clear" green.
  it('wedged session (no escalation) → urgent "stuck", never green', () => {
    const v = selectVerdict([], byKey(summ({ session: 'w', progressState: 'wedged' })), fresh(), NOW);
    expect(v.tone).toBe('urgent');
    expect(v.line).toBe('1 session stuck');
  });

  it('wedged + decisions compose (wireframe order: stuck · waiting)', () => {
    const v = selectVerdict([esc('e1'), esc('e2')], byKey(summ({ session: 'w', progressState: 'wedged' })), fresh(), NOW);
    expect(v.tone).toBe('urgent');
    expect(v.line).toBe('1 session stuck · 2 decisions waiting');
  });

  // Review 416e00bb: the amber 'attention' branch must actually be emitted.
  it('unknown-liveness only → amber attention (the graded come-closer signal)', () => {
    const v = selectVerdict([], byKey(summ({ session: 'u', progressState: 'unknown' })), fresh(), NOW);
    expect(v.tone).toBe('attention');
    expect(v.line).toBe('1 session unknown');
  });

  it('a decision outranks unknown → urgent (unknown is the softer tier)', () => {
    const v = selectVerdict([esc('e1')], byKey(summ({ session: 'u', progressState: 'unknown' })), fresh(), NOW);
    expect(v.tone).toBe('urgent');
    expect(v.line).toBe('1 decision waiting · 1 session unknown');
  });
});
