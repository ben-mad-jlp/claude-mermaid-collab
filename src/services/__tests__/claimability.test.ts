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
  isInboxEpicTitle,
  parentIsInbox,
  danglingDeps,
  INBOX_EPIC_TITLE,
} from '../claimability';
import type { ClaimReason } from '../claimability';
import type { Todo } from '../todo-store';
import { kindOf, MissingKindError } from '../todo-kind';
import rawCases from './fixtures/claimability-cases.json';

interface ParityCase {
  name: string;
  why: string;
  subject: string;
  todos: Partial<Todo>[];
  expect: { claimReason: ClaimReason; derivedStatus: string; isClaimable: boolean };
}
const cases = rawCases as unknown as { cases: ParityCase[] };

function mk(over: Partial<Todo> = {}): Todo {
  return {
    id: 'T', ownerSession: 's', assigneeSession: null, assigneeKind: 'agent',
    title: 't', description: null, status: 'planned', completed: false, priority: null,
    dueDate: null, parentId: null, dependsOn: [], order: 0, link: null,
    createdAt: '', updatedAt: '', completedAt: null, asanaGid: null, sessionName: null,
    executedBySession: null, blueprintId: null, type: null, kind: 'leaf', targetProject: null,
    acceptanceStatus: null, claimedBy: null, claimToken: null, claimedAt: null,
    claimLeaseMs: null, claim: null, approvedAt: null, approvedBy: null, heldAt: null,
    heldReason: null, retryCount: 0, completedBy: null, objectRef: null, servesCriterionId: null, servesCriterionIds: [], decisionRef: null,
    claimProbe: null, inheritedBlueprintFrom: null, inheritedFiles: [], isBucket: false, ...over,
  };
}
const APPROVED = '2026-06-17T00:00:00Z';
const CLAIM = { by: 'coordinator', token: 'tok', at: APPROVED, leaseMs: 1000 };
const map = (...todos: Todo[]) => new Map(todos.map((t) => [t.id, t]));

