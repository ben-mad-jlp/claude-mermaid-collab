import React from 'react';

export interface ModeSliderOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export interface ModeSliderProps<T extends string> {
  options: ModeSliderOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Accent tint for the sliding thumb when not at an "off" stop. */
  accent?: 'info' | 'success';
  'data-testid'?: string;
}

/**
 * ModeSlider — a compact segmented slider for a small set of discrete modes
 * (e.g. steward off/auto/dogfood, supervisor off/on). A pill track with a
 * sliding thumb that snaps to the selected stop; each stop is a clickable label.
 * The thumb greys out at the first ("off") stop and takes the accent tint
 * otherwise, so the on/off sense reads at a glance.
 */
export function ModeSlider<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  accent = 'info',
  ...rest
}: ModeSliderProps<T>) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  const isOff = idx === 0;
  const accentBg = accent === 'success' ? 'bg-success-500' : 'bg-info-600';
  return (
    <div
      data-testid={rest['data-testid']}
      role="radiogroup"
      className={`relative flex w-full select-none rounded-full bg-gray-200 dark:bg-gray-700 p-0.5 ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      {/* Sliding thumb */}
      <span
        aria-hidden="true"
        className={`absolute top-0.5 bottom-0.5 rounded-full shadow-sm transition-transform duration-150 ${
          isOff ? 'bg-gray-400 dark:bg-gray-500' : accentBg
        }`}
        style={{
          width: `calc((100% - 0.25rem) / ${n})`,
          transform: `translateX(${idx * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => !active && onChange(o.value)}
            className={`relative z-10 flex-1 px-2 py-0.5 text-2xs font-semibold rounded-full transition-colors capitalize ${
              active ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default ModeSlider;
