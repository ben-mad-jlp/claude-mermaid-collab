import React, { useId } from 'react';

export interface MultipleChoiceProps {
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  value?: string;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export const MultipleChoice: React.FC<MultipleChoiceProps> = ({
  options,
  onChange,
  value,
  label,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
}) => {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = ariaDescribedBy || `${id}-description`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {label && (
        <label
          id={labelId}
          htmlFor={id}
          className="block text-sm font-medium text-gray-900 dark:text-white"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        value={value || ''}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-describedby={ariaDescribedBy ? descriptionId : undefined}
        className="
          block w-full px-3 py-2 border border-gray-300 rounded-md
          bg-white text-gray-900
          dark:bg-gray-800 dark:text-white dark:border-gray-600
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-200
        "
      >
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

MultipleChoice.displayName = 'MultipleChoice';