describe('isInboxEpicTitle — prefix match', () => {
  it('suffixed Inbox rows match by prefix', () => {
    expect(isInboxEpicTitle('Inbox — bar')).toBe(true);
  });

  it('bare exact title still matches (regression)', () => {
    expect(isInboxEpicTitle('Inbox')).toBe(true);
  });

  it('unrelated titles do not match', () => {
    expect(isInboxEpicTitle('Backlog')).toBe(false);
  });

  it('legacy prefixed literal is tolerated via stripLabel', () => {
    expect(isInboxEpicTitle('[EPIC] Inbox')).toBe(true);
  });
});

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
  it('deps-pending: a short (leading-8-hex) dep id resolves and unblocks once the dep is done', () => {
    const dep = mk({ id: 'depIdFull1234567890', status: 'in_progress' });
    const t = mk({ id: 'A', ...approved, dependsOn: ['depIdFul'] });
    expect(claimReason(t, map(dep, t))).toBe('deps-pending');
    const doneDep = mk({ id: 'depIdFull1234567890', status: 'done', acceptanceStatus: 'accepted' });
    expect(claimReason(t, map(doneDep, t))).toBe('claimable');
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

describe('Buckets = planning-only (bucket-planning gate)', () => {
  const inbox = mk({ id: 'IB', title: INBOX_EPIC_TITLE, parentId: null, kind: 'epic' });
  const realEpic = mk({ id: 'EP', title: '[EPIC] Real work', parentId: null, kind: 'epic', approvedAt: APPROVED });

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

  it("child of Inbox → 'bucket-planning' EVEN when approved + deps done (above unapproved)", () => {
    const child = mk({ id: 'C', parentId: 'IB', approvedAt: APPROVED });
    expect(claimReason(child, map(inbox))).toBe('bucket-planning');
    expect(isClaimable(child, map(inbox))).toBe(false);
    // with deps satisfied too — still gated
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    const child2 = mk({ id: 'C2', parentId: 'IB', approvedAt: APPROVED, dependsOn: ['D'] });
    expect(claimReason(child2, map(inbox, dep))).toBe('bucket-planning');
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

  it("released bucket child → 'bucket-planning', not 'parent-unreleased' (distinct-reason coexistence)", () => {
    // A released bucket (approvedAt set). The 'parent-unreleased' gate fires when
    // an epic ancestor has approvedAt == null; a released bucket has approvedAt set,
    // so hasUnreleasedEpicAncestor returns false. Yet the child must STILL be gated
    // by 'bucket-planning' (re-home reason, not release reason), proving the two are
    // distinct and both necessary.
    const releasedInbox = mk({ id: 'IB', title: INBOX_EPIC_TITLE, parentId: null, kind: 'epic', approvedAt: APPROVED });
    const child = mk({ id: 'C', parentId: 'IB', approvedAt: APPROVED });
    expect(claimReason(child, map(releasedInbox))).toBe('bucket-planning');
    expect(isClaimable(child, map(releasedInbox))).toBe(false);
  });

  it('generalized bucket gate: child of bucketType=inbox epic → bucket-planning', () => {
    // R3 generalization: a child of any bucket epic (bucketType != null) is blocked,
    // not just the legacy Inbox epic by title. This proves the gate works for
    // any bucket epic with an explicit bucketType field set.
    const bucketEpic = mk({ id: 'B', title: 'Inbox', parentId: null, kind: 'epic', bucketType: 'inbox', approvedAt: APPROVED });
    const child = mk({ id: 'C', parentId: 'B', approvedAt: APPROVED });
    expect(claimReason(child, map(bucketEpic))).toBe('bucket-planning');
    expect(isClaimable(child, map(bucketEpic))).toBe(false);
  });

  it('fail-closed bucket gate: child of legacy title-only Bugfix inbox → bucket-planning', () => {
    // R3 generalization: a child of a legacy title-only bucket epic (title matches
    // a fail-closed canonical title but bucketType is unset) is blocked. The
    // registryIsBucketEpic predicate includes this as a fallback for pre-R1 rows.
    const legacyBucket = mk({ id: 'BB', title: 'Bugfix inbox', parentId: null, kind: 'epic' });
    const child = mk({ id: 'C', parentId: 'BB', approvedAt: APPROVED });
    expect(claimReason(child, map(legacyBucket))).toBe('bucket-planning');
    expect(isClaimable(child, map(legacyBucket))).toBe(false);
  });

  it('child re-homed to a real epic → claimable when approved', () => {
    // Control: a child that is NOT under a bucket is claimable like any other leaf.
    // This proves that only bucket children are caught by the gate.
    const realEpic = mk({ id: 'E', title: 'Real Work', parentId: null, kind: 'epic', approvedAt: APPROVED });
    const child = mk({ id: 'C', parentId: 'E', approvedAt: APPROVED });
    expect(claimReason(child, map(realEpic))).toBe('claimable');
    expect(isClaimable(child, map(realEpic))).toBe(true);
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

describe('danglingDeps — surfacing helper (reuses resolveDepId semantics exactly)', () => {
  it('empty for a todo with no dependsOn', () => {
    const t = mk({ id: 'A', dependsOn: [] });
    expect(danglingDeps(t, map(t))).toEqual([]);
  });

  it('missing: a dep id that resolves to no todo at all', () => {
    const t = mk({ id: 'A', dependsOn: ['ghost'] });
    expect(danglingDeps(t, map(t))).toEqual([{ depId: 'ghost', ambiguous: false }]);
  });

  it('satisfied: a dep id that resolves to exactly one todo is NOT dangling', () => {
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    const t = mk({ id: 'A', dependsOn: ['D'] });
    expect(danglingDeps(t, map(dep, t))).toEqual([]);
  });

  it('short-id resolves: a leading-8-hex prefix that uniquely matches is NOT dangling', () => {
    const dep = mk({ id: 'depIdFull1234567890', status: 'in_progress' });
    const t = mk({ id: 'A', dependsOn: ['depIdFul'] });
    expect(danglingDeps(t, map(dep, t))).toEqual([]);
  });

  it('ambiguous: a short-id prefix matching 2+ todos is dangling and flagged ambiguous', () => {
    const dep1 = mk({ id: 'dupPrefix1111' });
    const dep2 = mk({ id: 'dupPrefix2222' });
    const t = mk({ id: 'A', dependsOn: ['dupPrefi'] });
    expect(danglingDeps(t, map(dep1, dep2, t))).toEqual([{ depId: 'dupPrefi', ambiguous: true }]);
  });

  it('mixed: reports each dangling dep, in order, and leaves resolvable deps out', () => {
    const dep = mk({ id: 'D', status: 'done', acceptanceStatus: 'accepted' });
    const dupA = mk({ id: 'dupXaaaa' });
    const dupB = mk({ id: 'dupXbbbb' });
    const t = mk({ id: 'A', dependsOn: ['D', 'missingOne', 'dupX'] });
    expect(danglingDeps(t, map(dep, dupA, dupB, t))).toEqual([
      { depId: 'missingOne', ambiguous: false },
      { depId: 'dupX', ambiguous: true },
    ]);
  });

  it('a dropped dep is NOT dangling (it resolves fine; dep-dropped is a distinct claimReason)', () => {
    const dep = mk({ id: 'D', status: 'dropped' });
    const t = mk({ id: 'A', dependsOn: ['D'] });
    expect(danglingDeps(t, map(dep, t))).toEqual([]);
  });
});

describe('parent-unreleased gate (EPIC 1052bacd)', () => {
  const approved = { approvedAt: APPROVED };

  it('case 1: leaf under unreleased epic → parent-unreleased, not claimable', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(epic, leaf))).toBe('parent-unreleased');
    expect(isClaimable(leaf, map(epic, leaf))).toBe(false);
  });

  it('case 2: release transition — only epic.approvedAt changes → leaf becomes claimable', () => {
    const unreleased = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: null });
    const released = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(unreleased, leaf))).toBe('parent-unreleased');
    expect(claimReason(leaf, map(released, leaf))).toBe('claimable');
  });

  it('case 3: positive control — split child under leaf-with-children parent is claimable', () => {
    // A split leaf (kind:'leaf') with children and approvedAt=null should NOT gate.
    // Only EPIC ancestors gate, never a leaf parent (82f1011a shape).
    const splitLeaf = mk({ id: 'SP', title: 'Split', kind: 'leaf', parentId: null, approvedAt: null });
    const child = mk({ id: 'C', parentId: 'SP', ...approved });
    expect(claimReason(child, map(splitLeaf, child))).toBe('claimable');
    expect(isClaimable(child, map(splitLeaf, child))).toBe(true);
  });

  it('case 4: grandchild under unreleased epic (chain walked) → parent-unreleased', () => {
    const topEpic = mk({ id: 'TOP', title: 'Top', kind: 'epic', parentId: null, approvedAt: null });
    const midLeaf = mk({ id: 'MID', parentId: 'TOP', ...approved });
    const grandchild = mk({ id: 'GC', parentId: 'MID', ...approved });
    expect(claimReason(grandchild, map(topEpic, midLeaf, grandchild))).toBe('parent-unreleased');
  });

  it('case 5: in-flight leaf under unreleased epic → in-flight wins (not revoked)', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved, claim: CLAIM });
    expect(claimReason(leaf, map(epic, leaf))).toBe('in-flight');
  });

  it('case 6: mission ancestor does NOT gate — leaf under epic under mission is claimable', () => {
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, approvedAt: null });
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: 'M', approvedAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(mission, epic, leaf))).toBe('claimable');
  });

  it('case 6b: leaf directly under mission (no epic) is claimable', () => {
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'M', ...approved });
    expect(claimReason(leaf, map(mission, leaf))).toBe('claimable');
  });

  it('hasUnreleasedEpicAncestor: true for unreleased epic parent', () => {
    const { hasUnreleasedEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasUnreleasedEpicAncestor(leaf, map(epic, leaf))).toBe(true);
  });

  it('hasUnreleasedEpicAncestor: false for released epic', () => {
    const { hasUnreleasedEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasUnreleasedEpicAncestor(leaf, map(epic, leaf))).toBe(false);
  });

  it('hasUnreleasedEpicAncestor: false for leaf-with-children parent', () => {
    const { hasUnreleasedEpicAncestor } = require('../claimability');
    const splitLeaf = mk({ id: 'SP', title: 'Split', kind: 'leaf', parentId: null, approvedAt: null });
    const child = mk({ id: 'C', parentId: 'SP' });
    expect(hasUnreleasedEpicAncestor(child, map(splitLeaf, child))).toBe(false);
  });

  it('hasUnreleasedEpicAncestor: false for mission parent', () => {
    const { hasUnreleasedEpicAncestor } = require('../claimability');
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'M' });
    expect(hasUnreleasedEpicAncestor(leaf, map(mission, leaf))).toBe(false);
  });

  it('hasUnreleasedEpicAncestor: terminates on self-referential parentId cycle', () => {
    const { hasUnreleasedEpicAncestor } = require('../claimability');
    const cycled = mk({ id: 'CYC', title: 'Cycled', kind: 'epic', parentId: 'CYC', approvedAt: null });
    const leaf = mk({ id: 'L', parentId: 'CYC' });
    expect(hasUnreleasedEpicAncestor(leaf, map(cycled, leaf))).toBe(true);
    // returns rather than hangs
  });
});

