import React from 'react';

export interface BadgeProps {
  text: string;
  variant?: 'default' | 'info' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const variantClasses = {
  default: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
  lg: 'px-3 py-1 text-base',
};

export const Badge: React.FC<BadgeProps> = ({
  text,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  return (
    <span
      className={`
        inline-flex items-center justify-center
        font-medium rounded-full
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {text}
    </span>
  );
};

Badge.displayName = 'Badge';
