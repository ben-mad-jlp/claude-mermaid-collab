import { describe, it, expect } from 'vitest';
import {
  selectParagraphStack,
  ageOpacityClass,
  summaryFreshness,
  type SessionSummary,
} from './paragraphStack';

const NOW = 1_700_000_000_000;

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    project: 'proj',
    session: 'sess',
    progressState: 'active',
    paneSeenAt: NOW - 30_000,
    updatedAt: NOW - 30_000,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────
// ageOpacityClass
// ──────────────────────────────────────────────────────────────

describe('ageOpacityClass', () => {
  it('returns opacity-60 when summaryUpdatedAt is undefined (no paragraph yet — Infinity age)', () => {
    expect(ageOpacityClass(undefined, NOW)).toBe('opacity-60');
  });

  it('returns opacity-100 for a fresh paragraph (age < 1m)', () => {
    expect(ageOpacityClass(NOW - 30_000, NOW)).toBe('opacity-100');
  });

  it('returns opacity-100 at exactly 0 age', () => {
    expect(ageOpacityClass(NOW, NOW)).toBe('opacity-100');
  });

  it('returns opacity-100 for negative age (clock skew)', () => {
    expect(ageOpacityClass(NOW + 5_000, NOW)).toBe('opacity-100');
  });

  it('returns opacity-90 for age just above 1m', () => {
    expect(ageOpacityClass(NOW - 60_001, NOW)).toBe('opacity-90');
  });

  it('returns opacity-90 at exactly 1m boundary (open — drops to next)', () => {
    // Exactly 60_000ms: age < 60_000 is false → drops to next bucket
    expect(ageOpacityClass(NOW - 60_000, NOW)).toBe('opacity-90');
  });

  it('returns opacity-90 for age < 5m', () => {
    expect(ageOpacityClass(NOW - 4 * 60_000, NOW)).toBe('opacity-90');
  });

  it('returns opacity-75 for age just above 5m', () => {
    expect(ageOpacityClass(NOW - 5 * 60_001, NOW)).toBe('opacity-75');
  });

  it('returns opacity-75 for age < 15m', () => {
    expect(ageOpacityClass(NOW - 10 * 60_000, NOW)).toBe('opacity-75');
  });

  it('returns opacity-60 for age >= 15m', () => {
    expect(ageOpacityClass(NOW - 15 * 60_000, NOW)).toBe('opacity-60');
    expect(ageOpacityClass(NOW - 30 * 60_000, NOW)).toBe('opacity-60');
  });
});

// ──────────────────────────────────────────────────────────────
// summaryFreshness
// ──────────────────────────────────────────────────────────────

