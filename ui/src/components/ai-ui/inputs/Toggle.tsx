import React, { useId, useState } from 'react';

export interface ToggleProps {
  onChange?: (checked: boolean) => void;
  checked?: boolean;
  name?: string;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
}

const sizeClasses = {
  sm: {
    track: 'w-8 h-4',
    knob: 'w-3 h-3',
    translate: 'translate-x-4',
  },
  md: {
    track: 'w-11 h-6',
    knob: 'w-5 h-5',
    translate: 'translate-x-5',
  },
  lg: {
    track: 'w-14 h-7',
    knob: 'w-6 h-6',
    translate: 'translate-x-7',
  },
};

export const Toggle: React.FC<ToggleProps> = ({
  onChange,
  checked: controlledChecked,
  name,
  label,
  disabled = false,
  size = 'md',
  ariaLabel,
}) => {
  const id = useId();
  const toggleId = `${id}-toggle`;
  const [internalChecked, setInternalChecked] = useState(controlledChecked || false);

  const currentChecked = controlledChecked !== undefined ? controlledChecked : internalChecked;
  const sizes = sizeClasses[size];

  const handleToggle = () => {
    if (disabled) return;
    const newValue = !currentChecked;
    setInternalChecked(newValue);
    onChange?.(newValue);
  };

  return (
    <div className="flex items-center gap-3">
      {/* Hidden checkbox for form data collection */}
      <input
        type="checkbox"
        id={toggleId}
        name={name}
        checked={currentChecked}
        onChange={handleToggle}
        disabled={disabled}
        className="sr-only"
        aria-label={ariaLabel || label}
      />

      {/* Toggle track */}
      <button
        type="button"
        role="switch"
        aria-checked={currentChecked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={handleToggle}
        className={`
          relative inline-flex shrink-0 cursor-pointer rounded-full
          transition-colors duration-200 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          ${sizes.track}
          ${currentChecked
            ? 'bg-blue-600 dark:bg-blue-500'
            : 'bg-gray-200 dark:bg-gray-700'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {/* Toggle knob */}
        <span
          className={`
            pointer-events-none inline-block rounded-full
            bg-white shadow-lg ring-0
            transition-transform duration-200 ease-in-out
            ${sizes.knob}
            ${currentChecked ? sizes.translate : 'translate-x-0.5'}
            mt-0.5
          `}
        />
      </button>

      {label && (
        <label
          htmlFor={toggleId}
          className={`
            text-sm text-gray-900 dark:text-white cursor-pointer
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {label}
        </label>
      )}
    </div>
  );
};

Toggle.displayName = 'Toggle';
