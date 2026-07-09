import { describe, test, expect } from 'bun:test';
import { findClaimInvariantViolations } from '../invariant-check';
import type { Todo, ClaimStruct } from '../todo-store';

/**
 * S6 — the sweep-as-net invariant ASSERT pass (epic b2c858d4). Pure-function tests over
 * hand-built Todo[]: the pass must SURFACE structural violations and (proven elsewhere by
 * wiring) ALARM — it must NEVER repair, and it must find NOTHING in a steady-state graph.
 */

const CLAIM: ClaimStruct = { by: 'w', token: 'tok', at: new Date().toISOString(), leaseMs: 60_000 };

function todo(over: Partial<Todo>): Todo {
  return {
    id: 'id',
    ownerSession: 's1',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 't',
    description: null,
    status: 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
    ...over,
  } as Todo;
}

describe('S6 invariant assert pass (findClaimInvariantViolations)', () => {
  test('steady-state graph: no violations', () => {
    const graph = [
      todo({ id: 'a', status: 'done', acceptanceStatus: 'accepted', claim: null }),
      todo({ id: 'b', status: 'planned', approvedAt: 'x', claim: CLAIM }), // in-flight, non-terminal — OK
      todo({ id: 'c', status: 'planned', heldAt: 'x', claim: null }), // held, no claim — OK
    ];
    expect(findClaimInvariantViolations(graph)).toEqual([]);
  });

  test('terminal-with-claim: a done row holding a live claim alarms (both directions)', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'x', status: 'done', acceptanceStatus: 'accepted', claim: CLAIM }),
    ]);
    const kinds = v.map((e) => e.kind).sort();
    expect(kinds).toContain('terminal-with-claim');
    expect(kinds).toContain('claim-implies-in-flight');
    expect(v.every((e) => e.todoId === 'x')).toBe(true);
  });

  test('dropped row holding a claim also alarms', () => {
    const v = findClaimInvariantViolations([todo({ id: 'd', status: 'dropped', claim: CLAIM })]);
    expect(v.map((e) => e.kind)).toContain('terminal-with-claim');
  });

  test('held-with-claim: a held row holding a live claim alarms', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'h', status: 'planned', heldAt: 'x', heldReason: 'manual', claim: CLAIM }),
    ]);
    expect(v.map((e) => e.kind)).toContain('held-with-claim');
  });

  test('epic-rollup-missed: non-terminal epic with all children done+accepted alarms', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'epic', status: 'in_progress' }),
      todo({ id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
      todo({ id: 'c2', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
    ]);
    expect(v.map((e) => e.kind)).toContain('epic-rollup-missed');
    expect(v.find((e) => e.kind === 'epic-rollup-missed')!.todoId).toBe('epic');
  });

  test('epic with a still-open child does NOT alarm rollup', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'epic', status: 'in_progress' }),
      todo({ id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
      todo({ id: 'c2', parentId: 'epic', status: 'planned', approvedAt: 'x' }),
    ]);
    expect(v.map((e) => e.kind)).not.toContain('epic-rollup-missed');
  });

  test('epic with a done-but-unaccepted child does NOT alarm rollup (left for gating)', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'epic', status: 'in_progress' }),
      todo({ id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
      todo({ id: 'c2', parentId: 'epic', status: 'done', acceptanceStatus: 'pending' }),
    ]);
    expect(v.map((e) => e.kind)).not.toContain('epic-rollup-missed');
  });

  test('dropped children are ignored; an all-(done+accepted)-else-dropped epic alarms', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'epic', status: 'in_progress' }),
      todo({ id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
      todo({ id: 'c2', parentId: 'epic', status: 'dropped' }),
    ]);
    expect(v.map((e) => e.kind)).toContain('epic-rollup-missed');
  });

  test('terminal epic already rolled up: no rollup alarm', () => {
    const v = findClaimInvariantViolations([
      todo({ id: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
      todo({ id: 'c1', parentId: 'epic', status: 'done', acceptanceStatus: 'accepted' }),
    ]);
    expect(v).toEqual([]);
  });
});
