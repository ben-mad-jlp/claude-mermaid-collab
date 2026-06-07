/**
 * RolesStrip — the PER-PROJECT role control in the Bridge detail pane: just the
 * Coordinator switch for the active project (design-tabbed-bridge phase 4). The
 * two fleet-GLOBAL switches (Steward, Supervisor) were hoisted to the CommandBar
 * (GlobalRoleSwitches) so a global role never reads as per-project. ON starts the
 * coordinator for this project; OFF stops it.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { RoleSwitch, type RoleStatus } from './RoleSwitch';

export interface RolesStripProps {
  project: string;
  serverScope: string;
}

export const RolesStrip: React.FC<RolesStripProps> = ({ project, serverScope }) => {
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => {
      if (project) void loadCoordinator(serverScope, project);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, project, loadCoordinator]);

  const coordStatus: RoleStatus = coordinatorByProject[project] ? 'running' : 'off';
  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : '—';

  const toggleCoordinator = () =>
    void (async () => {
      if (!project) return;
      setBusy(true);
      try {
        await setCoordinator(serverScope, project, coordStatus === 'running' ? 'stop' : 'start');
      } finally {
        setBusy(false);
      }
    })();

  return (
    <div
      data-testid="roles-strip"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
    >
      <span className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-0.5">
        Coordinator
      </span>
      <RoleSwitch
        label="Coordinator"
        scope={projectName}
        status={coordStatus}
        busy={busy}
        disabled={!project}
        disabledTitle="Select a project first"
        onToggle={toggleCoordinator}
      />
    </div>
  );
};

export default RolesStrip;
