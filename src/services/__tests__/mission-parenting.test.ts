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
    expect(resolveEpicParent({ kind: 'epic', title: 'Ship the thing' }, 'mission-1')).toBe('mission-1');
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

describe('resolveEpicParent — buckets stay roots, by identity not regex', () => {
  const bucketTitles = [INBOX_EPIC_TITLE, BUGFIX_INBOX_EPIC_TITLE];

  for (const title of bucketTitles) {
    for (const variant of [title, `[EPIC] ${title}`, title.toLowerCase()]) {
      it(`bucket title variant ${JSON.stringify(variant)} stays a root`, () => {
        expect(resolveEpicParent({ kind: 'epic', title: variant }, 'M1')).toBe(null);
        expect(isBucketEpic({ kind: 'epic', title: variant })).toBe(true);
        expect(isDeliverableEpic({ kind: 'epic', title: variant })).toBe(false);
      });
    }
  }

  it('lookalike titles that are not exact bucket identities are deliverables', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Inbox triage' }, 'M1')).toBe('M1');
    expect(resolveEpicParent({ kind: 'epic', title: 'Bugfix inbox rewrite' }, 'M1')).toBe('M1');
  });

  it('explicit missionId on a bucket title still wins', () => {
    expect(resolveEpicParent({ kind: 'epic', title: INBOX_EPIC_TITLE, missionId: 'M2' }, 'M1')).toBe('M2');
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
      resolveEpicParent({ kind: 'epic', title: '[MISSION] deliverable, column wins' }, 'M1'),
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
    const epic = { kind: 'epic' as const, title: 'E', parentId: null };

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
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Inbox' })).toBe('bucket-epic');
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Inbox', parentId: 'M1' })).toBe('bucket-epic');
  });

  it('an already-parented deliverable epic skips', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E', parentId: 'M1' })).toBe('already-parented');
  });

  it('a rootless deliverable epic is eligible to move (null)', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E', parentId: null })).toBe(null);
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'E' })).toBe(null);
  });
});
