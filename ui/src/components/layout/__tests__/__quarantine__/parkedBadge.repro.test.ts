/**
 * QUARANTINED REPRO — finding d43208d5, from explore run a0af7152.
 * RED BY DESIGN. This is a recorded, executable defect, not a failure.
 * Promote it into the normal suite when the fix lands — that promotion IS the proof.
 */
import { describe, it, expect } from 'vitest';
import { projectPlanStats } from '../../SupervisorPanel';
import type { SessionTodo } from '@/types/sessionTodo';

/** An approved, unblocked leaf — `claimReason` keys off assigneeKind to split the two cases. */
const leaf = (id: string, assigneeKind: 'agent' | 'human'): SessionTodo =>
  ({
    id,
    kind: 'leaf',
    status: 'ready',
    title: id,
    assigneeKind,
    approvedAt: '2026-08-08T00:00:00.000Z',
    dependsOn: [],
  } as unknown as SessionTodo);

describe('parked badge must not fire on human-assigned work', () => {
  it('Test A: a project whose only ready work is HUMAN-assigned is NOT parked', () => {
    const stats = projectPlanStats([leaf('human-1', 'human'), leaf('human-2', 'human')]);

    // The daemon has nothing to run; a person does. That is a to-do list, not a stall.
    expect(stats.idleWithWork).toBe(false);
  });

  it('Test B: mixing human work in does not manufacture a park', () => {
    const stats = projectPlanStats([
      leaf('human-1', 'human'),
      { ...leaf('done-1', 'agent'), status: 'done' } as SessionTodo,
    ]);
    expect(stats.idleWithWork).toBe(false);
  });

  it('Test C: a genuinely idle daemon with AGENT work queued IS still parked', () => {
    // The badge must keep working for the case it exists for — otherwise a "fix" that deletes
    // the warning passes A and B while destroying the signal.
    const stats = projectPlanStats([leaf('agent-1', 'agent')]);
    expect(stats.idleWithWork).toBe(true);
  });
});
