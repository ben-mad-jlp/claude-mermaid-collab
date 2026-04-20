import React from 'react';

export function ChevronIcon({ isDown }: { isDown: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isDown ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );
}

export interface SectionBranchRowProps {
  id: string;
  title: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  level?: number;
}

export function SectionBranchRow({
  id,
  title,
  count,
  collapsed,
  onToggle,
  level = 0,
}: SectionBranchRowProps) {
  return (
    <div
      data-testid={`sidebar-section-${id}`}
      style={{ paddingLeft: `${level * 16}px` }}
      className="flex items-center gap-1.5 py-1 px-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none"
      onClick={onToggle}
    >
      <ChevronIcon isDown={!collapsed} />
      <span>{title}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-gray-400 dark:text-gray-500 font-normal">
          ({count})
        </span>
      )}
    </div>
  );
}

export default SectionBranchRow;
