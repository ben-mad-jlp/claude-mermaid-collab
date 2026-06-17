import { describe, it, expect } from 'vitest';
import type { Escalation } from '@/stores/supervisorStore';
import {
  selectOpenEscalations,
  selectOpenEscalationCount,
  selectEscalationKindCounts,
  selectLiveness,
  selectSessionStatus,
  type StatusScope,
  type SessionStatus,
} from './statusSelectors';

// ── fixtures ──────────────────────────────────────────────────────────────────

const esc = (project: string, session: string, status: string, id: string): Escalation =>
  ({
    id,
    project,
    session,
    kind: 'decision',
    questionText: 'q',
    status,
    createdAt: 1,
  }) as Escalation;

// Two projects, multiple sessions, mixed statuses.
const ESCALATIONS: Escalation[] = [
  esc('projA', 'a1', 'open', 'e1'),
  esc('projA', 'a1', 'open', 'e2'),
  esc('projA', 'a2', 'open', 'e3'),
  esc('projA', 'a1', 'resolved', 'e4'), // not open → excluded everywhere
  esc('projB', 'b1', 'open', 'e5'),
  esc('projB', 'b1', 'resolved', 'e6'),
];

const sess = (
  serverId: string,
  project: string,
  session: string,
  status: SessionStatus['status'],
  extra: Partial<SessionStatus> = {},
): SessionStatus => ({ serverId, project, session, status, ...extra });

const SESSIONS: Record<string, SessionStatus> = {
  'srv1:projA:a1': sess('srv1', 'projA', 'a1', 'active'),
  'srv1:projA:a2': sess('srv1', 'projA', 'a2', 'waiting'),
  'srv2:projB:b1': sess('srv2', 'projB', 'b1', 'permission'),
  'srv2:projB:b2': sess('srv2', 'projB', 'b2', 'unknown', { stale: true }),
};

const FLEET: StatusScope = { kind: 'fleet' };
const PROJ_A: StatusScope = { kind: 'project', project: 'projA' };
const SESS_A1: StatusScope = { kind: 'session', project: 'projA', session: 'a1' };

// ── selectOpenEscalations ──────────────────────────────────────────────────────