describe('parent-held gate', () => {
  const approved = { approvedAt: APPROVED };

  it('case 1: leaf under held epic → parent-held, not claimable', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(epic, leaf))).toBe('parent-held');
    expect(isClaimable(leaf, map(epic, leaf))).toBe(false);
  });

  it('case 2: hold transition — only epic.heldAt changes → leaf becomes claimable', () => {
    const held = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: APPROVED });
    const unheld = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: null });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(held, leaf))).toBe('parent-held');
    expect(claimReason(leaf, map(unheld, leaf))).toBe('claimable');
  });

  it('case 3: grandchild under held epic (chain walked) → parent-held', () => {
    const topEpic = mk({ id: 'TOP', title: 'Top', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: APPROVED });
    const midLeaf = mk({ id: 'MID', parentId: 'TOP', ...approved });
    const grandchild = mk({ id: 'GC', parentId: 'MID', ...approved });
    expect(claimReason(grandchild, map(topEpic, midLeaf, grandchild))).toBe('parent-held');
  });

  it('case 4: mission ancestor does NOT gate — leaf under epic under held mission is claimable', () => {
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, heldAt: APPROVED });
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: 'M', approvedAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(mission, epic, leaf))).toBe('claimable');
  });

  it('case 5: in-flight child under held epic → in-flight wins (not revoked)', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved, claim: CLAIM });
    expect(claimReason(leaf, map(epic, leaf))).toBe('in-flight');
  });

  it('hasHeldEpicAncestor: true for held epic parent', () => {
    const { hasHeldEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasHeldEpicAncestor(leaf, map(epic, leaf))).toBe(true);
  });

  it('hasHeldEpicAncestor: false for unheld epic', () => {
    const { hasHeldEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, heldAt: null });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasHeldEpicAncestor(leaf, map(epic, leaf))).toBe(false);
  });

  it('hasHeldEpicAncestor: false for leaf-with-children parent', () => {
    const { hasHeldEpicAncestor } = require('../claimability');
    const splitLeaf = mk({ id: 'SP', title: 'Split', kind: 'leaf', parentId: null, heldAt: APPROVED });
    const child = mk({ id: 'C', parentId: 'SP' });
    expect(hasHeldEpicAncestor(child, map(splitLeaf, child))).toBe(false);
  });

  it('hasHeldEpicAncestor: false for held mission parent', () => {
    const { hasHeldEpicAncestor } = require('../claimability');
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, heldAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'M' });
    expect(hasHeldEpicAncestor(leaf, map(mission, leaf))).toBe(false);
  });

  it('hasHeldEpicAncestor: terminates on self-referential parentId cycle on held epic', () => {
    const { hasHeldEpicAncestor } = require('../claimability');
    const cycled = mk({ id: 'CYC', title: 'Cycled', kind: 'epic', parentId: 'CYC', approvedAt: APPROVED, heldAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'CYC' });
    expect(hasHeldEpicAncestor(leaf, map(cycled, leaf))).toBe(true);
    // returns rather than hangs
  });
});

