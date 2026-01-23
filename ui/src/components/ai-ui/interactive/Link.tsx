import React from 'react';

export interface LinkProps {
  href?: string;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'subtle';
  disabled?: boolean;
  external?: boolean;
  className?: string;
}

const variantClasses = {
  default: 'text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300',
  primary: 'text-blue-600 hover:underline font-medium dark:text-blue-400',
  subtle: 'text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
};

export const Link: React.FC<LinkProps> = ({
  href,
  label,
  onClick,
  variant = 'default',
  disabled = false,
  external = false,
  className = '',
}) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <a
      href={href || '#'}
      onClick={handleClick}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-disabled={disabled}
      className={`
        inline-flex items-center gap-1
        transition-colors duration-150
        ${variantClasses[variant]}
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
        ${className}
      `}
    >
      <span>{label}</span>

      {external && (
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      )}
    </a>
  );
};

Link.displayName = 'Link';
