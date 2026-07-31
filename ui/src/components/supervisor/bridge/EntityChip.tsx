import React from 'react';
import { displayLabel } from '@/lib/entityNickname';

export interface EntityChipProps {
  kind: string;
  id: string;
  nicknames?: Record<string, string>;
  onOpen: (kind: string, id: string) => void;
  raw?: boolean;
}

export const EntityChip: React.FC<EntityChipProps> = ({ kind, id, nicknames, onOpen, raw }) => {
  const label = raw ? id : displayLabel(id, nicknames);
  return (
    <button
      type="button"
      data-testid={`entity-chip-${kind}-${id}`}
      data-entity-id={id}
      title={id}
      onClick={() => onOpen(kind, id)}
      className="text-2xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
    >
      {label}
    </button>
  );
};
