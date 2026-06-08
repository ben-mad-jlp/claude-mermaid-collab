/**
 * GlobalRoleSwitches — the per-project Coordinator on/off switch, shown in the
 * Bridge CommandBar. Steward + Supervisor are no longer here: they live as
 * status cards (with their own controls) in the Bridge project panel. ON starts
 * the coordinator daemon for the active project; OFF stops it.
 */
import React, { useEffect, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { RoleSwitch, type RoleStatus } from './RoleSwitch';

export interface GlobalRoleSwitchesProps {
  serverScope: string;
  /** Active project — drives the per-project Coordinator switch. */
  project?: string;
}

export const GlobalRoleSwitches: React.FC<GlobalRoleSwitchesProps> = ({ serverScope, project }) => {
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    const refresh = () => void loadCoordinator(serverScope, project);
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, project, loadCoordinator]);

  const coordStatus: RoleStatus = project && coordinatorByProject[project] ? 'running' : 'off';

  const toggleCoordinator = () => {
    if (!project) return;
    setBusy(true);
    void (async () => {
      try {
        await setCoordinator(serverScope, project, coordStatus === 'running' ? 'stop' : 'start');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div data-testid="global-role-switches" className="flex items-center gap-1.5">
      <RoleSwitch
        label="Coordinator"
        status={coordStatus}
        busy={busy}
        disabled={!project}
        disabledTitle="Select a project first"
        onToggle={toggleCoordinator}
      />
    </div>
  );
};

export default GlobalRoleSwitches;
