import React, { useEffect, useId, useState } from 'react';

export interface TextAreaProps {
  onChange?: (value: string) => void;
  value?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  maxLength?: number;
  minLength?: number;
  rows?: number;
  validation?: (value: string) => string | null;
}

export const TextArea: React.FC<TextAreaProps> = ({
  onChange,
  value = '',
  name,
  label,
  placeholder,
  disabled = false,
  required = false,
  ariaLabel,
  ariaDescribedBy,
  maxLength,
  minLength,
  rows = 4,
  validation,
}) => {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const [error, setError] = useState<string | null>(null);
  const [internalValue, setInternalValue] = useState(value || '');

  // Sync with prop when provided (controlled mode)
  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(value);
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    onChange?.(newValue);

    if (validation) {
      const validationError = validation(newValue);
      setError(validationError);
    }
  };

  const handleBlur = () => {
    if (validation) {
      const validationError = validation(internalValue);
      setError(validationError);
    }
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
          {required && <span className="text-red-600 dark:text-red-400 ml-1">*</span>}
        </label>
      )}
      <textarea
        id={id}
        name={name}
        value={internalValue}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        minLength={minLength}
        rows={rows}
        aria-label={ariaLabel || label}
        aria-describedby={ariaDescribedBy || (error ? errorId : undefined)}
        className={`
          block w-full px-3 py-2 border rounded-md
          bg-white text-gray-900
          dark:bg-gray-800 dark:text-white
          focus:outline-none focus:ring-2 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-200 resize-none
          ${
            error
              ? 'border-red-500 dark:border-red-400 focus:ring-red-500'
              : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
          }
        `}
      />
      {error && (
        <span id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
      {maxLength && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {internalValue.length}/{maxLength}
        </span>
      )}
    </div>
  );
};

TextArea.displayName = 'TextArea';
