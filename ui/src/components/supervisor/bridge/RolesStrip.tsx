/**
 * RolesStrip — the Bridge's single control surface for the three orchestration
 * roles. One labeled switch each for Steward, Supervisor, and Coordinator, with
 * a live status dot. Flipping a switch ON spawns the role; OFF stops it. The
 * left-column role panels render only while a role is running (Sidebar gating),
 * so this strip is where a role is turned on in the first place.
 *
 * Scope is mixed and labeled honestly: Steward + Supervisor are fleet-GLOBAL
 * roles (one each, fixed workspaces); Coordinator is PER-PROJECT and tracks the
 * Bridge's currently-selected project. The Steward switch controls PRESENCE
 * (running); its auto-act ON/OFF lives in the running Steward panel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';

export interface RolesStripProps {
  project: string;
  serverScope: string;
}

type RoleStatus = 'running' | 'stale' | 'off';

const DOT: Record<RoleStatus, string> = {
  running: 'bg-success-500',
  stale: 'bg-warning-500',
  off: 'bg-gray-400',
};

const RoleSwitch: React.FC<{
  label: string;
  scope: string;
  status: RoleStatus;
  disabled?: boolean;
  disabledTitle?: string;
  busy?: boolean;
  onToggle: () => void;
}> = ({ label, scope, status, disabled, disabledTitle, busy, onToggle }) => {
  const on = status !== 'off';
  return (
    <button
      type="button"
      data-testid={`role-switch-${label.toLowerCase()}`}
      data-status={status}
      disabled={disabled || busy}
      onClick={onToggle}
      title={
        disabled
          ? disabledTitle
          : on
            ? `${label} is ${status === 'stale' ? 'not responding' : 'running'} — click to stop`
            : `${label} is off — click to start`
      }
      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        on
          ? 'border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20 text-gray-800 dark:text-gray-100'
          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT[status]}`} aria-hidden="true" />
      <span>{label}</span>
      <span className="text-3xs text-gray-400 dark:text-gray-500">{scope}</span>
      <span className="ml-0.5 text-3xs font-semibold uppercase tracking-wide">
        {busy ? '…' : on ? 'on' : 'off'}
      </span>
    </button>
  );
};

export const RolesStrip: React.FC<RolesStripProps> = ({ project, serverScope }) => {
  const stewardLiveness = useSupervisorStore((s) => s.stewardLiveness);
  const supLiveness = useSupervisorStore((s) => s.liveness);
  const config = useSupervisorStore((s) => s.config);
  const coordinatorByProject = useSupervisorStore((s) => s.coordinatorByProject);

  const loadStewardIdentity = useSupervisorStore((s) => s.loadStewardIdentity);
  const loadLiveness = useSupervisorStore((s) => s.loadLiveness);
  const loadCoordinator = useSupervisorStore((s) => s.loadCoordinator);
  const loadConfig = useSupervisorStore((s) => s.loadConfig);
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

  // Keep the three statuses fresh on the Bridge's poll cadence.
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
    () =>
      stewardLiveness?.running
        ? 'running'
        : stewardLiveness?.identity
          ? 'stale'
          : 'off',
    [stewardLiveness],
  );
  const supConfigured = !!config?.supervisorProject && !!config?.supervisorSession;
  const supStatus: RoleStatus = useMemo(
    () => (supLiveness?.running ? 'running' : supConfigured && supLiveness?.identity ? 'stale' : 'off'),
    [supLiveness, supConfigured],
  );
  const coordStatus: RoleStatus = coordinatorByProject[project] ? 'running' : 'off';

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
        const r = await startRole(serverScope, 'steward', stewardWs.project, stewardWs.session);
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

  const projectName = project ? project.split('/').filter(Boolean).pop() ?? project : '—';

  return (
    <div
      data-testid="roles-strip"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
    >
      <span className="text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mr-0.5">
        Roles
      </span>
      <RoleSwitch
        label="Steward"
        scope="global"
        status={stewardStatus}
        busy={busy.steward}
        disabled={stewardStatus === 'off' && !stewardWs}
        disabledTitle="Steward workspace not configured on the server"
        onToggle={toggleSteward}
      />
      <RoleSwitch
        label="Supervisor"
        scope="global"
        status={supStatus}
        busy={busy.supervisor}
        disabled={supStatus === 'off' && !supConfigured}
        disabledTitle="Set up the Supervisor in its panel first"
        onToggle={toggleSupervisor}
      />
      <RoleSwitch
        label="Coordinator"
        scope={projectName}
        status={coordStatus}
        busy={busy.coordinator}
        disabled={!project}
        disabledTitle="Select a project first"
        onToggle={toggleCoordinator}
      />
    </div>
  );
};

export default RolesStrip;