describe('selectOpenEscalations — scope narrowing fleet ⊃ project ⊃ session', () => {
  it('fleet returns every open escalation (resolved excluded)', () => {
    const r = selectOpenEscalations(ESCALATIONS, FLEET);
    expect(r.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3', 'e5']);
  });

  it('project narrows to one project, still open-only', () => {
    const r = selectOpenEscalations(ESCALATIONS, PROJ_A);
    expect(r.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('session narrows to one project+session', () => {
    const r = selectOpenEscalations(ESCALATIONS, SESS_A1);
    expect(r.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('strict containment: session ⊆ project ⊆ fleet', () => {
    const f = new Set(selectOpenEscalations(ESCALATIONS, FLEET).map((e) => e.id));
    const p = new Set(selectOpenEscalations(ESCALATIONS, PROJ_A).map((e) => e.id));
    const s = new Set(selectOpenEscalations(ESCALATIONS, SESS_A1).map((e) => e.id));
    for (const id of s) expect(p.has(id)).toBe(true);
    for (const id of p) expect(f.has(id)).toBe(true);
  });

  it('tolerates a non-array slice (not-yet-hydrated)', () => {
    expect(selectOpenEscalations(undefined as unknown as Escalation[], FLEET)).toEqual([]);
  });

  it('is deterministic and does not mutate its input', () => {
    const before = ESCALATIONS.map((e) => e.id);
    const r1 = selectOpenEscalations(ESCALATIONS, PROJ_A);
    const r2 = selectOpenEscalations(ESCALATIONS, PROJ_A);
    expect(r1.map((e) => e.id)).toEqual(r2.map((e) => e.id));
    expect(ESCALATIONS.map((e) => e.id)).toEqual(before);
  });
});

// ── selectOpenEscalationCount — parity with the list ───────────────────────────

describe('selectOpenEscalationCount — parity with selectOpenEscalations', () => {
  for (const [name, scope] of [
    ['fleet', FLEET],
    ['project', PROJ_A],
    ['session', SESS_A1],
  ] as const) {
    it(`count === list length at ${name} scope`, () => {
      expect(selectOpenEscalationCount(ESCALATIONS, scope)).toBe(
        selectOpenEscalations(ESCALATIONS, scope).length,
      );
    });
  }

  it('tolerates a non-array slice', () => {
    expect(selectOpenEscalationCount(undefined as unknown as Escalation[], FLEET)).toBe(0);
  });
});

// ── selectEscalationKindCounts — land-ready split from blockers ────────────────

describe('selectEscalationKindCounts', () => {
  const KINDS: Escalation[] = [
    { ...esc('projA', 'a1', 'open', 'k1'), kind: 'blocker' } as Escalation,
    { ...esc('projA', 'a2', 'open', 'k2'), kind: 'decision' } as Escalation,
    { ...esc('projA', 'a3', 'open', 'k3'), kind: 'epic-ready-to-land' } as Escalation,
    { ...esc('projA', 'a4', 'open', 'k4'), kind: 'epic-ready-to-land' } as Escalation,
    { ...esc('projA', 'a5', 'resolved', 'k5'), kind: 'blocker' } as Escalation, // not open → excluded
    { ...esc('projB', 'b1', 'open', 'k6'), kind: 'blocker' } as Escalation, // other project
  ];

  it('splits land-ready from blockers and ignores resolved + out-of-scope', () => {
    const c = selectEscalationKindCounts(KINDS, PROJ_A);
    expect(c).toEqual({ blockers: 2, landReady: 2, total: 4 });
  });

  it('total stays in parity with selectOpenEscalationCount', () => {
    const c = selectEscalationKindCounts(KINDS, PROJ_A);
    expect(c.total).toBe(selectOpenEscalationCount(KINDS, PROJ_A));
  });

  it('tolerates a non-array slice', () => {
    expect(selectEscalationKindCounts(undefined as unknown as Escalation[], FLEET)).toEqual({ blockers: 0, landReady: 0, total: 0 });
  });
});

// ── selectLiveness — scope narrowing + roll-up ─────────────────────────────────

describe('selectLiveness', () => {
  it('fleet rolls up every session by status', () => {
    const v = selectLiveness(SESSIONS, FLEET);
    expect(v.total).toBe(4);
    expect(v.active).toBe(1);
    expect(v.waiting).toBe(1);
    expect(v.permission).toBe(1);
    expect(v.unknown).toBe(1);
    expect(v.stale).toBe(1);
    // needsAttention = waiting + permission
    expect(v.needsAttention).toBe(2);
  });

  it('project scope narrows the session set', () => {
    const v = selectLiveness(SESSIONS, PROJ_A);
    expect(v.total).toBe(2);
    expect(v.sessions.map((s) => s.session).sort()).toEqual(['a1', 'a2']);
    expect(v.active).toBe(1);
    expect(v.waiting).toBe(1);
    expect(v.needsAttention).toBe(1);
  });

  it('session scope narrows to exactly one session', () => {
    const v = selectLiveness(SESSIONS, SESS_A1);
    expect(v.total).toBe(1);
    expect(v.sessions[0].session).toBe('a1');
    expect(v.active).toBe(1);
    expect(v.needsAttention).toBe(0);
  });

  it('strict containment of session counts: session ≤ project ≤ fleet', () => {
    expect(selectLiveness(SESSIONS, SESS_A1).total).toBeLessThanOrEqual(
      selectLiveness(SESSIONS, PROJ_A).total,
    );
    expect(selectLiveness(SESSIONS, PROJ_A).total).toBeLessThanOrEqual(
      selectLiveness(SESSIONS, FLEET).total,
    );
  });

  it('tolerates an empty / nullish map', () => {
    expect(selectLiveness({}, FLEET).total).toBe(0);
    expect(selectLiveness(undefined as unknown as Record<string, SessionStatus>, FLEET).total).toBe(
      0,
    );
  });
});

// ── selectSessionStatus — exact key + serverId-agnostic fallback (D6) ──────────

describe('selectSessionStatus', () => {
  it('resolves via the exact composite key', () => {
    const s = selectSessionStatus(SESSIONS, 'srv1', 'projA', 'a1');
    expect(s?.status).toBe('active');
  });

  it('falls back to a serverId-agnostic match (local-sentinel mismatch, D6)', () => {
    // Asked for serverId 'local' but the entry is keyed under 'srv2'.
    const s = selectSessionStatus(SESSIONS, 'local', 'projB', 'b1');
    expect(s?.status).toBe('permission');
  });

  it('returns undefined when nothing matches', () => {
    expect(selectSessionStatus(SESSIONS, 'srv1', 'projA', 'nope')).toBeUndefined();
    expect(
      selectSessionStatus(undefined as unknown as Record<string, SessionStatus>, 's', 'p', 'x'),
    ).toBeUndefined();
  });
});
