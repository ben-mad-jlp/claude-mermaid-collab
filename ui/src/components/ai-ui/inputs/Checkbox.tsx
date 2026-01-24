import React, { useId, useState } from 'react';

export interface CheckboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface CheckboxProps {
  options?: CheckboxOption[];
  onChange?: (values: string[]) => void;
  values?: string[];
  name?: string;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  options = [],
  onChange,
  values: controlledValues,
  name,
  label,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
}) => {
  const id = useId();
  const groupId = `${id}-group`;
  const descriptionId = `${id}-description`;
  const [internalValues, setInternalValues] = useState<string[]>(controlledValues || []);

  const currentValues = controlledValues !== undefined ? controlledValues : internalValues;

  const handleChange = (optionValue: string) => {
    const newValues = currentValues.includes(optionValue)
      ? currentValues.filter((v) => v !== optionValue)
      : [...currentValues, optionValue];
    setInternalValues(newValues);
    onChange?.(newValues);
  };

  return (
    <fieldset className="flex flex-col gap-3 w-full">
      {label && (
        <legend className="block text-sm font-medium text-gray-900 dark:text-white">
          {label}
        </legend>
      )}
      <div
        id={groupId}
        className="flex flex-col gap-2 mt-2"
        role="group"
        aria-label={ariaLabel || label}
        aria-describedby={ariaDescribedBy || descriptionId}
      >
        {name && (
          <input type="hidden" name={name} value={JSON.stringify(currentValues)} />
        )}
        {options.map((option) => {
          const checkboxId = `${id}-${option.value}`;
          const isChecked = currentValues.includes(option.value);
          const isDisabled = disabled || option.disabled;

          return (
            <div key={option.value} className="flex items-center">
              <input
                id={checkboxId}
                type="checkbox"
                checked={isChecked}
                onChange={() => handleChange(option.value)}
                disabled={isDisabled}
                aria-label={option.label}
                className="
                  w-4 h-4 border-gray-300 rounded
                  bg-white text-blue-600
                  dark:bg-gray-800 dark:border-gray-600 dark:text-blue-400
                  focus:ring-2 focus:ring-blue-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  cursor-pointer transition-colors duration-200
                "
              />
              <label
                htmlFor={checkboxId}
                className={`
                  ml-2 text-sm
                  ${
                    isDisabled
                      ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                      : 'text-gray-900 dark:text-white cursor-pointer'
                  }
                `}
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
};

Checkbox.displayName = 'Checkbox';