describe('parent-dropped gate', () => {
  const approved = { approvedAt: APPROVED };

  it('case 1: leaf under dropped epic → parent-dropped, not claimable', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'dropped' });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(epic, leaf))).toBe('parent-dropped');
    expect(isClaimable(leaf, map(epic, leaf))).toBe(false);
  });

  it('case 2: leaf under done epic → parent-dropped, not claimable', () => {
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'done' });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(epic, leaf))).toBe('parent-dropped');
    expect(isClaimable(leaf, map(epic, leaf))).toBe(false);
  });

  it('case 3: grandchild under dropped epic (chain walked) → parent-dropped', () => {
    const topEpic = mk({ id: 'TOP', title: 'Top', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'dropped' });
    const midLeaf = mk({ id: 'MID', parentId: 'TOP', ...approved });
    const grandchild = mk({ id: 'GC', parentId: 'MID', ...approved });
    expect(claimReason(grandchild, map(topEpic, midLeaf, grandchild))).toBe('parent-dropped');
  });

  it('case 4: mission ancestor does NOT gate — leaf under epic under dropped mission is claimable', () => {
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, status: 'dropped' });
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: 'M', approvedAt: APPROVED });
    const leaf = mk({ id: 'L', parentId: 'EP', ...approved });
    expect(claimReason(leaf, map(mission, epic, leaf))).toBe('claimable');
  });

  it('hasTerminalEpicAncestor: true for dropped epic parent', () => {
    const { hasTerminalEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'dropped' });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasTerminalEpicAncestor(leaf, map(epic, leaf))).toBe(true);
  });

  it('hasTerminalEpicAncestor: true for done epic parent', () => {
    const { hasTerminalEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'done' });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasTerminalEpicAncestor(leaf, map(epic, leaf))).toBe(true);
  });

  it('hasTerminalEpicAncestor: false for live epic parent', () => {
    const { hasTerminalEpicAncestor } = require('../claimability');
    const epic = mk({ id: 'EP', title: 'Epic', kind: 'epic', parentId: null, approvedAt: APPROVED, status: 'planned' });
    const leaf = mk({ id: 'L', parentId: 'EP' });
    expect(hasTerminalEpicAncestor(leaf, map(epic, leaf))).toBe(false);
  });

  it('hasTerminalEpicAncestor: false for dropped mission parent', () => {
    const { hasTerminalEpicAncestor } = require('../claimability');
    const mission = mk({ id: 'M', title: 'Mission', kind: 'mission', parentId: null, status: 'dropped' });
    const leaf = mk({ id: 'L', parentId: 'M' });
    expect(hasTerminalEpicAncestor(leaf, map(mission, leaf))).toBe(false);
  });
});
