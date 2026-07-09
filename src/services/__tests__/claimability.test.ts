/**
 * Unit tests for claimability.ts (epic b2c858d4 S2) — the single eligibility predicate.
 * Pure; no DB. Exercises every ClaimReason branch, the dep-rejected-before-deps-pending
 * ordering, the orphan-as-null claim, the human-assignee split, and derivedStatus.
 */
import { describe, it, expect } from 'bun:test';
import {
  depSatisfied,
  claimReason,
  isClaimable,
  derivedStatus,
  isInboxEpic,
  parentIsInbox,
  INBOX_EPIC_TITLE,
} from '../claimability';
import type { Todo } from '../todo-store';
import { kindOf, MissingKindError } from '../todo-kind';
import cases from './fixtures/claimability-cases.json';

function mk(over: Partial<Todo> = {}): Todo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null, sessionName: null,
    executedBySession: null, blueprintId: null, type: null, kind: 'leaf', targetProject: null,
    acceptanceStatus: null, claimedBy: null, claimToken: null, claimedAt: null,
    claimLeaseMs: null, claim: null, approvedAt: null, approvedBy: null, heldAt: null,
    heldReason: null, retryCount: 0, completedBy: null, objectRef: null, decisionRef: null,
    claimProbe: null, ...over,
  };
}
const APPROVED = '2026-06-17T00:00:00Z';
const CLAIM = { by: 'coordinator', token: 'tok', at: APPROVED, leaseMs: 1000 };
const map = (...todos: Todo[]) => new Map(todos.map((t) => [t.id, t]));

describe('depSatisfied', () => {
  it('done + not-rejected = satisfied; everything else not', () => {
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: 'accepted' }))).toBe(true);
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: null }))).toBe(true);
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: 'rejected' }))).toBe(false); // the behavior change
    expect(depSatisfied(mk({ status: 'in_progress' }))).toBe(false);
    expect(depSatisfied(undefined)).toBe(false);
  });
  it('accepted dep is satisfied even if status not done (75f7e304 symmetry; rejected still blocks)', () => {
    expect(depSatisfied(mk({ status: 'planned', acceptanceStatus: 'accepted' }))).toBe(true);
    expect(depSatisfied(mk({ status: 'ready', acceptanceStatus: 'accepted' }))).toBe(true);
    expect(depSatisfied(mk({ status: 'in_progress', acceptanceStatus: 'accepted' }))).toBe(true);
    expect(depSatisfied(mk({ status: 'done', acceptanceStatus: 'rejected' }))).toBe(false);
  });
  it('F3 unification: a dangling dep id is a data bug, not a satisfied dep', () => {
    expect(depSatisfied(undefined)).toBe(false);
  });
  it('F3 unification: accepts a bare {status,acceptanceStatus} projection (migration call shape)', () => {
    expect(depSatisfied({ status: 'done', acceptanceStatus: null })).toBe(true);
    expect(depSatisfied({ status: 'in_progress', acceptanceStatus: 'accepted' })).toBe(true);
    expect(depSatisfied({ status: 'done', acceptanceStatus: 'rejected' })).toBe(false);
    expect(depSatisfied({ status: 'in_progress', acceptanceStatus: null })).toBe(false);
  });
});

