import React from 'react';

export interface AliasChipProps {
  alias: string;
  onRemove?: () => void;
}

export const AliasChip: React.FC<AliasChipProps> = ({ alias, onRemove }) => {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 rounded-full text-sm">
      {alias}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-1 font-bold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
          title={`Remove ${alias}`}
        >
          ×
        </button>
      )}
    </span>
  );
};

AliasChip.displayName = 'AliasChip';
