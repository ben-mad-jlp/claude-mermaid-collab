import React from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { SpecSheetPane } from './spec/SpecSheetPane';

/**
 * SpecWorkspace — the SPEC mode surface: a project's Spec Sheet (typed
 * system-object tree + promise chips + coverage) as a first-class workspace
 * pane, not a session-scoped Studio artifact tab. The spec is PER PROJECT, so
 * it is scoped by `activeProject` (the Bridge/Plan project selector), falling
 * back to the current session's project so the pane is never empty mid-session.
 */
export const SpecWorkspace: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const config = useSupervisorStore((s) => s.config);
  const activeProjectPref = useUIStore((s) => s.activeProject);

  const project = activeProjectPref ?? currentSession?.project ?? config?.supervisorProject ?? '';

  if (!project) {
    return (
      <main className="flex-1 h-full min-h-0 overflow-hidden bg-white dark:bg-gray-800 flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="text-2xl mb-2" aria-hidden="true">▤</div>
          <div className="text-sm font-medium">Spec</div>
          <div className="text-xs mt-1">No project in scope. Open a session or pick a project.</div>
        </div>
      </main>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden bg-white dark:bg-gray-900">
      <SpecSheetPane project={project} />
    </div>
  );
};

export default SpecWorkspace;
