import React, { useId, useState } from 'react';

export interface NumberInputProps {
  onChange?: (value: number | undefined) => void;
  value?: number;
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  onChange,
  value: controlledValue,
  name,
  label,
  min,
  max,
  step = 1,
  disabled = false,
  placeholder,
  ariaLabel,
}) => {
  const id = useId();
  const inputId = `${id}-number-input`;
  const [internalValue, setInternalValue] = useState<number | ''>(controlledValue ?? '');

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;

  const clamp = (val: number): number => {
    let result = val;
    if (min !== undefined && result < min) result = min;
    if (max !== undefined && result > max) result = max;
    return result;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;

    if (rawValue === '') {
      setInternalValue('');
      onChange?.(undefined);
      return;
    }

    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    const clampedValue = clamp(numValue);
    setInternalValue(clampedValue);
    onChange?.(clampedValue);
  };

  const handleStep = (direction: 1 | -1) => {
    if (disabled) return;

    const current = typeof currentValue === 'number' ? currentValue : 0;
    const newValue = current + (direction * step);
    const clampedValue = clamp(newValue);

    setInternalValue(clampedValue);
    onChange?.(clampedValue);
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-900 dark:text-white"
        >
          {label}
        </label>
      )}

      <div className="flex items-center">
        {/* Decrement button */}
        <button
          type="button"
          onClick={() => handleStep(-1)}
          disabled={disabled || (min !== undefined && typeof currentValue === 'number' && currentValue <= min)}
          className={`
            px-3 py-2
            bg-gray-100 dark:bg-gray-700
            border border-r-0 border-gray-300 dark:border-gray-600
            rounded-l-md
            text-gray-900 dark:text-white
            hover:bg-gray-200 dark:hover:bg-gray-600
            focus:outline-none focus:ring-2 focus:ring-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          `}
          aria-label="Decrease value"
        >
          −
        </button>

        {/* Input */}
        <input
          id={inputId}
          type="number"
          name={name}
          value={currentValue}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel || label}
          className={`
            w-20 px-3 py-2 text-center
            border border-gray-300 dark:border-gray-600
            bg-white dark:bg-gray-800
            text-gray-900 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed
            [appearance:textfield]
            [&::-webkit-outer-spin-button]:appearance-none
            [&::-webkit-inner-spin-button]:appearance-none
          `}
        />

        {/* Increment button */}
        <button
          type="button"
          onClick={() => handleStep(1)}
          disabled={disabled || (max !== undefined && typeof currentValue === 'number' && currentValue >= max)}
          className={`
            px-3 py-2
            bg-gray-100 dark:bg-gray-700
            border border-l-0 border-gray-300 dark:border-gray-600
            rounded-r-md
            text-gray-900 dark:text-white
            hover:bg-gray-200 dark:hover:bg-gray-600
            focus:outline-none focus:ring-2 focus:ring-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          `}
          aria-label="Increase value"
        >
          +
        </button>
      </div>
    </div>
  );
};

NumberInput.displayName = 'NumberInput';
