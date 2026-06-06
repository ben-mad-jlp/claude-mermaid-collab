import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeCoverage, decideRequirement } from '../spec-coverage';
import type { SystemObject } from '../domain-plugin';
import type { Todo } from '../todo-store';
import {
  createDecisionRecord, getDecisionRecord, listDecisionRecords, _closeProject,
} from '../decision-record-store';

function obj(id: string): SystemObject {
  return { id, typeId: 'T', typeVersion: 1, parentObjectId: null, qty: 1, name: id, attributes: {}, currentRevisionId: null };
}
function todo(id: string, objectRef: string | null, status: string): Todo {
  return { id, objectRef, status } as unknown as Todo;
}

describe('computeCoverage (Todo.objectRef join)', () => {
  it('classifies covered / partial / uncovered and rolls up', () => {
    const objects = [obj('o1'), obj('o2'), obj('o3')];
    const todos = [
      todo('t1', 'o1', 'done'),    // o1 → covered
      todo('t2', 'o1', 'todo'),    // (still covered: a done todo exists)
      todo('t3', 'o2', 'todo'),    // o2 → partial
      todo('t4', null, 'done'),    // unlinked → ignored
    ];
    const c = computeCoverage(objects, todos);
    expect(c.total).toBe(3);
    expect(c.covered).toBe(1);
    expect(c.partial).toBe(1);
    expect(c.uncovered).toBe(1);
    const o1 = c.byObject.find((x) => x.objectId === 'o1')!;
    expect(o1.state).toBe('covered');
    expect(o1.todoCount).toBe(2);
    expect(o1.doneCount).toBe(1);
    expect(c.byObject.find((x) => x.objectId === 'o2')!.state).toBe('partial');
    expect(c.byObject.find((x) => x.objectId === 'o3')!.state).toBe('uncovered');
  });

  it('empty inputs → all-zero rollup', () => {
    expect(computeCoverage([], [])).toEqual({ total: 0, covered: 0, partial: 0, uncovered: 0, stale: 0, byObject: [] });
  });

  it('threads the stale (drift) signal: flagged objects get stale=true + a rollup count', () => {
    const objects = [obj('o1'), obj('o2'), obj('o3')];
    const todos = [todo('t1', 'o1', 'done')]; // o1 covered-by-todo
    const c = computeCoverage(objects, todos, ['o1', 'o3']);
    expect(c.stale).toBe(2);
    // o1 is covered-by-todo AND stale (drift is independent of todo coverage).
    expect(c.byObject.find((x) => x.objectId === 'o1')!).toMatchObject({ state: 'covered', stale: true });
    expect(c.byObject.find((x) => x.objectId === 'o2')!.stale).toBe(false);
    expect(c.byObject.find((x) => x.objectId === 'o3')!.stale).toBe(true);
  });

  it('defaults stale=false when no staleIds are passed', () => {
    const c = computeCoverage([obj('o1')], []);
    expect(c.stale).toBe(0);
    expect(c.byObject[0].stale).toBe(false);
  });
});

describe('decideRequirement (approve / reject / edit re-sign)', () => {
  let project: string;
  beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'spec-cov-')); });
  afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

  it('approve → active', () => {
    const r = createDecisionRecord(project, { kind: 'requirement', title: 'latency', spec: { metric: 'p95', op: '<=', target: 200 } });
    expect(r.status).toBe('proposed');
    const res = decideRequirement(project, { id: r.id, decision: 'approve', approvedBy: 'ben' });
    expect(res.record?.status).toBe('active');
    expect(res.record?.approvedBy).toBe('ben');
  });

  it('reject → superseded with a non-null marker (no live replacement)', () => {
    const r = createDecisionRecord(project, { kind: 'requirement', title: 'rps', spec: { metric: 'rps', op: '>=', target: 500 } });
    const res = decideRequirement(project, { id: r.id, decision: 'reject' });
    expect(res.record?.status).toBe('superseded');
    expect(res.record?.supersededBy).toBe(`rejected:${r.id}`);
  });

  it('edit → fresh proposed replacement supersedes the old (re-sign DIFF)', () => {
    const old = createDecisionRecord(project, { kind: 'requirement', title: 'latency', spec: { metric: 'p95', op: '<=', target: 200 } });
    const res = decideRequirement(project, { id: old.id, decision: 'edit', spec: { metric: 'p95', op: '<=', target: 150 } });
    // new record carries the edited spec and re-enters proposed
    expect(res.record?.status).toBe('proposed');
    expect(res.record?.spec).toEqual({ metric: 'p95', op: '<=', target: 150 });
    expect(res.record?.id).not.toBe(old.id);
    // old record is superseded by the new one
    expect(res.superseded?.status).toBe('superseded');
    expect(res.superseded?.supersededBy).toBe(res.record?.id);
    // and the persisted old record agrees
    expect(getDecisionRecord(project, old.id)!.status).toBe('superseded');
  });

  it('edit without a spec throws', () => {
    const r = createDecisionRecord(project, { kind: 'requirement', title: 'x', spec: { metric: 'm', op: '<', target: 1 } });
    expect(() => decideRequirement(project, { id: r.id, decision: 'edit' })).toThrow();
  });

  it('a rejected requirement no longer appears as active', () => {
    const r = createDecisionRecord(project, { kind: 'requirement', title: 'q', spec: { metric: 'm', op: '<', target: 1 } });
    decideRequirement(project, { id: r.id, decision: 'reject' });
    const active = listDecisionRecords(project, { kind: 'requirement', status: 'active' });
    expect(active.find((x) => x.id === r.id)).toBeUndefined();
  });
});
