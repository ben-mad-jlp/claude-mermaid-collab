/**
 * GlobalRoleSwitches — the two FLEET-GLOBAL role switches (Steward, Supervisor),
 * hoisted into the CommandBar (design-tabbed-bridge phase 4 / §2 Altitude 0).
 * They live in the fleet chrome, physically apart from the per-project Coordinator
 * switch (which stays in the RolesStrip), so a global role can never read as
 * per-project. ON spawns the role; OFF stops it. The Steward switch controls
 * PRESENCE (running); its auto-act ON/OFF lives in the running Steward panel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { RoleSwitch, type RoleStatus } from './RoleSwitch';

export interface GlobalRoleSwitchesProps {
  serverScope: string;
  /** Active project — drives the per-project Coordinator switch shown alongside
   *  the two global role switches. */
  project?: string;
}

export const GlobalRoleSwitches: React.FC<GlobalRoleSwitchesProps> = ({ serverScope, project }) => {
  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const supLiveness = useSupervisorStore((s) => s.liveness);
  const config = useSupervisorStore((s) => s.config);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);
  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const loadLiveness = useSupervisorStore((s) => s.loadLiveness);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const startRole = useSupervisorStore((s) => s.startRole);
  const stopRole = useSupervisorStore((s) => s.stopRole);
  const setCoordinator = useSupervisorStore((s) => s.setCoordinator);

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // The steward runs in a fixed global workspace resolved from the server config.
  const [stewardWs, setStewardWs] = useState<{ project: string; session: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mc = (window as any).mc;
        const res = mc?.invokeOnServer
          ? await mc.invokeOnServer(serverScope, { path: '/api/supervisor/steward-config', method: 'GET' })
          : { body: await (await fetch('/api/supervisor/steward-config')).json() };
        const cfg = res?.body ?? {};
        if (!cancelled && cfg.stewardProject && cfg.stewardSession) {
          setStewardWs({ project: cfg.stewardProject, session: cfg.stewardSession });
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverScope]);

  useEffect(() => {
    const refresh = () => {
      void loadStewardIdentity(serverScope);
      void loadLiveness(serverScope);
      void loadConfig(serverScope);
      if (project) void loadCoordinator(serverScope, project);
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [serverScope, project, loadStewardIdentity, loadLiveness, loadConfig, loadCoordinator]);

  const stewardStatus: RoleStatus = useMemo(
    () => (stewardLiveness?.running ? 'running' : stewardLiveness?.identity ? 'stale' : 'off'),
    [stewardLiveness],
  );
  const supConfigured = !!config?.supervisorProject && !!config?.supervisorSession;
  const supStatus: RoleStatus = useMemo(
    () => (supLiveness?.running ? 'running' : supConfigured && supLiveness?.identity ? 'stale' : 'off'),
    [supLiveness, supConfigured],
  );
  const coordStatus: RoleStatus = project && coordinatorByProject[project] ? 'running' : 'off';

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const toggleSteward = () =>
    void withBusy('steward', async () => {
      if (stewardStatus !== 'off') {
        await stopRole(serverScope, 'steward');
      } else if (stewardWs) {
        // The steward is the human's remote command center — launch it with Claude
        // Code Remote Control so it's reachable from the Claude app.
        const r = await startRole(serverScope, 'steward', stewardWs.project, stewardWs.session, true);
        if (!r.started) alert(`Steward failed to start: ${r.reason ?? 'unknown'}`);
      }
      void loadStewardIdentity(serverScope);
    });

  const toggleSupervisor = () =>
    void withBusy('supervisor', async () => {
      if (supStatus !== 'off') {
        await stopRole(serverScope, 'supervisor');
      } else if (supConfigured) {
        const r = await startRole(serverScope, 'supervisor', config!.supervisorProject, config!.supervisorSession);
        if (!r.started) alert(`Supervisor failed to start: ${r.reason ?? 'unknown'}`);
      }
      void loadLiveness(serverScope);
    });

  const toggleCoordinator = () =>
    void withBusy('coordinator', async () => {
      if (!project) return;
      await setCoordinator(serverScope, project, coordStatus === 'running' ? 'stop' : 'start');
    });

  return (
    <div data-testid="global-role-switches" className="flex items-center gap-1.5">
      <RoleSwitch
        label="Steward"
        scope="fleet"
        status={stewardStatus}
        busy={busy.steward}
        disabled={stewardStatus === 'off' && !stewardWs}
        disabledTitle="Steward workspace not configured on the server"
        onToggle={toggleSteward}
      />
      <RoleSwitch
        label="Supervisor"
        scope="fleet"
        status={supStatus}
        busy={busy.supervisor}
        disabled={supStatus === 'off' && !supConfigured}
        disabledTitle="Set up the Supervisor in its panel first"
        onToggle={toggleSupervisor}
      />
      <RoleSwitch
        label="Coordinator"
        status={coordStatus}
        busy={busy.coordinator}
        disabled={!project}
        disabledTitle="Select a project first"
        onToggle={toggleCoordinator}
      />
    </div>
  );
};

export default GlobalRoleSwitches;
