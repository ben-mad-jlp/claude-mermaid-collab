/**
 * NameInput Component
 *
 * Simple text input for "edited by" / "approved by" fields.
 * Used in topic editing and draft review workflows.
 */

import React from 'react';

export interface NameInputProps {
  /** Current input value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Optional label text */
  label?: string;
  /** Optional placeholder text */
  placeholder?: string;
  /** Whether the input is required */
  required?: boolean;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Optional additional class name */
  className?: string;
}

/**
 * NameInput component - Text input for name fields
 */
export const NameInput: React.FC<NameInputProps> = ({
  value,
  onChange,
  label,
  placeholder = 'Enter name...',
  required = false,
  disabled = false,
  className = '',
}) => {
  const inputId = React.useId();

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
          {required && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`
          px-3 py-2
          text-sm
          bg-white dark:bg-gray-700
          border border-gray-300 dark:border-gray-600
          rounded-md
          text-gray-900 dark:text-white
          placeholder-gray-400 dark:placeholder-gray-500
          focus:outline-none focus:ring-2 focus:ring-accent-500 dark:focus:ring-accent-400
          focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        `}
      />
    </div>
  );
};

export default NameInput;
