import React from 'react';
import { useConductorEnabled } from './useConductorEnabled';

export interface ConductorStatusBadgeProps {
  project: string;
}

export const ConductorStatusBadge: React.FC<ConductorStatusBadgeProps> = ({ project }) => {
  const { enabled } = useConductorEnabled(project);

  if (enabled === null) return null;

  return (
    <span
      data-testid="conductor-status-badge"
      data-enabled={String(enabled)}
      title={`Autonomous conductor: ${enabled ? 'on' : 'off'} (change it in project settings)`}
      className="flex items-center gap-1 text-3xs font-medium text-gray-500 dark:text-gray-400 shrink-0"
    >
      <span
        aria-hidden="true"
        className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-success-500' : 'bg-gray-400 dark:bg-gray-500'}`}
      />
      Conductor
    </span>
  );
};

export default ConductorStatusBadge;
