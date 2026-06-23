import { describe, it, expect } from 'vitest';
import type { Escalation } from '@/stores/supervisorStore';
import {
  selectTriageStack,
  selectTriageTop,
  wedgeMinutes,
  escalationSeverity,
  SEV_GATED_OR_WEDGED,
  SEV_ROUTINE,
  SEV_UNKNOWN_SOFT,
  type SessionSummary,
} from './triageSelectors';

// ── fixtures ──────────────────────────────────────────────────────────────────

const esc = (id: string, status: string, createdAt: number, operatorGated?: boolean): Escalation =>
  ({ id, project: 'p', session: 's', kind: 'decision', questionText: 'q',
     status, createdAt, operatorGated }) as Escalation;

const summary = (
  session: string,
  progressState: SessionSummary['progressState'],
  paneSeenAt: number,
  extra: Partial<SessionSummary> = {},
): SessionSummary =>
  ({ project: 'p', session, progressState, paneSeenAt, updatedAt: paneSeenAt, ...extra });

const asRecord = (...s: SessionSummary[]): Record<string, SessionSummary> =>
  Object.fromEntries(s.map((x) => [`${x.project}:${x.session}`, x]));

const NOW = 1_000_000;

// ── selectTriageStack ─────────────────────────────────────────────────────────

