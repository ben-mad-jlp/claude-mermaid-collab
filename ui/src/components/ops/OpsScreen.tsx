import React from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { OpsEscalationGroups } from './OpsEscalationGroups';
import { OpsProjectPanel } from './OpsProjectPanel';
import { OpsSessionCards } from './OpsSessionCards';

interface OpsScreenProps {
  serverScope: string;
}

export const OpsScreen: React.FC<OpsScreenProps> = ({ serverScope }) => {
  const { openEscalations, watchedProjects, unlandedEpicsByProject } = useSupervisorStore();
  const watchedSessionCount = useSubscriptionStore((s) => s.order.length);

  return (
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
                  epics.map((epic) => (
                    <div
                      key={`${project}-${epic.epicId8}`}
                      className="text-xs p-2 rounded bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                    >
                      <span className="font-mono">{epic.branch}</span> (
                      <span className="text-gray-500">{epic.epicId8}</span>, ahead{' '}
                      <span className="font-semibold">{epic.ahead}</span>)
                    </div>
                  ))
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
  );
};
