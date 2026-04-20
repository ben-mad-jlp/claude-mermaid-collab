import React from 'react';
import type { PermissionMode } from '@/types/agent';

interface Props {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  disabled?: boolean;
}

const PermissionModeSelector: React.FC<Props> = ({ value, onChange, disabled }) => {
  return (
    <select
      className="text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white pl-2 pr-7 py-1 min-w-[9rem]"
      value={value}
      onChange={(e) => onChange(e.target.value as PermissionMode)}
      disabled={disabled}
    >
      <option value="supervised">Supervised</option>
      <option value="accept-edits">Accept Edits</option>
      <option value="plan">Plan</option>
      <option value="bypass">Bypass</option>
    </select>
  );
};

PermissionModeSelector.displayName = 'PermissionModeSelector';

export default PermissionModeSelector;
