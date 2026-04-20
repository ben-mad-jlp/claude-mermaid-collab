import React, { useState, useMemo } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { useAgentSession } from '../../hooks/useAgentSession';
import { CommitPushPRModal } from './CommitPushPRModal';
import { PRStatusBadge } from './PRStatusBadge';
import { WorktreeSwitcher } from './WorktreeSwitcher';
import DiffViewer from './DiffViewer';

export interface WorktreeHeaderProps {
  sessionId: string | null;
}

/**
 * Compact header row at the top of AgentChat: shows the worktree branch,
 * a dirty indicator, and a button to commit/push/open-PR.
 *
 * Hidden when no worktree is attached or when the session falls back to
 * the non-git project root.
 */
export const WorktreeHeader: React.FC<WorktreeHeaderProps> = ({ sessionId }) => {
  const worktree = useAgentStore((s) => s.worktree);
  const dirty = useAgentStore((s) => s.worktreeDirty);
  const commitInFlight = useAgentStore((s) => s.commitInFlight);
  const multiSession = useAgentStore((s) => s.multiSession);
  const setActive = useAgentStore((s) => s.setActive);
  const [modalOpen, setModalOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const { commitPushPR } = useAgentSession(sessionId);

  const worktrees = useMemo(
    () =>
      Object.entries(multiSession.sessions).map(([sid, s]) => {
        const anyS = s as { name: string; unread: number; path?: string; branch?: string };
        return {
          sessionId: sid,
          path: anyS.path ?? anyS.name,
          branch: anyS.branch,
        };
      }),
    [multiSession.sessions],
  );

  if (!worktree) return null;
  if ('kind' in worktree && worktree.kind === 'non_git') return null;

  const branch = (worktree as { branch: string }).branch;

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs">
        <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 font-mono text-gray-700 dark:text-gray-200 truncate max-w-[18rem]">
          {branch}
        </code>
        {dirty && (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" aria-hidden />
            dirty
          </span>
        )}
        <WorktreeSwitcher
          worktrees={worktrees}
          activeSessionId={multiSession.activeSessionId ?? undefined}
          onSwitch={(sid) => setActive(sid)}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setDiffOpen((v) => !v)}
          className="px-2 py-0.5 text-[11px] font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          View diff
        </button>
        {sessionId && <PRStatusBadge sessionId={sessionId} />}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={commitInFlight || !sessionId}
          className="px-2 py-0.5 text-[11px] font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60 transition-colors"
        >
          {commitInFlight ? 'Working…' : 'Commit · Push · PR'}
        </button>
      </div>
      {diffOpen && sessionId && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex justify-end"
          onClick={() => setDiffOpen(false)}
        >
          <div
            className="h-full w-[600px] max-w-full bg-white dark:bg-gray-900 shadow-xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">Diff</span>
              <button
                type="button"
                onClick={() => setDiffOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Close
              </button>
            </div>
            <DiffViewer sessionId={sessionId} />
          </div>
        </div>
      )}
      <CommitPushPRModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(input) => commitPushPR(input)}
      />
    </>
  );
};

export default WorktreeHeader;
