/**
 * ProjectRailRow — one project in the Project Rail (design-tabbed-bridge §5).
 *
 * Layout: [status dot] name  ▲N  [× on hover] [▶ if active].
 * Dot: red = open escalations, amber = idle-with-work (coordinator OFF & ready>0),
 * hollow grey = quiet. The red badge ▲N is hidden at 0. One-red discipline: a row
 * is red iff it has open escalations; amber only shows when NOT red.
 */
import React from 'react';

export interface ProjectRailRowData {
  project: string;
  name: string;
  escalationCount: number;
  idleWithWork: boolean;
}

const ProjectRailRowImpl: React.FC<{
  data: ProjectRailRowData;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  /** Drag-to-reorder (manual rail order). */
  onReorder?: (dragProject: string, dropProject: string) => void;
}> = ({ data, active, onSelect, onRemove, onReorder }) => {
  const red = data.escalationCount > 0;
  const dot = red ? 'bg-danger-500' : data.idleWithWork ? 'bg-warning-500' : 'border border-gray-400 dark:border-gray-500';
  return (
    <div
      data-testid="project-rail-row"
      data-project={data.project}
      data-active={active}
      draggable={!!onReorder}
      onDragStart={onReorder ? (e) => { e.dataTransfer.setData('text/x-mc-project', data.project); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      onDragOver={onReorder ? (e) => { if (e.dataTransfer.types.includes('text/x-mc-project')) e.preventDefault(); } : undefined}
      onDrop={onReorder ? (e) => {
        const drag = e.dataTransfer.getData('text/x-mc-project');
        if (drag && drag !== data.project) { e.preventDefault(); onReorder(drag, data.project); }
      } : undefined}
      className={`group flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
        active ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200'
      }`}
      onClick={onSelect}
      title={data.project}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`}
        aria-hidden="true"
        title={red ? `${data.escalationCount} need you` : data.idleWithWork ? 'coordinator off with ready work' : 'quiet'}
      />
      <span className="flex-1 min-w-0 truncate">{data.name}</span>
      {red && (
        <span
          data-testid="project-rail-badge"
          className="shrink-0 text-3xs font-bold text-danger-600 dark:text-danger-400"
        >
          ▲{data.escalationCount > 99 ? '99+' : data.escalationCount}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          data-testid="project-rail-remove"
          title={`Remove ${data.name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Remove project "${data.name}" from the Bridge?\n\nUnregisters it; files on disk are untouched.`)) {
              onRemove();
            }
          }}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded text-gray-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-opacity"
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
      {active && <span className="shrink-0 text-accent-500" aria-hidden="true">▶</span>}
    </div>
  );
};

export const ProjectRailRow = React.memo(ProjectRailRowImpl);
export default ProjectRailRow;
