import React, { useId, useState } from 'react';

export interface SliderProps {
  onChange?: (value: number) => void;
  value?: number;
  name?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  ariaLabel?: string;
}

export const Slider: React.FC<SliderProps> = ({
  onChange,
  value: controlledValue,
  name,
  label,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  showValue = false,
  ariaLabel,
}) => {
  const id = useId();
  const sliderId = `${id}-slider`;
  const [internalValue, setInternalValue] = useState(controlledValue ?? min);

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;
  const percentage = ((currentValue - min) / (max - min)) * 100;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const numValue = parseFloat(e.target.value);
    setInternalValue(numValue);
    onChange?.(numValue);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {(label || showValue) && (
        <div className="flex justify-between items-center">
          {label && (
            <label
              htmlFor={sliderId}
              className="block text-sm font-medium text-gray-900 dark:text-white"
            >
              {label}
            </label>
          )}
          {showValue && (
            <span className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
              {currentValue}
            </span>
          )}
        </div>
      )}

      <div className="relative w-full">
        {/* Hidden input for form data collection */}
        <input
          type="hidden"
          name={name}
          value={currentValue}
        />

        {/* Range input */}
        <input
          id={sliderId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          disabled={disabled}
          aria-label={ariaLabel || label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentValue}
          className={`
            w-full h-2 rounded-lg appearance-none cursor-pointer
            bg-gray-200 dark:bg-gray-700
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2

            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-blue-600
            [&::-webkit-slider-thumb]:dark:bg-blue-500
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-webkit-slider-thumb]:disabled:cursor-not-allowed

            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-blue-600
            [&::-moz-range-thumb]:dark:bg-blue-500
            [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:cursor-pointer
            [&::-moz-range-thumb]:transition-transform
            [&::-moz-range-thumb]:hover:scale-110
          `}
          style={{
            background: disabled
              ? undefined
              : `linear-gradient(to right, rgb(37 99 235) ${percentage}%, rgb(229 231 235) ${percentage}%)`,
          }}
        />
      </div>

      {/* Min/Max labels */}
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
};

Slider.displayName = 'Slider';