describe('claimReason — each branch', () => {
  const approved = { approvedAt: APPROVED };
  it('terminal: done|dropped (wins over everything)', () => {
    expect(claimReason(mk({ status: 'done', claim: CLAIM }), map())).toBe('terminal');
    expect(claimReason(mk({ status: 'dropped' }), map())).toBe('terminal');
  });
  it('terminal: accepted (even if status reset to non-done; 75f7e304 symmetry)', () => {
    // An accepted-but-reset leaf must be terminal regardless of stored status.
    expect(claimReason(mk({ status: 'planned', acceptanceStatus: 'accepted', approvedAt: APPROVED }), map())).toBe('terminal');
    expect(claimReason(mk({ status: 'ready', acceptanceStatus: 'accepted', approvedAt: APPROVED }), map())).toBe('terminal');
    expect(claimReason(mk({ status: 'in_progress', acceptanceStatus: 'accepted', approvedAt: APPROVED }), map())).toBe('terminal');
  });
  it('in-flight: claim != null', () => {
    expect(claimReason(mk({ status: 'planned', claim: CLAIM, ...approved }), map())).toBe('in-flight');
  });
  it('unapproved: approvedAt == null (before hold/deps)', () => {
    expect(claimReason(mk({ heldAt: APPROVED }), map())).toBe('unapproved');
  });
  it('held: heldAt != null (after approval)', () => {
    expect(claimReason(mk({ ...approved, heldAt: APPROVED }), map())).toBe('held');
  });
  it("rejected: a todo's OWN acceptanceStatus==='rejected' is NOT claimable (80f85190)", () => {
    // A rejected completion is non-terminal (status 'planned') + still approved +
    // no claim/hold — must be held out, not auto-reclaimed.
    const t = mk({ ...approved, status: 'planned', acceptanceStatus: 'rejected' });
    expect(claimReason(t, map())).toBe('rejected');
    expect(isClaimable(t, map())).toBe(false);
  });
  it('isClaimable false for accepted even with non-done status (75f7e304)', () => {
    const approved = { approvedAt: APPROVED };
    expect(isClaimable(mk({ status: 'planned', acceptanceStatus: 'accepted', ...approved }), map())).toBe(false);
    expect(isClaimable(mk({ status: 'ready', acceptanceStatus: 'accepted', ...approved }), map())).toBe(false);
    expect(isClaimable(mk({ status: 'in_progress', acceptanceStatus: 'accepted', ...approved }), map())).toBe(false);
  });
  it('dep-rejected BEFORE deps-pending', () => {
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'rejected' });
    const pending = mk({ id: 'P', status: 'in_progress' });
    const t = mk({ ...approved, dependsOn: ['D', 'P'] });
    expect(claimReason(t, map(dep, pending))).toBe('dep-rejected');
  });
  it('deps-pending: a dep not yet terminal', () => {
    const dep = mk({ id: 'D', status: 'in_progress' });
    const t = mk({ ...approved, dependsOn: ['D'] });
    expect(claimReason(t, map(dep))).toBe('deps-pending');
  });
  it('deps-pending: a dangling dep id blocks (never silently claimable)', () => {
    const t = mk({ id: 'A', ...approved, dependsOn: ['ghost'] });
    expect(claimReason(t, map(t))).toBe('deps-pending');
    expect(isClaimable(t, map(t))).toBe(false);
  });
  it('human-assignee: fully unblocked + approved human → not auto-claimed', () => {
    const t = mk({ ...approved, assigneeKind: 'human' });
    expect(claimReason(t, map())).toBe('human-assignee');
  });
  it('claimable: agent, approved, unheld, no deps', () => {
    expect(claimReason(mk({ ...approved }), map())).toBe('claimable');
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    expect(claimReason(mk({ ...approved, dependsOn: ['D'] }), map(dep))).toBe('claimable');
  });
  it('decision gates apply to human todos too (unapproved/held/deps come before human-assignee)', () => {
    expect(claimReason(mk({ assigneeKind: 'human' }), map())).toBe('unapproved');
    const dep = mk({ id: 'D', status: 'in_progress' });
    expect(claimReason(mk({ assigneeKind: 'human', approvedAt: APPROVED, dependsOn: ['D'] }), map(dep))).toBe('deps-pending');
  });
});

describe('Inbox = planning-only (inbox-planning gate)', () => {
  const inbox = mk({ id: 'IB', title: INBOX_EPIC_TITLE, parentId: null, kind: 'epic' });
  const realEpic = mk({ id: 'EP', title: '[EPIC] Real work', parentId: null, kind: 'epic' });

  it('isInboxEpic: only the Inbox root', () => {
    expect(isInboxEpic(inbox)).toBe(true);
    expect(isInboxEpic(realEpic)).toBe(false);
    expect(isInboxEpic(undefined)).toBe(false);
  });

  it('isInboxEpic: tolerates the legacy prefixed literal', () => {
    expect(isInboxEpic(mk({ title: '[EPIC] Inbox', kind: 'epic' }))).toBe(true);
  });

  it('isInboxEpic: role comes from kind, never the word alone', () => {
    expect(isInboxEpic(mk({ title: 'Inbox', kind: 'leaf' }))).toBe(false);
  });

  it('parentIsInbox: true only when parent is the Inbox epic', () => {
    const child = mk({ id: 'C', parentId: 'IB' });
    expect(parentIsInbox(child, map(inbox))).toBe(true);
    expect(parentIsInbox(mk({ id: 'C', parentId: 'EP' }), map(realEpic))).toBe(false);
    expect(parentIsInbox(mk({ id: 'C', parentId: null }), map(inbox))).toBe(false);
  });

  it("child of Inbox → 'inbox-planning' EVEN when approved + deps done (above unapproved)", () => {
    const child = mk({ id: 'C', parentId: 'IB', approvedAt: APPROVED });
    expect(claimReason(child, map(inbox))).toBe('inbox-planning');
    expect(isClaimable(child, map(inbox))).toBe(false);
    // with deps satisfied too — still gated
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    const child2 = mk({ id: 'C2', parentId: 'IB', approvedAt: APPROVED, dependsOn: ['D'] });
    expect(claimReason(child2, map(inbox, dep))).toBe('inbox-planning');
    expect(isClaimable(child2, map(inbox, dep))).toBe(false);
  });

  it('re-homed to a real epic → claimable (approved + deps done)', () => {
    const child = mk({ id: 'C', parentId: 'EP', approvedAt: APPROVED });
    expect(claimReason(child, map(realEpic))).toBe('claimable');
    expect(isClaimable(child, map(realEpic))).toBe(true);
  });

  it('Inbox epic itself (root) is unaffected — gated only by normal rules', () => {
    // The Inbox epic has no parent → never 'inbox-planning'. Unapproved → 'unapproved'.
    expect(claimReason(inbox, map(inbox))).toBe('unapproved');
    expect(claimReason(mk({ id: 'IB2', title: INBOX_EPIC_TITLE, kind: 'epic', approvedAt: APPROVED }), map())).toBe('claimable');
  });

  it('children of a real epic are unaffected', () => {
    const child = mk({ id: 'C', parentId: 'EP' });
    expect(claimReason(child, map(realEpic))).toBe('unapproved'); // normal gate, not inbox
  });

  it('kindOf still THROWS on a kind-less payload — the throw is the feature, not a default', () => {
    expect(() => kindOf(mk({ kind: null }))).toThrow(MissingKindError);
    expect(() => isInboxEpic(mk({ id: 'X', title: INBOX_EPIC_TITLE, kind: null }))).toThrow(MissingKindError);
  });
});

