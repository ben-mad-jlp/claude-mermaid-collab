/**
 * RoleSwitch — the shared pill used for an orchestration-role on/off switch.
 * A status dot + label + scope tag + on/off word. Used by GlobalRoleSwitches
 * (Steward/Supervisor, in the CommandBar) and RolesStrip (Coordinator, per
 * project). ON spawns the role; OFF stops it.
 */
import React from 'react';

export type RoleStatus = 'running' | 'stale' | 'off';

const DOT: Record<RoleStatus, string> = {
  running: 'bg-success-500',
  stale: 'bg-warning-500',
  off: 'bg-gray-400',
};

export const RoleSwitch: React.FC<{
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

export default RoleSwitch;
