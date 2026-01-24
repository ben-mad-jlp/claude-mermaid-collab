import React, { useId, useState, useEffect } from 'react';
import './Dropdown.css';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  name: string;
  label?: string;
  options: DropdownOption[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  name,
  label,
  options,
  placeholder = 'Select an option',
  required = false,
  defaultValue,
  onChange,
  disabled = false,
  ariaLabel,
  ariaDescribedBy,
}) => {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = ariaDescribedBy || `${id}-description`;
  const [internalValue, setInternalValue] = useState(defaultValue || '');

  // Update internal value when defaultValue prop changes
  useEffect(() => {
    setInternalValue(defaultValue || '');
  }, [defaultValue]);

  const currentValue = internalValue;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    setInternalValue(newValue);
    onChange?.(newValue);
  };

  return (
    <div className="dropdown-field">
      {label && (
        <label
          id={labelId}
          htmlFor={id}
          className="dropdown-label"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        name={name}
        value={currentValue}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel || label}
        aria-describedby={ariaDescribedBy ? descriptionId : undefined}
        data-value={currentValue}
        className="dropdown-select"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

Dropdown.displayName = 'Dropdown';
