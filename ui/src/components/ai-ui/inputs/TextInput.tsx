import React, { useId, useState } from 'react';

export interface TextInputProps {
  onChange: (value: string) => void;
  value?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  type?: 'text' | 'email' | 'password' | 'url' | 'number';
  ariaLabel?: string;
  ariaDescribedBy?: string;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  validation?: (value: string) => string | null;
}

export const TextInput: React.FC<TextInputProps> = ({
  onChange,
  value = '',
  label,
  placeholder,
  disabled = false,
  required = false,
  type = 'text',
  ariaLabel,
  ariaDescribedBy,
  pattern,
  maxLength,
  minLength,
  validation,
}) => {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    if (validation) {
      const validationError = validation(newValue);
      setError(validationError);
    }
  };

  const handleBlur = () => {
    if (validation) {
      const validationError = validation(value);
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
      <input
        id={id}
        type={type}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        pattern={pattern}
        maxLength={maxLength}
        minLength={minLength}
        aria-label={ariaLabel || label}
        aria-describedby={ariaDescribedBy || (error ? errorId : undefined)}
        className={`
          block w-full px-3 py-2 border rounded-md
          bg-white text-gray-900
          dark:bg-gray-800 dark:text-white
          focus:outline-none focus:ring-2 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors duration-200
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
    </div>
  );
};

TextInput.displayName = 'TextInput';
