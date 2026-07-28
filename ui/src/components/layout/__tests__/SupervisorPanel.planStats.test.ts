/**
 * projectPlanStats — the "N open" badge (CommandBar + project list) must count only
 * real work, not mission/[LAND] container nodes.
 *
 * REGRESSION: a mission node's status is permanently 'todo' (terminality lives in
 * mission.db, never on the node), so counting mission nodes inflated "N open" by every
 * converged mission — 41 mission nodes turned a real ~31-leaf backlog into a "77 open"
 * badge the Plan kanban never shows (the kanban already excludeMissions()es). This locks
 * the badge to the kanban's honest set.
 */
import { describe, it, expect } from 'vitest';
import { projectPlanStats } from '../SupervisorPanel';
import type { SessionTodo } from '@/types/sessionTodo';
import type { TodoKind } from '@/lib/todoKind';

const mk = (id: string, kind: TodoKind, status: SessionTodo['status'] = 'todo'): SessionTodo =>
  ({ id, kind, status, title: id } as unknown as SessionTodo);

describe('projectPlanStats — open count', () => {
  it('excludes mission and land nodes from the open count', () => {
    const todos = [
      mk('leaf-1', 'leaf'),
      mk('leaf-2', 'leaf'),
      mk('epic-1', 'epic'),
      mk('mission-1', 'mission'), // permanently status='todo' — must NOT count
      mk('mission-2', 'mission'),
      mk('land-1', 'land'), // container/dead-letter role — must NOT count
    ];
    // 2 leaves + 1 epic = 3 real open items; 2 missions + 1 land excluded.
    expect(projectPlanStats(todos).open).toBe(3);
  });

  it('still ignores terminal (done/dropped) work', () => {
    const todos = [
      mk('leaf-open', 'leaf', 'todo'),
      mk('leaf-done', 'leaf', 'done'),
      mk('leaf-dropped', 'leaf', 'dropped'),
      mk('mission-1', 'mission', 'todo'),
    ];
    expect(projectPlanStats(todos).open).toBe(1);
  });
});
