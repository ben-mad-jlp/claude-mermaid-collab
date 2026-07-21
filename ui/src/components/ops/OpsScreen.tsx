import React from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { selectOpenEscalations } from '@/lib/statusSelectors';
import { OpsEscalationGroups } from './OpsEscalationGroups';
import { OpsProjectPanel } from './OpsProjectPanel';
import { OpsSessionCards } from './OpsSessionCards';

interface OpsScreenProps {
  serverScope: string;
}

export const OpsScreen: React.FC<OpsScreenProps> = ({ serverScope }) => {
  const { openEscalations: rawOpenEscalations, watchedProjects, unlandedEpicsByProject, todosByProject, landEpic, resetTodo } = useSupervisorStore();
  const watchedSessionCount = useSubscriptionStore((s) => s.order.length);
  const openEscalations = selectOpenEscalations(rawOpenEscalations, { kind: 'fleet' });

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Ops</h2>
        <button
          onClick={() => useUIStore.getState().toggleZenMode()}
          aria-label="Close Ops screen"
          title="Close Ops screen"
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
      {watchedSessionCount > 0 && (
        <section>
          <OpsSessionCards serverScope={serverScope} />
        </section>
      )}

      {/* Escalations */}
      {openEscalations.length > 0 && (
        <section>
          <OpsEscalationGroups escalations={openEscalations} serverScope={serverScope} />
        </section>
      )}

      {/* Per-Project Panels */}
      {watchedProjects.length > 0 && (
        <section className="space-y-3">
          {watchedProjects.map((wp) => (
            <OpsProjectPanel
              key={wp.project}
              project={wp.project}
              serverScope={serverScope}
            />
          ))}
        </section>
      )}

      {/* Stranded Branches */}
      {Object.entries(unlandedEpicsByProject).some(([_, epics]) => epics.length > 0) && (
        <section>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
                Stranded Branches
              </h3>
            </div>
            <div className="px-4 py-3">
              <div className="space-y-2">
                {Object.entries(unlandedEpicsByProject).map(([project, epics]) =>
                  epics.map((epic) => {
                    const landEsc = openEscalations.find(
                      (e) => e.project === project && e.kind === 'epic-ready-to-land' && e.status === 'open' && e.todoId?.startsWith(epic.epicId8)
                    );
                    const epicTodo = todosByProject[project]?.find((t) => t.id.startsWith(epic.epicId8));
                    return (
                      <div
                        key={`${project}-${epic.epicId8}`}
                        className="p-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            <span className="font-mono">{epic.branch}</span> (
                            <span className="text-gray-500">{epic.epicId8}</span>, ahead{' '}
                            <span className="font-semibold">{epic.ahead}</span>)
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => landEsc && landEpic(serverScope, project, landEsc.id)}
                            disabled={!landEsc}
                            className="flex-1 px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Land
                          </button>
                          <button
                            onClick={() => epicTodo && resetTodo(serverScope, project, epicTodo.id, 'ready')}
                            disabled={!epicTodo}
                            className="flex-1 px-2 py-1 text-xs font-medium rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Reset to ready
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Empty state */}
      {openEscalations.length === 0 && watchedProjects.length === 0 && watchedSessionCount === 0 && (
        <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
          <span>No escalations or watched projects</span>
        </div>
      )}
        </div>
      </div>
    </div>
  );
};
