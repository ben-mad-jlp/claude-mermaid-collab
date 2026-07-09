import { describe, test, expect } from 'bun:test';
import { findClaimInvariantViolations } from '../invariant-check';
import type { Todo, ClaimStruct } from '../todo-store';
import { mkTodo } from './fixtures/mk-todo';

/**
 * S6 — the sweep-as-net invariant ASSERT pass (epic b2c858d4). Pure-function tests over
 * hand-built Todo[]: the pass must SURFACE structural violations and (proven elsewhere by
 * wiring) ALARM — it must NEVER repair, and it must find NOTHING in a steady-state graph.
 */

const CLAIM: ClaimStruct = { by: 'w', token: 'tok', at: new Date().toISOString(), leaseMs: 60_000 };

describe('S6 invariant assert pass (findClaimInvariantViolations)', () => {
  test('steady-state graph: no violations', () => {
    const graph = [
      mkTodo({ ownerSession: 's1', title: 't', id: 'a', status: 'done', acceptanceStatus: 'accepted', claim: null, kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'b', status: 'planned', approvedAt: 'x', claim: CLAIM, kind: 'leaf' }), // in-flight, non-terminal — OK
      mkTodo({ ownerSession: 's1', title: 't', id: 'c', status: 'planned', heldAt: 'x', claim: null, kind: 'leaf' }), // held, no claim — OK
    ];
    expect(findClaimInvariantViolations(graph)).toEqual([]);
  });

  test('terminal-with-claim: a done row holding a live claim alarms (both directions)', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'x', status: 'done', acceptanceStatus: 'accepted', claim: CLAIM, kind: 'leaf' }),
    ]);
    const kinds = v.map((e) => e.kind).sort();
    expect(kinds).toContain('terminal-with-claim');
    expect(kinds).toContain('claim-implies-in-flight');
    expect(v.every((e) => e.todoId === 'x')).toBe(true);
  });

  test('dropped row holding a claim also alarms', () => {
    const v = findClaimInvariantViolations([mkTodo({ ownerSession: 's1', title: 't', id: 'd', status: 'dropped', claim: CLAIM, kind: 'leaf' })]);
    expect(v.map((e) => e.kind)).toContain('terminal-with-claim');
  });

  test('held-with-claim: a held row holding a live claim alarms', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'h', status: 'planned', heldAt: 'x', heldReason: 'manual', claim: CLAIM, kind: 'leaf' }),
    ]);
    expect(v.map((e) => e.kind)).toContain('held-with-claim');
  });

  test('epic-rollup-missed: non-terminal epic with all children done+accepted alarms', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'epic', status: 'in_progress', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
    ]);
    expect(v.map((e) => e.kind)).toContain('epic-rollup-missed');
    expect(v.find((e) => e.kind === 'epic-rollup-missed')!.todoId).toBe('epic');
  });

  test('epic with a still-open child does NOT alarm rollup', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'epic', status: 'in_progress', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'epic', status: 'planned', approvedAt: 'x', kind: 'leaf' }),
    ]);
    expect(v.map((e) => e.kind)).not.toContain('epic-rollup-missed');
  });

  test('epic with a done-but-unaccepted child does NOT alarm rollup (left for gating)', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'epic', status: 'in_progress', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'epic', status: 'done', acceptanceStatus: 'pending', kind: 'leaf' }),
    ]);
    expect(v.map((e) => e.kind)).not.toContain('epic-rollup-missed');
  });

  test('dropped children are ignored; an all-(done+accepted)-else-dropped epic alarms', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'epic', status: 'in_progress', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'epic', status: 'dropped', kind: 'leaf' }),
    ]);
    expect(v.map((e) => e.kind)).toContain('epic-rollup-missed');
  });

  test('terminal epic already rolled up: no rollup alarm', () => {
    const v = findClaimInvariantViolations([
      mkTodo({ ownerSession: 's1', title: 't', id: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
    ]);
    expect(v).toEqual([]);
  });

  test('a mission never surfaces as epic-rollup-missed, even with all children done+accepted', () => {
    const graph = [
      mkTodo({ ownerSession: 's1', title: 't', id: 'm1', kind: 'mission', status: 'in_progress' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'm1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'm1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
    ];
    expect(findClaimInvariantViolations(graph)).toEqual([]);

    // Flip `kind` to 'epic' on the same graph → exactly one epic-rollup-missed.
    const epicGraph = [
      mkTodo({ ownerSession: 's1', title: 't', id: 'm1', kind: 'epic', status: 'in_progress' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c1', parentId: 'm1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
      mkTodo({ ownerSession: 's1', title: 't', id: 'c2', parentId: 'm1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' }),
    ];
    const v = findClaimInvariantViolations(epicGraph);
    expect(v.filter((e) => e.kind === 'epic-rollup-missed')).toHaveLength(1);
    expect(v.find((e) => e.kind === 'epic-rollup-missed')!.todoId).toBe('m1');
  });
});