describe('isClaimable', () => {
  it('true only for the claimable reason', () => {
    expect(isClaimable(mk({ approvedAt: APPROVED }), map())).toBe(true);
    expect(isClaimable(mk({ approvedAt: APPROVED, heldAt: APPROVED }), map())).toBe(false);
    expect(isClaimable(mk({ assigneeKind: 'human', approvedAt: APPROVED }), map())).toBe(false);
  });
});

describe('derivedStatus (legacy-shaped label)', () => {
  it('maps derived state to the old enum vocabulary', () => {
    expect(derivedStatus(mk({ status: 'done' }), map())).toBe('done');
    expect(derivedStatus(mk({ status: 'dropped' }), map())).toBe('dropped');
    expect(derivedStatus(mk({ claim: CLAIM }), map())).toBe('in_progress');
    expect(derivedStatus(mk({ approvedAt: APPROVED }), map())).toBe('ready');
    expect(derivedStatus(mk({}), map())).toBe('planned'); // unapproved
    expect(derivedStatus(mk({ approvedAt: APPROVED, heldAt: APPROVED }), map())).toBe('blocked');
  });
});

describe('shared fixture — server/UI parity table', () => {
  for (const c of cases.cases) {
    it(`${c.name}: ${c.why}`, () => {
      const byId = map(...c.todos.map((t) => mk(t as Partial<Todo>)));
      const subject = byId.get(c.subject);
      expect(subject).toBeDefined();
      expect(claimReason(subject!, byId)).toBe(c.expect.claimReason);
      expect(derivedStatus(subject!, byId)).toBe(c.expect.derivedStatus);
      expect(isClaimable(subject!, byId)).toBe(c.expect.isClaimable);
    });
  }
});

describe('dep-dropped (68b8bb09) — derived, never stored', () => {
  const approved = { approvedAt: APPROVED };

  it('a dropped dep reports dep-dropped, not deps-pending', () => {
    const dep = mk({ id: 'D', status: 'dropped' });
    const t = mk({ id: 'T', ...approved, dependsOn: ['D'] });
    expect(claimReason(t, map(dep, t))).toBe('dep-dropped');
    expect(isClaimable(t, map(dep, t))).toBe(false);
    expect(derivedStatus(t, map(dep, t))).toBe('blocked'); // no distinct legacy label
  });

  it('reset_todo on the dep returns the dependent to deps-pending — the reason is DERIVED', () => {
    // Same dependent object, byId rebuilt with the dep reset off `dropped`.
    const t = mk({ id: 'T', ...approved, dependsOn: ['D'] });
    expect(claimReason(t, map(mk({ id: 'D', status: 'dropped' }), t))).toBe('dep-dropped');
    expect(claimReason(t, map(mk({ id: 'D', status: 'planned' }), t))).toBe('deps-pending');
    // …and a dep reset all the way to done makes it claimable, with T never re-read from a column.
    expect(claimReason(t, map(mk({ id: 'D', status: 'done' }), t))).toBe('claimable');
  });

  it('dep-rejected wins when a todo is blocked by BOTH (claimability.ts:118-124)', () => {
    const dropped = mk({ id: 'DD', status: 'dropped' });
    const rejected = mk({ id: 'DR', status: 'done', acceptanceStatus: 'rejected' });
    const t = mk({ id: 'T', ...approved, dependsOn: ['DD', 'DR'] });
    expect(claimReason(t, map(dropped, rejected, t))).toBe('dep-rejected');
    // Reset the rejected dep → the harder blocker surfaces on the very next read.
    const healed = mk({ id: 'DR', status: 'done', acceptanceStatus: 'accepted' });
    expect(claimReason(t, map(dropped, healed, t))).toBe('dep-dropped');
  });

  it('a dangling dep id is not a drop — it reports deps-pending', () => {
    const t = mk({ id: 'T', ...approved, dependsOn: ['GHOST'] });
    expect(claimReason(t, map(t))).toBe('deps-pending');
  });
});
