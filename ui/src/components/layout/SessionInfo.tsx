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
    ? 'bg-yellow-100 text-yellow-700'
    : connected
    ? 'bg-green-100 text-green-700'
    : 'bg-red-100 text-red-700';

  const dotClass = isConnecting
    ? 'bg-yellow-500 animate-pulse'
    : connected
    ? 'bg-green-500'
    : 'bg-red-500';

  const label = isConnecting ? 'Connecting' : connected ? 'Connected' : 'Disconnected';

  return (
    <div
      data-testid="session-info"
      className="px-3 py-2 border-b text-xs text-gray-500"
      title={`${project} / ${session}`}
    >
      <div className="flex items-center justify-between">
        <span className="truncate">{basename}</span>
        <span className={`flex-shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pillClass}`}>
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          {label}
        </span>
      </div>
      <div className="font-medium text-gray-700 truncate">{session}</div>
    </div>
  );
};

export default SessionInfo;