describe('summaryFreshness', () => {
  it('returns failing=true when refreshState is stale-failing', () => {
    const s = makeSession({ refreshState: 'stale-failing', summaryUpdatedAt: NOW - 60_000 });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(true);
    expect(r.label).toBe('⚠ summary refresh failing');
  });

  it('returns failing=true when the pane CHANGED and the summary is >3m behind', () => {
    const s = makeSession({
      summaryUpdatedAt: NOW - 4 * 60_000,
      paneHash: 'NEW', summaryPaneHash: 'OLD', // pane moved on, summary stuck
    });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(true);
    expect(r.label).toBe('⚠ summary refresh failing');
  });

  it('returns failing=FALSE for an IDLE session however old (pane unchanged — hashes equal)', () => {
    // The bug this fixes: paneSeenAt advances every tick on an idle session, so the
    // old paneSeenAt-drift check falsely flagged every quiet session "failing".
    const s = makeSession({
      summaryUpdatedAt: NOW - 60 * 60_000, // summary an hour old…
      paneSeenAt: NOW - 1_000,             // …but pane still being seen every tick
      paneHash: 'SAME', summaryPaneHash: 'SAME', // and UNCHANGED → summary still accurate
    });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(false);
  });

  it('returns failing=false when the pane changed but within the 3m slack', () => {
    const s = makeSession({
      summaryUpdatedAt: NOW - 60_000, // 1m < slack
      paneHash: 'NEW', summaryPaneHash: 'OLD',
    });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(false);
  });

  it('returns "quiet Nm" with correct minute count when fresh', () => {
    const s = makeSession({ summaryUpdatedAt: NOW - 2 * 60_000 });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(false);
    expect(r.label).toBe('quiet 2m');
  });

  it('falls back to updatedAt for age when summaryUpdatedAt is absent', () => {
    const s = makeSession({ summaryUpdatedAt: undefined, updatedAt: NOW - 3 * 60_000 });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(false);
    expect(r.label).toBe('quiet 3m');
  });

  it('returns quiet 0m when never seen (no summaryUpdatedAt, no updatedAt)', () => {
    const s = makeSession({ summaryUpdatedAt: undefined, updatedAt: 0 });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(false);
    expect(r.label).toBe('quiet 0m');
  });

  it('ageMs is non-negative (floor, not ceil)', () => {
    const s = makeSession({ summaryUpdatedAt: NOW - 90_000 }); // 1m30s → floor = 1m
    const r = summaryFreshness(s, NOW);
    expect(r.label).toBe('quiet 1m');
  });

  it('refreshState fresh does not override the pane-changed lag check', () => {
    // refreshState:'fresh' but pane CHANGED and summary >3m behind → still failing
    const s = makeSession({
      refreshState: 'fresh',
      summaryUpdatedAt: NOW - 4 * 60_000,
      paneHash: 'NEW', summaryPaneHash: 'OLD',
    });
    const r = summaryFreshness(s, NOW);
    expect(r.failing).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// selectParagraphStack
// ──────────────────────────────────────────────────────────────

function makeRecord(sessions: Array<Partial<SessionSummary> & { key: string }>): Record<string, SessionSummary> {
  const rec: Record<string, SessionSummary> = {};
  for (const { key, ...rest } of sessions) {
    rec[key] = makeSession(rest);
  }
  return rec;
}

describe('selectParagraphStack', () => {
  it('returns [] for an empty record', () => {
    expect(selectParagraphStack({}, 5)).toEqual([]);
  });

  it('filters out sessions with no paragraph text', () => {
    const rec = makeRecord([
      { key: 'p::s1', summaryUpdatedAt: NOW - 1_000 },         // no text
      { key: 'p::s2', summaryText: 'hello', summaryUpdatedAt: NOW - 2_000 },
    ]);
    const stack = selectParagraphStack(rec, 5);
    expect(stack).toHaveLength(1);
    expect(stack[0].key).toBe('p::s2');
  });

  it('includes sessions with structured.paragraph', () => {
    const rec = makeRecord([
      { key: 'p::s1', structured: { paragraph: 'working hard', status: 'working' }, summaryUpdatedAt: NOW },
    ]);
    expect(selectParagraphStack(rec, 5)).toHaveLength(1);
  });

  it('includes sessions with firstClause only', () => {
    const rec = makeRecord([
      { key: 'p::s1', firstClause: 'Starting up', summaryUpdatedAt: NOW },
    ]);
    expect(selectParagraphStack(rec, 5)).toHaveLength(1);
  });

  it('sorts recency DESC (most recent first)', () => {
    const rec = makeRecord([
      { key: 'p::s1', summaryText: 'old', summaryUpdatedAt: NOW - 10_000 },
      { key: 'p::s2', summaryText: 'new', summaryUpdatedAt: NOW - 1_000 },
      { key: 'p::s3', summaryText: 'mid', summaryUpdatedAt: NOW - 5_000 },
    ]);
    const stack = selectParagraphStack(rec, 5);
    expect(stack.map(m => m.key)).toEqual(['p::s2', 'p::s3', 'p::s1']);
  });

  it('caps at the given limit', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({
      key: `p::s${i}`,
      summaryText: `text ${i}`,
      summaryUpdatedAt: NOW - i * 1_000,
    }));
    const rec = makeRecord(sessions);
    expect(selectParagraphStack(rec, 5)).toHaveLength(5);
  });

  it('keeps the 5 most recent when given more than 5', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({
      key: `p::s${i}`,
      summaryText: `text ${i}`,
      summaryUpdatedAt: NOW - i * 1_000, // s0 is newest
    }));
    const rec = makeRecord(sessions);
    const stack = selectParagraphStack(rec, 5);
    expect(stack.map(m => m.key)).toEqual(['p::s0', 'p::s1', 'p::s2', 'p::s3', 'p::s4']);
  });

  it('uses summaryUpdatedAt as recencyAt, falls back to updatedAt', () => {
    const rec = makeRecord([
      { key: 'p::s1', summaryText: 'a', summaryUpdatedAt: undefined, updatedAt: NOW - 1_000 },
      { key: 'p::s2', summaryText: 'b', summaryUpdatedAt: NOW - 500, updatedAt: NOW - 5_000 },
    ]);
    const stack = selectParagraphStack(rec, 5);
    // s2 has summaryUpdatedAt=NOW-500 (more recent) → first
    expect(stack[0].key).toBe('p::s2');
  });

  it('uses paneSeenAt in recency when it is the maximum', () => {
    const rec = makeRecord([
      { key: 'p::s1', summaryText: 'a', summaryUpdatedAt: NOW - 10_000, paneSeenAt: NOW - 500, updatedAt: NOW - 10_000 },
      { key: 'p::s2', summaryText: 'b', summaryUpdatedAt: NOW - 3_000, paneSeenAt: NOW - 3_000, updatedAt: NOW - 3_000 },
    ]);
    const stack = selectParagraphStack(rec, 5);
    // s1's recency = max(NOW-10k, NOW-500, NOW-10k) = NOW-500 → most recent
    expect(stack[0].key).toBe('p::s1');
  });

  it('prefers structured.paragraph over summaryText over firstClause (filter only — all qualify)', () => {
    // all three have text → all included; this tests that filter passes for each source
    const s1 = makeSession({ structured: { paragraph: 'para', status: 'working' }, summaryUpdatedAt: NOW - 3_000 });
    const s2 = makeSession({ summaryText: 'summary', summaryUpdatedAt: NOW - 2_000 });
    const s3 = makeSession({ firstClause: 'clause', summaryUpdatedAt: NOW - 1_000 });
    const rec: Record<string, SessionSummary> = { 'p::s1': s1, 'p::s2': s2, 'p::s3': s3 };
    expect(selectParagraphStack(rec, 5)).toHaveLength(3);
  });

  it('returns ParagraphCardModel with correct project, session, summary, key', () => {
    const rec = makeRecord([
      { key: 'myproj::mysess', project: 'myproj', session: 'mysess', summaryText: 'hi', summaryUpdatedAt: NOW },
    ]);
    const stack = selectParagraphStack(rec, 5);
    expect(stack[0]).toMatchObject({ key: 'myproj::mysess', project: 'myproj', session: 'mysess' });
  });

  it('is deterministic on tie-break (key ASC)', () => {
    const sharedAt = NOW - 1_000;
    const rec = makeRecord([
      { key: 'p::z', summaryText: 'z', summaryUpdatedAt: sharedAt, paneSeenAt: sharedAt, updatedAt: sharedAt },
      { key: 'p::a', summaryText: 'a', summaryUpdatedAt: sharedAt, paneSeenAt: sharedAt, updatedAt: sharedAt },
      { key: 'p::m', summaryText: 'm', summaryUpdatedAt: sharedAt, paneSeenAt: sharedAt, updatedAt: sharedAt },
    ]);
    const stack = selectParagraphStack(rec, 5);
    expect(stack.map(s => s.key)).toEqual(['p::a', 'p::m', 'p::z']);
  });
});
