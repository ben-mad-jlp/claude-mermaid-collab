import React, { useId, useState } from 'react';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options?: RadioOption[];
  onChange?: (value: string) => void;
  value?: string;
  name?: string;
  label?: string;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  ariaLabel?: string;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  options = [],
  onChange,
  value: controlledValue,
  name,
  label,
  disabled = false,
  orientation = 'vertical',
  ariaLabel,
}) => {
  const id = useId();
  const groupId = `${id}-radio-group`;
  const [internalValue, setInternalValue] = useState(controlledValue || '');

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;

  const handleChange = (newValue: string) => {
    if (disabled) return;
    setInternalValue(newValue);
    onChange?.(newValue);
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          id={`${groupId}-label`}
          className="block text-sm font-medium text-gray-900 dark:text-white"
        >
          {label}
        </label>
      )}
      <div
        role="radiogroup"
        aria-labelledby={label ? `${groupId}-label` : undefined}
        aria-label={ariaLabel || label}
        className={`flex ${orientation === 'horizontal' ? 'flex-row flex-wrap gap-4' : 'flex-col gap-2'}`}
      >
        {options.map((option, index) => {
          const optionId = `${groupId}-option-${index}`;
          const isDisabled = disabled || option.disabled;
          const isChecked = currentValue === option.value;

          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={`
                flex items-center gap-2 cursor-pointer
                ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              <input
                id={optionId}
                type="radio"
                name={name || groupId}
                value={option.value}
                checked={isChecked}
                disabled={isDisabled}
                onChange={() => handleChange(option.value)}
                className={`
                  w-4 h-4
                  text-blue-600 dark:text-blue-500
                  border-gray-300 dark:border-gray-600
                  focus:ring-2 focus:ring-blue-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              />
              <span className="text-sm text-gray-900 dark:text-white">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

RadioGroup.displayName = 'RadioGroup';
