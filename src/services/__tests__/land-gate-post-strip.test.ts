// [G16] GAP 0's closing test: the merge gate against a STRIPPED master.
//
// Epic 45e2fb60's migration removed the role prefix from every stored title (112 -> 0) and
// made `kind` authoritative. `land-authority.ts` decided bucket-ness by matching titles
// against bracketed literals like '[EPIC] Bugfix inbox'. Post-strip the row reads
// 'Bugfix inbox — ad-hoc bugs ...', so nothing matched and `isBucketEpic` returned false for
// every real bucket — a FAIL-OPEN guard on an irreversible merge: a conductor was authorized
// to merge a bucket ROOT to master.
//
// Every title below is the verbatim POST-STRIP title of a real row. These assertions FAIL
// against the pre-G16 predicate and pass after it. Neither parent branch's suite could have
// written this test: master had the stripped data, the epic branch had the gate.
import { describe, it, expect } from 'bun:test';
import type { Todo } from '../todo-store';
import type { TodoKind } from '../todo-kind';
import { isBucketEpic, checkOwnership, findOwningMission, type LandActor } from '../land-authority';
import { findViolations } from '../invariant-check';
import { mkTodo } from './fixtures/mk-todo';

const PROJECT = '/tmp/mc-post-strip-project';
const CONDUCTOR: LandActor = { kind: 'conductor', session: 'sess-A' };

// `kind` is required by mkTodo and has no default — a missing kind is a producer bug.
const todo = (over: Partial<Todo> & { id: string; title: string; kind: TodoKind }): Todo =>
  mkTodo({ status: 'ready', ownerSession: 'sess-A', ...over });

// The three real buckets, exactly as master stores them today.
const INBOX = todo({ id: 'bb4a9a5d', kind: 'epic', title: 'Inbox' });
const BUGFIX = todo({
  id: 'a41c8051',
  kind: 'epic',
  title: 'Bugfix inbox — ad-hoc bugs found while dogfooding; default bucket for stray bugfixes',
});
const COLLAB_GAPS = todo({ id: '95e9ba73', kind: 'epic', title: 'Collab gaps' });

// A real deliverable epic — the positive control.
const DELIVERABLE = todo({
  id: '028625a4',
  kind: 'epic',
  title: 'The verdict must be evidence — the executor computes it, the LLM only vetoes',
});

describe('[G16] bucket epics stay unlandable after the title strip (fail-CLOSED)', () => {
  it('isBucketEpic recognises all three real buckets by their POST-STRIP titles', () => {
    expect(isBucketEpic(INBOX)).toBe(true);
    expect(isBucketEpic(BUGFIX)).toBe(true);
    expect(isBucketEpic(COLLAB_GAPS)).toBe(true);
  });

  it('still recognises the LEGACY prefixed titles (a replayed frame, an old fixture)', () => {
    expect(isBucketEpic(todo({ id: 'x', kind: 'epic', title: '[EPIC] Inbox' }))).toBe(true);
    expect(isBucketEpic(todo({ id: 'y', kind: 'epic', title: '[EPIC] Bugfix inbox — with a suffix' }))).toBe(true);
  });

  it('POSITIVE CONTROL: a deliverable epic is NOT a bucket', () => {
    // A predicate that calls everything a bucket passes the regression test and blocks every land.
    expect(isBucketEpic(DELIVERABLE)).toBe(false);
  });

  it('case-insensitive, and prefix-matched: "inbox rendering bugs" refuses (accepted false positive)', () => {
    // G14's asymmetric trade, preserved through the strip: a deliverable epic wrongly refused
    // costs one escalation; a bucket wrongly landed is irreversible. Refuse by default.
    expect(isBucketEpic(todo({ id: 'p', kind: 'epic', title: '[epic] inbox' }))).toBe(true);
    expect(isBucketEpic(todo({ id: 'q', kind: 'epic', title: 'Inbox rendering bugs' }))).toBe(true);
  });

  it('a bucket is not an epic-by-title: kind decides, so a leaf named "Inbox" is not a bucket epic', () => {
    expect(isBucketEpic(todo({ id: 'z', kind: 'leaf', title: 'Inbox' }))).toBe(false);
  });

  it('checkOwnership REFUSES a conductor landing each bucket, with code bucket-epic', () => {
    for (const bucket of [INBOX, BUGFIX, COLLAB_GAPS]) {
      const v = checkOwnership(PROJECT, bucket.id, CONDUCTOR, [bucket]);
      expect(v.ok).toBe(false);
      expect(v.ownership).toBe('bucket');
      expect(v.blocker?.code).toBe('bucket-epic');
    }
  });

  it('land_epic IDENTIFIES an ordinary epic post-strip (not refused as "not an epic")', () => {
    const v = checkOwnership(PROJECT, DELIVERABLE.id, CONDUCTOR, [DELIVERABLE]);
    expect(v.blocker?.code).not.toBe('not-an-epic');
  });
});

describe('[G16] mission resolution and health checks read `kind`, not a prefix', () => {
  // mission -> epic -> leaf, with NO role prefix in any title.
  const MISSION = todo({
    id: 'a6eecd15',
    kind: 'mission',
    title: 'The work graph knows its own shape — node roles are declared, containers close safely',
  });
  const EPIC = todo({ id: 'e1', kind: 'epic', title: 'A deliverable epic', parentId: MISSION.id });
  const LEAF = todo({ id: 'c1', kind: 'leaf', title: 'build the thing', parentId: EPIC.id });
  const LAND = todo({ id: 'l1', kind: 'land', title: 'merge to master', parentId: EPIC.id, dependsOn: ['c1'] });

  it('findOwningMission resolves the mission from an epic with no prefix in any title', () => {
    const { mission } = findOwningMission([MISSION, EPIC, LEAF, LAND], EPIC.id);
    expect(mission?.id).toBe(MISSION.id);
  });

  it('invariant_check reports NO orphan for a mission root (a mission is a root by design)', () => {
    const violations = findViolations([MISSION, EPIC, LEAF, LAND]);
    const orphans = violations.filter((v) => v.kind === 'orphan');
    expect(orphans).toEqual([]);
  });

  it('a genuinely parentless non-mission todo is STILL an orphan', () => {
    const stray = todo({ id: 'stray', kind: 'leaf', title: 'floating work' });
    const orphans = findViolations([stray]).filter((v) => v.kind === 'orphan');
    expect(orphans.map((o) => o.todoId)).toEqual(['stray']);
  });
});
