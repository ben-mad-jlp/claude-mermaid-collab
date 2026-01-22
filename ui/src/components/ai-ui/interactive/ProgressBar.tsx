import React from 'react';

export interface ProgressBarProps {
  value?: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  indeterminate?: boolean;
  color?: 'success' | 'warning' | 'error' | 'info';
  striped?: boolean;
  animated?: boolean;
  className?: string;
}

/**
 * ProgressBar Component
 * Visual representation of progress with multiple display options
 *
 * Features:
 * - Determinate and indeterminate modes
 * - Multiple color variants
 * - Optional percentage display
 * - Striped and animated effects
 * - Dark mode support
 * - Accessible with ARIA attributes
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value = 0,
  max = 100,
  label,
  showPercentage = false,
  indeterminate = false,
  color = 'info',
  striped = false,
  animated = false,
  className = '',
}) => {
  // Ensure value is within bounds
  const normalizedValue = Math.min(Math.max(value, 0), max);
  const percentage = (normalizedValue / max) * 100;

  // Determine color classes
  const colorClasses: Record<typeof color, string> = {
    success:
      'bg-green-500 dark:bg-green-600',
    warning:
      'bg-yellow-500 dark:bg-yellow-600',
    error:
      'bg-red-500 dark:bg-red-600',
    info:
      'bg-blue-500 dark:bg-blue-600',
  };

  const barColorClass = colorClasses[color];

  // Stripe pattern for striped mode
  const stripedClass = striped ? 'bg-gradient-to-r from-transparent via-white/30 to-transparent bg-[length:30px_100%]' : '';
  const animatedClass = animated ? 'animate-pulse' : '';

  return (
    <div className={`progress-bar w-full ${className}`}>
      {/* Header with label and percentage */}
      {(label || showPercentage) && (
        <div className="flex justify-between items-center mb-2">
          {label && (
            <label className="text-sm font-medium text-gray-900 dark:text-white">
              {label}
            </label>
          )}
          {showPercentage && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}

      {/* Progress Bar Container */}
      <div
        className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        role={indeterminate ? 'progressbar' : 'progressbar'}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={indeterminate ? undefined : normalizedValue}
        aria-label={label}
      >
        {indeterminate ? (
          /* Indeterminate Progress Bar */
          <div
            className={`h-full ${barColorClass} ${stripedClass} animate-indeterminate`}
            style={{
              animation: 'indeterminate 1.5s ease-in-out infinite',
            }}
          />
        ) : (
          /* Determinate Progress Bar */
          <div
            className={`h-full ${barColorClass} ${stripedClass} ${animatedClass} transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>

      {/* Optional Value Display Below */}
      {showPercentage && (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
          {normalizedValue} / {max}
        </div>
      )}

      <style>{`
        @keyframes indeterminate {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
};

export default ProgressBar;
