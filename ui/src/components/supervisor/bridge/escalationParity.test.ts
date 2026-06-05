/**
 * Bridge P1 load-bearing invariant:
 *
 *     selectOpenEscalations(...).length > 0  ⟺  ≥1 FleetGraph node has data.danger
 *
 * The CommandBarBadge count and the graph's danger ring both derive from the
 * same open-escalation set, so this proves the badge can never show "needs you"
 * while the graph shows no danger node (and vice-versa) for the standard case
 * where each open escalation belongs to a worker that holds a todo.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetGraph } from './fleet/useFleetGraph';
import { selectOpenEscalations } from './escalationSelectors';
import type { SessionTodo } from '@/types/sessionTodo';
import type { Escalation } from '@/stores/supervisorStore';

function todo(p: Partial<SessionTodo>): SessionTodo {
  return {
    id: '',
    ownerSession: '',
    assigneeSession: null,
    title: p.id ?? '',
    description: null,
    status: 'in_progress',
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
    ...p,
  } as SessionTodo;
}

function esc(p: Partial<Escalation>): Escalation {
  return {
    id: p.id ?? 'e1',
    project: 'P',
    session: 'worker-1',
    kind: 'decision',
    questionText: 'pick one',
    status: 'open',
    createdAt: 1,
    ...p,
  } as Escalation;
}

/** Run the selector + graph derivation and report the two sides of the invariant. */
function parity(todos: SessionTodo[], escalations: Escalation[], project: string) {
  const open = selectOpenEscalations(escalations, project);
  const { result } = renderHook(() =>
    useFleetGraph({ todos, subs: [], openEscalations: open, expandedEpics: new Set(), now: 0 }),
  );
  const dangerNodes = result.current.nodes.filter((n) => (n.data as { danger?: boolean }).danger === true);
  return { needsYou: open.length, dangerCount: dangerNodes.length };
}

describe('badge ⟺ ring parity', () => {
  it('open escalation on a worker that holds a todo → count>0 AND a danger node', () => {
    const todos = [todo({ id: 'T1', claimedBy: 'worker-1' })];
    const escalations = [esc({ id: 'e1', project: 'P', session: 'worker-1', status: 'open' })];
    const { needsYou, dangerCount } = parity(todos, escalations, 'P');
    expect(needsYou).toBeGreaterThan(0);
    expect(dangerCount).toBeGreaterThan(0);
    expect(needsYou > 0).toBe(dangerCount > 0);
  });

  it('no open escalations → count 0 AND no danger node', () => {
    const todos = [todo({ id: 'T1', claimedBy: 'worker-1' })];
    const escalations = [esc({ id: 'e1', project: 'P', session: 'worker-1', status: 'resolved' })];
    const { needsYou, dangerCount } = parity(todos, escalations, 'P');
    expect(needsYou).toBe(0);
    expect(dangerCount).toBe(0);
    expect(needsYou > 0).toBe(dangerCount > 0);
  });

  it('escalation in another project does not count for this project', () => {
    const todos = [todo({ id: 'T1', claimedBy: 'worker-1' })];
    const escalations = [esc({ id: 'e1', project: 'OTHER', session: 'worker-1', status: 'open' })];
    const { needsYou, dangerCount } = parity(todos, escalations, 'P');
    expect(needsYou).toBe(0);
    expect(dangerCount).toBe(0);
    expect(needsYou > 0).toBe(dangerCount > 0);
  });
});
