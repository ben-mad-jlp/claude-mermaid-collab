import { useEffect } from 'react';
import { useAgentStore } from '../stores/agentStore';

export interface WorktreeStatus {
  dirty: boolean;
  branch: string | null;
  kind: 'git' | 'non_git' | null;
}

/**
 * Poll worktree status for a given session.
 *
 * For now this is a no-op scaffold that reads the worktree slice
 * from the agent store (hydrated by `worktree_info` WS events).
 *
 * TODO: wire HTTP/WS polling against a dedicated worktree-status
 * endpoint once the backend exposes one (currently only the initial
 * `worktree_info` event is delivered on session bootstrap).
 */
export function useWorktreeStatus(sessionId: string | null): WorktreeStatus {
  const worktree = useAgentStore((s) => s.worktree);
  const dirty = useAgentStore((s) => s.worktreeDirty);

  useEffect(() => {
    if (!sessionId) return;
    // TODO: replace with real polling. Placeholder interval kept so the
    // hook surface matches future behavior without churn.
    const handle = window.setInterval(() => {
      // no-op: store is kept in sync via WS `worktree_info` events.
    }, 10_000);
    return () => window.clearInterval(handle);
  }, [sessionId]);

  if (!worktree) {
    return { dirty: false, branch: null, kind: null };
  }

  if ('kind' in worktree && worktree.kind === 'non_git') {
    return { dirty: false, branch: null, kind: 'non_git' };
  }

  return { dirty, branch: (worktree as { branch: string }).branch ?? null, kind: 'git' };
}

export default useWorktreeStatus;
