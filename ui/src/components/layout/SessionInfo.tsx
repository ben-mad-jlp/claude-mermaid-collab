/**
 * SessionInfo Component
 *
 * Displays current project and session information with a refresh action.
 * Shows the project basename (truncated) and session name in a compact panel.
 */

import React from 'react';

export interface SessionInfoProps {
  project: string;
  session: string;
  connected: boolean;
  isConnecting: boolean;
  onRefresh?: () => void;
}

export const SessionInfo: React.FC<SessionInfoProps> = ({ project, session, connected, isConnecting }) => {
  const basename = project.split('/').pop() ?? project;

  const pillClass = isConnecting
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
    : connected
    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
    : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300';

  const dotClass = isConnecting
    ? 'bg-yellow-500 animate-pulse'
    : connected
    ? 'bg-success-500'
    : 'bg-danger-500';

  const label = isConnecting ? 'Connecting' : connected ? 'Connected' : 'Disconnected';

  return (
    <div
      data-testid="session-info"
      className="px-3 py-2 border-b dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400"
      title={`${project} / ${session}`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate">{basename}</span>
        <span className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-3xs font-medium ${pillClass}`}>
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {label}
        </span>
      </div>
      <div className="font-medium text-gray-700 dark:text-gray-300 truncate">{session}</div>
    </div>
  );
};

export default SessionInfo;
