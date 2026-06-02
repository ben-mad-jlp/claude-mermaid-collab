import React from 'react';
import { useUIStore } from '@/stores/uiStore';
import type { SupervisorRole } from '@/stores/uiStore';

/**
 * PCS Phase 5 — segmented control that switches the supervisor surface between
 * the three role-scoped views (Supervisor | Planner | Coordinator). Drives
 * `uiStore.supervisorRole`.
 */
const ROLES: { id: SupervisorRole; label: string; glyph: string }[] = [
  { id: 'supervisor', label: 'Supervisor', glyph: '🛡' },
  { id: 'planner', label: 'Planner', glyph: '🧭' },
  { id: 'coordinator', label: 'Coordinator', glyph: '⚙' },
];

export const RoleSwitcher: React.FC = () => {
  const role = useUIStore((s) => s.supervisorRole);
  const setRole = useUIStore((s) => s.setSupervisorRole);

  return (
    <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
      {ROLES.map(({ id, label, glyph }) => (
        <button
          key={id}
          type="button"
          onClick={() => setRole(id)}
          title={label}
          className={`flex items-center gap-1 px-2 py-1 transition-colors border-l first:border-l-0 border-gray-200 dark:border-gray-700 ${
            role === id
              ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300 font-medium'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <span aria-hidden>{glyph}</span>
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
};

export default RoleSwitcher;
