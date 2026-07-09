/**
 * Unit tests for mission-parenting.ts — the §4d parenting decision. Pure; no DB.
 */
import { describe, it, expect } from 'bun:test';
import {
  resolveEpicParent,
  isBucketEpic,
  isDeliverableEpic,
  epicBackfillSkipReason,
  MISSION_PARENTING_FIXTURE,
} from '../mission-parenting';
import { MissingKindError } from '../todo-kind';

describe('resolveEpicParent — fixture table', () => {
  for (const { input, activeMissionId, expect: expected } of MISSION_PARENTING_FIXTURE) {
    it(`${JSON.stringify(input)} + active=${activeMissionId} -> ${expected}`, () => {
      expect(resolveEpicParent(input, activeMissionId)).toBe(expected);
    });
  }
});

describe('resolveEpicParent — explicit cases', () => {
  it('missions are always roots', () => {
    expect(resolveEpicParent({ kind: 'mission' }, 'M1')).toBeNull();
  });

  it('deliverable epic with no missionId homes to the active mission', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Deliverable' }, 'M1')).toBe('M1');
    expect(resolveEpicParent({ kind: 'epic', title: 'Deliverable' }, null)).toBeNull();
  });

  it('missionId: null is an explicit opt-out even with an active mission', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Deliverable', missionId: null }, 'M1')).toBeNull();
  });

  it('explicit missionId WINS over the bucket check (precedence per todo-store.ts:817-818)', () => {
    expect(resolveEpicParent({ kind: 'epic', title: 'Inbox', missionId: 'M2' }, 'M1')).toBe('M2');
  });

  it('throws on a leaf/land input (caller bug)', () => {
    expect(() => resolveEpicParent({ kind: 'leaf' }, null)).toThrow();
    expect(() => resolveEpicParent({ kind: 'land' }, null)).toThrow();
  });
});

describe('bucket epic identity', () => {
  const titles = ['Inbox', 'Bugfix inbox', '[EPIC] Inbox', 'inbox', 'INBOX'];
  for (const title of titles) {
    it(`"${title}" is a bucket epic, not a deliverable`, () => {
      const t = { kind: 'epic' as const, title };
      expect(isBucketEpic(t)).toBe(true);
      expect(isDeliverableEpic(t)).toBe(false);
      expect(resolveEpicParent(t, 'M1')).toBeNull();
    });
  }

  it('"[MISSION] Foo" titled kind:epic is deliverable — column wins over prefix', () => {
    const t = { kind: 'epic' as const, title: '[MISSION] deliverable, column wins' };
    expect(isDeliverableEpic(t)).toBe(true);
    expect(isBucketEpic(t)).toBe(false);
  });

  it('isBucketEpic throws MissingKindError on a kind-less payload', () => {
    expect(() => isBucketEpic({ title: 'Inbox' })).toThrow(MissingKindError);
  });
});

describe('epicBackfillSkipReason', () => {
  it('leaf -> not-an-epic', () => {
    expect(epicBackfillSkipReason({ kind: 'leaf', title: 'x' })).toBe('not-an-epic');
  });

  it('bucket epic -> bucket-epic', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Inbox' })).toBe('bucket-epic');
  });

  it('epic with parentId set -> already-parented', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Deliverable', parentId: 'M1' })).toBe(
      'already-parented',
    );
  });

  it('root deliverable epic -> null (move it)', () => {
    expect(epicBackfillSkipReason({ kind: 'epic', title: 'Deliverable', parentId: null })).toBeNull();
  });
});