describe('selectTriageStack', () => {
  it('operator-gated + wedged outrank routine approvals (core invariant)', () => {
    const escalations: Escalation[] = [
      esc('e-routine', 'open', 200),               // SEV_ROUTINE, no operatorGated
      esc('e-gated',   'open', 300, true),          // SEV_GATED_OR_WEDGED
    ];
    const summaries = asRecord(
      summary('s-wedged',  'wedged',  400),         // SEV_GATED_OR_WEDGED
      summary('s-unknown', 'unknown', 500),         // SEV_UNKNOWN_SOFT
    );

    const stack = selectTriageStack(escalations, summaries, NOW);

    // Every gated/wedged item is SEV_GATED_OR_WEDGED; routine is SEV_ROUTINE
    const gatedItems = stack.filter((i) => i.severity === SEV_GATED_OR_WEDGED);
    const routineItems = stack.filter((i) => i.severity === SEV_ROUTINE);
    const unknownItems = stack.filter((i) => i.severity === SEV_UNKNOWN_SOFT);

    expect(gatedItems.length).toBe(2);   // e-gated + s-wedged
    expect(routineItems.length).toBe(1); // e-routine
    expect(unknownItems.length).toBe(1); // s-unknown

    // Gated/wedged severity strictly > routine
    for (const g of gatedItems) {
      expect(g.severity).toBeGreaterThan(SEV_ROUTINE);
    }

    // Severity sequence is non-increasing (strong position-independent guard)
    const severities = stack.map((i) => i.severity);
    for (let idx = 1; idx < severities.length; idx++) {
      expect(severities[idx]).toBeLessThanOrEqual(severities[idx - 1]);
    }

    // Every gated/wedged item appears before every routine item in the array
    const lastGatedIdx = Math.max(...gatedItems.map((g) => stack.indexOf(g)));
    const firstRoutineIdx = Math.min(...routineItems.map((r) => stack.indexOf(r)));
    expect(lastGatedIdx).toBeLessThan(firstRoutineIdx);

    // Routine appears before unknown
    const lastRoutineIdx = Math.max(...routineItems.map((r) => stack.indexOf(r)));
    const firstUnknownIdx = Math.min(...unknownItems.map((u) => stack.indexOf(u)));
    expect(lastRoutineIdx).toBeLessThan(firstUnknownIdx);
  });

  it('selectTriageTop returns the most-urgent item', () => {
    const escalations: Escalation[] = [
      esc('e-routine-1', 'open', 100),
      esc('e-routine-2', 'open', 200),
      esc('e-gated',     'open', 300, true),
    ];
    const summaries = asRecord(
      summary('s-active', 'active', 150),  // excluded
    );

    const top = selectTriageTop(escalations, summaries, NOW);

    expect(top).not.toBeNull();
    expect(top!.kind).toBe('escalation');
    expect(top!.severity).toBe(SEV_GATED_OR_WEDGED);
    if (top!.kind === 'escalation') {
      expect(top!.escalation.id).toBe('e-gated');
    }
  });

  it('wedge buried under a routine approve is rescued (regression scenario)', () => {
    // Routine approve has an OLDER createdAt (100) — age alone would float it up.
    // Wedged session has a NEWER paneSeenAt (500). Severity must dominate age.
    const escalations: Escalation[] = [
      esc('e-routine-old', 'open', 100),  // SEV_ROUTINE, oldest timestamp
    ];
    const summaries = asRecord(
      summary('s-wedged-new', 'wedged', 500),  // SEV_GATED_OR_WEDGED, newer timestamp
    );

    const stack = selectTriageStack(escalations, summaries, NOW);

    expect(stack.length).toBe(2);
    // Wedge must be first despite having a newer (larger) since value
    expect(stack[0].kind).toBe('wedge');
    expect(stack[0].severity).toBe(SEV_GATED_OR_WEDGED);
    expect(stack[1].kind).toBe('escalation');
    expect(stack[1].severity).toBe(SEV_ROUTINE);
  });

  it('ties broken by age (oldest first) within the top tier', () => {
    const escalations: Escalation[] = [
      esc('e-gated-newer', 'open', 100, true),   // top tier, since=100
      esc('e-routine-a',   'open', 300),          // routine, since=300
      esc('e-routine-b',   'open', 150),          // routine, since=150
    ];
    const summaries = asRecord(
      summary('s-wedged-older', 'wedged', 50),   // top tier, since=50
    );

    const stack = selectTriageStack(escalations, summaries, NOW);

    // Top tier: s-wedged-older (since=50) before e-gated-newer (since=100)
    expect(stack[0].since).toBe(50);
    expect(stack[1].since).toBe(100);

    const top = selectTriageTop(escalations, summaries, NOW);
    expect(top!.since).toBe(50);

    // Routine tier: e-routine-b (since=150) before e-routine-a (since=300)
    const routineItems = stack.filter((i) => i.severity === SEV_ROUTINE);
    expect(routineItems[0].since).toBe(150);
    expect(routineItems[1].since).toBe(300);
  });

  it('exclusions hold', () => {
    // Non-open escalation is omitted
    const closedEsc: Escalation[] = [esc('e-resolved', 'resolved', 100)];
    expect(selectTriageStack(closedEsc, {}, NOW)).toHaveLength(0);

    // active/quiet/stalled sessions are omitted
    const irrelevantSessions = asRecord(
      summary('s-active',  'active',  100),
      summary('s-quiet',   'quiet',   200),
      summary('s-stalled', 'stalled', 300),
    );
    expect(selectTriageStack([], irrelevantSessions, NOW)).toHaveLength(0);

    // Snoozed wedge is excluded when snoozedUntil > now
    const snoozedSessions = asRecord(
      summary('s-snoozed', 'wedged', 100, { snoozedUntil: NOW + 1000 }),
    );
    expect(selectTriageStack([], snoozedSessions, NOW)).toHaveLength(0);

    // Expired snooze (snoozedUntil < now) is included
    const expiredSnoozeSessions = asRecord(
      summary('s-expired-snooze', 'wedged', 100, { snoozedUntil: NOW - 1 }),
    );
    expect(selectTriageStack([], expiredSnoozeSessions, NOW)).toHaveLength(1);

    // Empty inputs
    expect(selectTriageStack([], {}, NOW)).toEqual([]);
    expect(selectTriageTop([], {}, NOW)).toBeNull();
  });

  // NOTE: per-escalation snooze is no longer a selectTriageStack concern — the 4th arg
  // is TriageStackOpts {onlyYouIds, clearedIds} and per-item snooze lives in the
  // notification store. (The old snooze-map-signature test was removed in the Zen redesign.)

  it('escalationSeverity unit pin — confirms constant ordering 3 > 2 > 1', () => {
    const gated   = esc('eg', 'open', 1, true);
    const routine = esc('er', 'open', 1);

    expect(escalationSeverity(gated)).toBe(SEV_GATED_OR_WEDGED);
    expect(escalationSeverity(routine)).toBe(SEV_ROUTINE);

    expect(SEV_GATED_OR_WEDGED).toBeGreaterThan(SEV_ROUTINE);
    expect(SEV_ROUTINE).toBeGreaterThan(SEV_UNKNOWN_SOFT);
    expect(SEV_GATED_OR_WEDGED).toBe(3);
    expect(SEV_ROUTINE).toBe(2);
    expect(SEV_UNKNOWN_SOFT).toBe(1);
  });
});

// ── wedgeMinutes sanity ───────────────────────────────────────────────────────

describe('wedgeMinutes', () => {
  it('returns elapsed minutes floored to zero minimum', () => {
    const s = summary('s1', 'wedged', NOW - 90_000);
    expect(wedgeMinutes(s, NOW)).toBe(1); // 90s → 1 minute
  });

  it('clamps to 0 when paneSeenAt is in the future', () => {
    const s = summary('s1', 'wedged', NOW + 5_000);
    expect(wedgeMinutes(s, NOW)).toBe(0);
  });
});
