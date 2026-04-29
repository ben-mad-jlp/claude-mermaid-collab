/**
 * SessionInfo Component
 *
 * Displays current project and session information with a refresh action.
 * Shows the project basename (truncated) and session name in a compact panel.
 */

import React from 'react';

export interface SessionInfoProps {
  /** Full project path */
  project: string;
  /** Session name */
  session: string;
  /** Callback to refresh session data */
  onRefresh: () => void;
}

/**
 * SessionInfo component showing project basename, session name, and refresh button.
 */
export const SessionInfo: React.FC<SessionInfoProps> = ({ project, session, onRefresh }) => {
  const basename = project.split('/').pop() ?? project;

  return (
    <div
      data-testid="session-info"
      className="px-3 py-2 border-b text-sm text-gray-500"
    >
      <div className="truncate text-xs" title={project}>
        {basename}
      </div>
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-700">{session}</span>
        <button
          onClick={onRefresh}
          aria-label="Refresh"
          className="ml-2 hover:text-gray-700"
        >
          ↺
        </button>
      </div>
    </div>
  );
};

export default SessionInfo;
