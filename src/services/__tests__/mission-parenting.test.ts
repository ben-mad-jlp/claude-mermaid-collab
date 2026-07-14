/**
 * Unit tests for mission-parenting.ts (§4d) — pure, no DB. Exercises the
 * resolveEpicParent precedence ladder via its fixture table, the bucket-epic
 * identity check, the kind-not-title role discrimination, the
 * parentId===null-no-longer-implies-epic invariant, and the
 * epicBackfillSkipReason ladder.
 */
import { describe, it, expect } from 'bun:test';
import {
  BUGFIX_INBOX_EPIC_TITLE,
  isBucketEpic,
  isBucketEpicTitle,
  isDeliverableEpic,
  missionParentId,
  resolveEpicParent,
  epicBackfillSkipReason,
  isMissionTarget,
  MISSION_PARENTING_FIXTURE,
} from '../mission-parenting';
import { INBOX_EPIC_TITLE } from '../claimability';
import { kindOf, isMission, isEpic, MissingKindError } from '../todo-kind';

describe('resolveEpicParent — fixture table', () => {
  for (const row of MISSION_PARENTING_FIXTURE) {
    it(`kind=${row.input.kind} title=${JSON.stringify(row.input.title)} missionId=${JSON.stringify(
      row.input.missionId,
    )} activeMissionId=${JSON.stringify(row.activeMissionId)} -> ${JSON.stringify(row.expect)}`, () => {
      expect(resolveEpicParent(row.input, row.activeMissionId)).toBe(row.expect);
    });
  }
});

describe('resolveEpicParent — deliverable epic gets the mission todoId', () => {
  it('homes to the active mission', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Ship the thing', isBucket: false }, 'mission-1')).toBe('mission-1');
  });
});

describe('resolveEpicParent — mission stays a root', () => {
  it('a mission input resolves to null regardless of activeMissionId', () => {
    expect(resolveEpicParent({ kind: 'mission', title: 'Converge' }, 'M1')).toBe(null);
  });
  it('missionParentId() is always null', () => {
    expect(missionParentId()).toBe(null);
  });
});

describe('resolveEpicParent — buckets stay roots, by isBucket column not regex', () => {
  it('bucket with isBucket=true stays a root', () => {
    expect(resolveEpicParent({ kind: 'epic', title: INBOX_EPIC_TITLE, isBucket: true }, 'M1')).toBe(null);
    expect(isBucketEpic({ kind: 'epic', title: INBOX_EPIC_TITLE, isBucket: true })).toBe(true);
    expect(isDeliverableEpic({ kind: 'epic', title: INBOX_EPIC_TITLE, isBucket: true })).toBe(false);
  });

  it('epic with isBucket=false is a deliverable even with bucket-looking title', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Inbox triage', isBucket: false }, 'M1')).toBe('M1');
    expect(isBucketEpic({ kind: 'epic', title: 'Inbox triage', isBucket: false })).toBe(false);
    expect(isDeliverableEpic({ kind: 'epic', title: 'Inbox triage', isBucket: false })).toBe(true);
  });

  it('explicit missionId on a bucket still wins', () => {
    expect(resolveEpicParent({ kind: 'epic', title: INBOX_EPIC_TITLE, isBucket: true, missionId: 'M2' }, 'M1')).toBe('M2');
  });
});

describe('resolveEpicParent — role comes from kind, never a title', () => {
  it('a leaf with an epic-looking title is not an epic, and resolveEpicParent throws', () => {
    const leaf = { kind: 'leaf' as const, title: '[EPIC] looks like an epic' };
    expect(isEpic(leaf)).toBe(false);
    expect(kindOf(leaf)).toBe('leaf');
    expect(() => resolveEpicParent(leaf, 'M1')).toThrow(/expected an epic or mission/);
  });

  it('an epic with a mission-looking title still parents to the mission', () => {
    expect(
      resolveEpicParent({ kind: 'epic', title: '[MISSION] deliverable, column wins', isBucket: false }, 'M1'),
    ).toBe('M1');
  });

  it('a payload with no kind throws MissingKindError from kindOf, and resolveEpicParent throws too', () => {
    const noKind = { title: '[EPIC] no kind' };
    expect(() => kindOf(noKind)).toThrow(MissingKindError);
    expect(() => resolveEpicParent(noKind as any, 'M1')).toThrow();
  });
});

describe('resolveEpicParent — parentId===null no longer implies "epic"', () => {
  it('mission and epic are discriminated only by kind, not by parentId', () => {
    const mission = { kind: 'mission' as const, title: 'M', parentId: null };
    const epic = { kind: 'epic' as const, title: 'E', parentId: null, isBucket: false };

    expect(mission.parentId).toBe(null);
    expect(epic.parentId).toBe(null);

    expect(isMission(mission)).toBe(true);
    expect(isMission(epic)).toBe(false);
    expect(isEpic(epic)).toBe(true);
    expect(isEpic(mission)).toBe(false);

    expect(isMissionTarget(mission)).toBe(true);
    expect(isMissionTarget(epic)).toBe(false);
    expect(isMissionTarget(null)).toBe(false);
  });
});

describe('epicBackfillSkipReason — ladder', () => {
  it('a non-epic is not-an-epic', () => {
    expect(epicBackfillSkipReason({ kind: 'leaf', title: 'x' })).toBe('not-an-epic');
    expect(epicBackfillSkipReason({ kind: 'mission', title: 'M' })).toBe('not-an-epic');
  });

  it('bucket epics skip regardless of parentId (bucket beats already-parented)', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Inbox', isBucket: true })).toBe('bucket-epic');
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Inbox', isBucket: true, parentId: 'M1' })).toBe('bucket-epic');
  });

  it('an already-parented deliverable epic skips', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E', isBucket: false, parentId: 'M1' })).toBe('already-parented');
  });

  it('a rootless deliverable epic is eligible to move (null)', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E', isBucket: false, parentId: null })).toBe(null);
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E', isBucket: false })).toBe(null);
  });
});

describe('isBucketEpicTitle — prefix match', () => {
  it('suffixed bucket rows match by prefix', () => {
    expect(isBucketEpicTitle('Bugfix inbox — foo')).toBe(true);
    expect(isBucketEpicTitle('Inbox — bar')).toBe(true);
  });

  it('bare exact titles still match (regression)', () => {
    expect(isBucketEpicTitle('Inbox')).toBe(true);
    expect(isBucketEpicTitle('Bugfix inbox')).toBe(true);
  });

  it('unrelated titles do not match', () => {
    expect(isBucketEpicTitle('Shipping epic')).toBe(false);
  });

  it('legacy prefixed literal is tolerated via stripLabel', () => {
    expect(isBucketEpicTitle('[EPIC] Inbox — x')).toBe(true);
  });
});
