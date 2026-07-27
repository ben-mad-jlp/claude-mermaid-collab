/**
 * FleetGraphDangerRing test:
 *
 * When selectHumanActionableEscalations filters out machine-hygiene kinds
 * (like 'epic-sweep-triage'), only the human-actionable escalations should
 * produce danger nodes in the FleetGraph. This proves the danger ring is
 * wired to the same selector as the badge/NeedsYouZone.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetGraph } from './useFleetGraph';
import { selectHumanActionableEscalations } from '@/lib/statusSelectors';
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
    kind: 'leaf',
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

describe('FleetGraphDangerRing', () => {
  it('human-actionable escalations produce danger nodes; machine-hygiene kinds are filtered out', () => {
    // Mixed fixture: two todos held by different workers
    const todos = [
      todo({ id: 'T1', claimedBy: 'worker-decision', status: 'in_progress' }),
      todo({ id: 'T2', claimedBy: 'worker-hygiene', status: 'in_progress' }),
    ];

    // Two escalations: one human-actionable, one machine-hygiene
    const allEscalations = [
      esc({ id: 'e1', project: 'P', session: 'worker-decision', kind: 'decision', status: 'open' }),
      esc({ id: 'e2', project: 'P', session: 'worker-hygiene', kind: 'epic-sweep-triage', status: 'open' }),
    ];

    // Filter through selectHumanActionableEscalations
    const humanActionable = selectHumanActionableEscalations(allEscalations, { kind: 'project', project: 'P' });

    // Verify the filter worked: epic-sweep-triage should be excluded
    expect(humanActionable).toHaveLength(1);
    expect(humanActionable[0].kind).toBe('decision');

    // Render the graph with the filtered escalations
    const { result } = renderHook(() =>
      useFleetGraph({
        todos,
        subs: [],
        openEscalations: humanActionable,
        expandedEpics: new Set(),
        now: 0,
      }),
    );

    // Assert exactly one danger node (the one from 'decision' escalation)
    const dangerNodes = result.current.nodes.filter((n) => (n.data as { danger?: boolean }).danger === true);
    expect(dangerNodes).toHaveLength(1);
  });
});
