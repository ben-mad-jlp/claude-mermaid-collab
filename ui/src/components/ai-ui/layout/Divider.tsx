import React from 'react';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  label?: string;
  className?: string;
}

export const Divider: React.FC<DividerProps> = ({
  orientation = 'horizontal',
  label,
  className = '',
}) => {
  if (orientation === 'vertical') {
    if (label) {
      return (
        <div
          role="separator"
          aria-orientation="vertical"
          className={`inline-flex flex-col items-center h-full ${className}`}
        >
          <span className="flex-1 w-px bg-gray-200 dark:bg-gray-700" />
          <span className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap -rotate-90">
            {label}
          </span>
          <span className="flex-1 w-px bg-gray-200 dark:bg-gray-700" />
        </div>
      );
    }

    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={`w-px h-full bg-gray-200 dark:bg-gray-700 ${className}`}
      />
    );
  }

  // Horizontal orientation
  if (label) {
    return (
      <div
        role="separator"
        aria-orientation="horizontal"
        className={`flex items-center w-full ${className}`}
      >
        <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="px-3 text-sm text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <span className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>
    );
  }

  return (
    <hr
      role="separator"
      aria-orientation="horizontal"
      className={`w-full border-t border-gray-200 dark:border-gray-700 ${className}`}
    />
  );
};

Divider.displayName = 'Divider';
