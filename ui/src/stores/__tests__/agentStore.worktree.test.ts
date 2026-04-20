import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import type { AgentEvent, WorktreeInfo } from '../../types/agent';

const base = { sessionId: 's1', ts: 1000 };

beforeEach(() => {
  useAgentStore.getState().reset();
});

describe('agentStore.applyEvent — worktree_info', () => {
  it('reflects event payload on worktree and worktreeDirty', () => {
    const info: WorktreeInfo = {
      sessionId: 's1',
      path: '/tmp/worktrees/s1',
      branch: 'collab/foo-20260417-1234',
      baseBranch: 'master',
      createdAt: 999,
    };
    useAgentStore.getState().applyEvent({
      ...base,
      kind: 'worktree_info',
      info,
      dirty: true,
    } as AgentEvent);
    const { worktree, worktreeDirty } = useAgentStore.getState();
    expect(worktree).toEqual(info);
    expect(worktreeDirty).toBe(true);
  });

  it('commitInFlight defaults to false and is not touched by worktree_info', () => {
    expect(useAgentStore.getState().commitInFlight).toBe(false);
    useAgentStore.getState().applyEvent({
      ...base,
      kind: 'worktree_info',
      info: {
        sessionId: 's1',
        path: '/tmp/worktrees/s1',
        branch: 'collab/foo',
        baseBranch: 'master',
        createdAt: 1,
      },
      dirty: false,
    } as AgentEvent);
    expect(useAgentStore.getState().commitInFlight).toBe(false);
  });
});
