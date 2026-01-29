import React, { useState, useRef } from 'react';
import { AliasChip } from './AliasChip';

export interface AliasEditorProps {
  aliases: string[];
  onAdd: (alias: string) => Promise<void>;
  onRemove: (alias: string) => Promise<void>;
}

export const AliasEditor: React.FC<AliasEditorProps> = ({
  aliases,
  onAdd,
  onRemove,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [removingAlias, setRemovingAlias] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when expanded
  React.useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleAddClick = () => {
    setIsExpanded(true);
  };

  const handleInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      await handleSubmit();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleSubmit = async () => {
    const trimmedValue = inputValue.trim();

    // Validation: no empty aliases
    if (!trimmedValue) {
      return;
    }

    // Validation: no duplicates
    if (aliases.includes(trimmedValue)) {
      return;
    }

    setIsLoading(true);
    try {
      await onAdd(trimmedValue);
      setInputValue('');
      setIsExpanded(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setInputValue('');
    setIsExpanded(false);
  };

  const handleRemoveAlias = async (alias: string) => {
    setRemovingAlias(alias);
    try {
      await onRemove(alias);
    } finally {
      setRemovingAlias(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {aliases.map((alias) => (
        <AliasChip
          key={alias}
          alias={alias}
          onRemove={() => handleRemoveAlias(alias)}
          disabled={isLoading || removingAlias !== null}
        />
      ))}

      {isExpanded ? (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Enter alias"
            disabled={isLoading || removingAlias !== null}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSubmit}
            disabled={isLoading || removingAlias !== null}
            className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit
          </button>
          <button
            onClick={handleCancel}
            disabled={isLoading || removingAlias !== null}
            className="px-2 py-1 text-sm bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-gray-100 rounded hover:bg-gray-400 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleAddClick}
          disabled={removingAlias !== null}
          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add
        </button>
      )}
    </div>
  );
};

AliasEditor.displayName = 'AliasEditor';
