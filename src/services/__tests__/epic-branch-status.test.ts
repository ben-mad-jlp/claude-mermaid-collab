// Pure assembly tests for src/services/epic-branch-status.ts — the git probe is
// injected, so these are hermetic (no real repo, no git spawn). They exercise the
// branch-name derivation, ahead/behind/mergeable mapping, land-leaf join, and the
// BP0 `stranded` flag (done-on-graph, unlanded-on-master).
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import {
  buildEpicBranchStatus,
  epicBranchName,
  epicId8,
  pickBaseRef,
  type BranchProbe,
  type GitProbe,
} from '../epic-branch-status';
import { mkTodo } from './fixtures/mk-todo';

let seq = 0;
function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus; kind: string }): Todo {
  const status = partial.status ?? 'ready';
  return mkTodo({
    ...partial,
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
    kind: partial.kind as any,
  });
}

/** A probe driven by a branch→facts table; unknown branches read as nonexistent. */
function probeFrom(table: Record<string, BranchProbe>): GitProbe {
  return (branch: string) =>
    table[branch] ?? { exists: false, ahead: null, behind: null, mergeable: null };
}

describe('branch-name derivation', () => {
  test('epicId8 takes the 8-char prefix of a UUID and preserves the inbox sentinel', () => {
    expect(epicId8('c51efd9a-2f1c-422e-ae58-d169ebd897cb')).toBe('c51efd9a');
    expect(epicId8('inbox')).toBe('inbox');
    expect(epicBranchName('c51efd9a-2f1c-422e')).toBe('collab/epic/c51efd9a');
  });
});

describe('buildEpicBranchStatus', () => {
  test('only [EPIC] todos appear; non-epics are ignored', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] feature', status: 'todo', kind: 'epic' });
    const work = todo({ id: 'w1', title: 'do thing', parentId: 'e1', kind: 'leaf' });
    const report = buildEpicBranchStatus([epic, work], probeFrom({}));
    expect(report.epics).toHaveLength(1);
    expect(report.epics[0].epicId).toBe('e1');
  });

  test('stranded: branch ahead>0 with land leaf not done is flagged', () => {
    const epic = todo({ id: 'abcd1234-0000', title: '[EPIC] strand me', status: 'done', kind: 'epic' });
    const land = todo({
      id: 'l1',
      title: '[LAND] strand me → master',
      parentId: 'abcd1234-0000',
      status: 'ready',
      kind: 'land',
    });
    const branch = epicBranchName('abcd1234-0000');
    const report = buildEpicBranchStatus(
      [epic, land],
      probeFrom({ [branch]: { exists: true, ahead: 3, behind: 0, mergeable: true } }),
    );
    const e = report.epics[0];
    expect(e.ahead).toBe(3);
    expect(e.landLeafDone).toBe(false);
    expect(e.stranded).toBe(true);
    expect(report.strandedCount).toBe(1);
  });

  test('landed epic: ahead/behind 0 and land leaf done is NOT stranded', () => {
    const epic = todo({ id: 'beef0001-0000', title: '[EPIC] landed', status: 'done', kind: 'epic' });
    const land = todo({
      id: 'l2',
      title: '[LAND] landed → master',
      parentId: 'beef0001-0000',
      status: 'done',
      kind: 'land',
    });
    const branch = epicBranchName('beef0001-0000');
    const report = buildEpicBranchStatus(
      [epic, land],
      probeFrom({ [branch]: { exists: true, ahead: 0, behind: 0, mergeable: true } }),
    );
    const e = report.epics[0];
    expect(e.ahead).toBe(0);
    expect(e.landLeafDone).toBe(true);
    expect(e.stranded).toBe(false);
    expect(report.strandedCount).toBe(0);
  });

  test('no branch yet: exists false, counts null, not stranded', () => {
    const epic = todo({ id: 'e3', title: '[EPIC] fresh', status: 'planned', kind: 'epic' });
    const report = buildEpicBranchStatus([epic], probeFrom({}));
    const e = report.epics[0];
    expect(e.exists).toBe(false);
    expect(e.ahead).toBeNull();
    expect(e.landLeafDone).toBeNull(); // no land leaf
    expect(e.stranded).toBe(false);
  });

  test('finds a [LAND] leaf nested below an intermediate child (transitive descendant)', () => {
    const epic = todo({ id: 'e4', title: '[EPIC] deep', status: 'todo', kind: 'epic' });
    const mid = todo({ id: 'm1', title: 'sub-area', parentId: 'e4', kind: 'leaf' });
    const land = todo({ id: 'l4', title: '[LAND] deep → master', parentId: 'm1', status: 'done', kind: 'land' });
    const branch = epicBranchName('e4');
    const report = buildEpicBranchStatus(
      [epic, mid, land],
      probeFrom({ [branch]: { exists: true, ahead: 1, behind: 2, mergeable: false } }),
    );
    const e = report.epics[0];
    expect(e.landLeafDone).toBe(true);
    expect(e.behind).toBe(2);
    expect(e.mergeable).toBe(false);
    expect(e.stranded).toBe(false); // land leaf done ⇒ not stranded even with ahead>0
  });

  test('lists a mission-parented epic by kind, with no title prefix', () => {
    const mission = todo({ id: 'm0', title: 'Converge on X', kind: 'mission' });
    const epic = todo({ id: '45e2fb60-0000', title: 'unprefixed epic', kind: 'epic', parentId: 'm0', status: 'todo' });
    const land = todo({ id: 'l0', title: 'land it', kind: 'land', parentId: '45e2fb60-0000', status: 'todo' });
    const probe: GitProbe = () => ({ exists: true, ahead: 5, behind: 0, mergeable: true });
    const r = buildEpicBranchStatus([mission, epic, land], probe);

    expect(r.epics.map((e) => e.epicId)).toEqual(['45e2fb60-0000']); // the mission is NOT an epic
    expect(r.epics[0].branch).toBe('collab/epic/45e2fb60');
    expect(r.epics[0].ahead).toBe(5);
    expect(r.epics[0].mergeable).toBe(true);
    expect(r.epics[0].landLeafDone).toBe(false);
    expect(r.strandedCount).toBe(1);
  });
});

describe('pickBaseRef — main vs master auto-detect', () => {
  const has = (...refs: string[]) => (r: string) => refs.includes(r);

  test('uses the requested ref when it exists', () => {
    expect(pickBaseRef('master', has('master', 'main'), () => null)).toBe('master');
  });

  test('a main-default repo (no master) falls back to main', () => {
    expect(pickBaseRef('master', has('main'), () => null)).toBe('main');
  });

  test('falls back to origin/HEAD when neither main nor master is a local branch', () => {
    expect(pickBaseRef('master', has(), () => 'develop')).toBe('develop');
  });

  test('gives up to the requested ref when nothing resolves (probes go null, as before)', () => {
    expect(pickBaseRef('master', has(), () => null)).toBe('master');
  });

  test('respects an explicit non-default ref that exists', () => {
    expect(pickBaseRef('release/2', has('release/2', 'main'), () => null)).toBe('release/2');
  });
})
