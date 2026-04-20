import React from 'react';
import { useWorktreeStatus } from '../../hooks/useWorktreeStatus';

export interface WorktreeBadgeProps {
  sessionId: string | null;
  className?: string;
}

/**
 * Tiny inline badge showing the worktree branch + dirty dot for a session.
 * Renders nothing for non-worktree or non-git sessions.
 */
export const WorktreeBadge: React.FC<WorktreeBadgeProps> = ({ sessionId, className = '' }) => {
  const { branch, dirty, kind } = useWorktreeStatus(sessionId);

  if (!sessionId || !branch || kind !== 'git') return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono text-gray-600 dark:text-gray-400 ${className}`}
      title={dirty ? `${branch} (uncommitted changes)` : branch}
    >
      <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 truncate max-w-[10rem]">
        {branch}
      </code>
      {dirty && (
        <span
          aria-label="dirty"
          className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"
        />
      )}
    </span>
  );
};

export default WorktreeBadge;
