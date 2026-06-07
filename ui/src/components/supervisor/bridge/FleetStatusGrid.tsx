/**
 * FleetStatusGrid — the per-project status table on the FLEET landing
 * (design-tabbed-bridge §2a). One row per watched project: open-escalation count,
 * coordinator state (with an inline start when idle-with-work), ready todos, live
 * workers. Click a row to drop into that project's Bridge. Amber idle-with-work is
 * the silent-stall warning (coordinator OFF while ready > 0).
 */
import React from 'react';

export interface FleetGridRow {
  project: string;
  name: string;
  escalationCount: number;
  coordinatorRunning: boolean;
  readyCount: number;
  workerCount: number;
}

export interface FleetStatusGridProps {
  rows: FleetGridRow[];
  onSelectProject: (project: string) => void;
  onStartCoordinator: (project: string) => void;
}

export const FleetStatusGrid: React.FC<FleetStatusGridProps> = ({ rows, onSelectProject, onStartCoordinator }) => {
  return (
    <div data-testid="fleet-status-grid" className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
        Fleet status · {rows.length} project{rows.length === 1 ? '' : 's'}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-3xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            <th className="text-left font-medium px-3 py-1">Project</th>
            <th className="text-center font-medium px-1 py-1">Esc</th>
            <th className="text-left font-medium px-2 py-1">Coordinator</th>
            <th className="text-center font-medium px-1 py-1">Ready</th>
            <th className="text-center font-medium px-1 py-1">Workers</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 dark:text-gray-500">No projects</td></tr>
          ) : (
            rows.map((r) => {
              const idleWithWork = !r.coordinatorRunning && r.readyCount > 0;
              return (
                <tr
                  key={r.project}
                  data-testid="fleet-grid-row"
                  data-project={r.project}
                  className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                  onClick={() => onSelectProject(r.project)}
                >
                  <td className="px-3 py-1.5 truncate max-w-[180px] text-gray-800 dark:text-gray-100" title={r.project}>{r.name}</td>
                  <td className="px-1 py-1.5 text-center">
                    {r.escalationCount > 0 ? (
                      <span className="font-bold text-danger-600 dark:text-danger-400">▲{r.escalationCount}</span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.coordinatorRunning ? 'bg-success-500' : idleWithWork ? 'bg-warning-500' : 'border border-gray-400'}`} aria-hidden="true" />
                      {r.coordinatorRunning ? (
                        <span className="text-gray-600 dark:text-gray-300">on</span>
                      ) : idleWithWork ? (
                        <button
                          type="button"
                          data-testid="fleet-start-coordinator"
                          onClick={(e) => { e.stopPropagation(); onStartCoordinator(r.project); }}
                          className="text-warning-700 dark:text-warning-400 hover:underline"
                          title="Coordinator off with ready work — start it"
                        >
                          ⚠ start
                        </button>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">off</span>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-center text-gray-700 dark:text-gray-300">{r.readyCount}</td>
                  <td className="px-1 py-1.5 text-center text-gray-700 dark:text-gray-300">{r.workerCount}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default FleetStatusGrid;
