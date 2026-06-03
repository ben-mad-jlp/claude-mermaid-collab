/**
 * CommandBar — the Bridge's top identity + glance strip (BR-2, design §2/§8).
 *
 * It absorbs the deleted AlertRibbon: instead of a separate banner, the
 * at-a-glance fleet pulse lives inline here — `● N live · M in-flight ·
 * ▲ K needs you`. The "needs you" count is the single earned red; everything
 * else stays calm. Also hosts the project selector (the only place it lives).
 */

import React from 'react';

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

export interface CommandBarProps {
  project: string;
  projectOptions: string[];
  onSelectProject: (project: string) => void;
  liveCount: number;
  inflightCount: number;
  needsYouCount: number;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  project,
  projectOptions,
  onSelectProject,
  liveCount,
  inflightCount,
  needsYouCount,
}) => {
  return (
    <div
      data-testid="bridge-command-bar"
      className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700"
    >
      <span className="text-base" role="img" aria-label="bridge">⤢</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Bridge</span>
      <select
        data-testid="bridge-project-select"
        value={project}
        onChange={(e) => onSelectProject(e.target.value)}
        className="text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-1.5 py-0.5 outline-none max-w-[240px]"
      >
        {projectOptions.map((p) => (
          <option key={p} value={p}>
            {projectBasename(p)}
          </option>
        ))}
      </select>

      {/* Glanceable pulse — absorbed AlertRibbon. */}
      <div data-testid="bridge-glance" className="ml-auto flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
          <span className="text-success-500" aria-hidden="true">●</span>
          {liveCount} live
        </span>
        <span className="text-gray-600 dark:text-gray-300">{inflightCount} in-flight</span>
        <span
          className={`flex items-center gap-1 font-medium ${
            needsYouCount > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <span aria-hidden="true">▲</span>
          {needsYouCount} needs you
        </span>
      </div>
    </div>
  );
};

export default CommandBar;
