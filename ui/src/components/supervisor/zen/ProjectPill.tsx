import React from 'react';
import { type PlanTotals } from '@/components/supervisor/PlanTotals';

export interface ProjectPillProps {
  project: string;
  totals: PlanTotals;
}

export const ProjectPill: React.FC<ProjectPillProps> = ({ project, totals }) => {
  const name = project.split('/').pop() || project;
  const { counts, total } = totals;
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs">
      <span className="font-medium text-gray-700 dark:text-gray-300 max-w-[120px] truncate" title={project}>
        {name}
      </span>
      <div className="flex items-center gap-1.5 text-3xs font-medium">
        {counts.inflight > 0 && (
          <span className="text-accent-600 dark:text-accent-400">{counts.inflight} active</span>
        )}
        {counts.blocked > 0 && (
          <span className="text-warning-600 dark:text-warning-400">{counts.blocked} blocked</span>
        )}
        {counts.ready > 0 && (
          <span className="text-gray-500 dark:text-gray-400">{counts.ready} ready</span>
        )}
        <span className="text-gray-400 dark:text-gray-500">{total} open</span>
      </div>
    </div>
  );
};

export default ProjectPill;
