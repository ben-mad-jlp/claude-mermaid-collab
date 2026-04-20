import React from 'react';
import type { TabDescriptor } from '../../../stores/tabsStore';

/**
 * Get icon for tab type — covers artifact types plus non-artifact kinds
 * like 'blueprint', 'code-file', 'task-graph', 'task-details'.
 */
function getItemIcon(type: string): React.ReactNode {
  if (type === 'diagram') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" />
      </svg>
    );
  }
  if (type === 'design') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    );
  }
  if (type === 'spreadsheet') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </svg>
    );
  }
  if (type === 'snippet') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  if (type === 'embed') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
      </svg>
    );
  }
  if (type === 'image') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  if (type === 'blueprint') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 3v18M15 9v12" />
      </svg>
    );
  }
  if (type === 'code-file') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <polyline points="10 13 8 15 10 17" />
        <polyline points="14 13 16 15 14 17" />
      </svg>
    );
  }
  if (type === 'task-graph') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 6h8M7 8l4 8M17 8l-4 8" />
      </svg>
    );
  }
  if (type === 'task-details') {
    return (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9h10M7 13h10M7 17h6" />
      </svg>
    );
  }
  // Default document icon — also used for 'document' kind
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9 12h6M9 16h6M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

export interface TabProps {
  tab: TabDescriptor;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTogglePin?: () => void;
  onPromote?: () => void;
  hideClose?: boolean;
}

export const Tab: React.FC<TabProps> = ({
  tab,
  isActive,
  onClick,
  onClose,
  onContextMenu,
  onTogglePin,
  onPromote,
  hideClose,
}) => {
  const iconType =
    tab.kind === 'artifact' ? tab.artifactType ?? 'document' : tab.kind;

  const baseClasses =
    'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer select-none border-r border-gray-200 dark:border-gray-700 min-w-[120px] max-w-[200px]';
  const stateClasses = isActive
    ? 'bg-accent-100 dark:bg-accent-900 border-b-2 border-accent-700'
    : 'hover:bg-gray-100 dark:hover:bg-gray-800 border-b-2 border-transparent';

  return (
    <div
      role="tab"
      className={`group ${baseClasses} ${stateClasses}`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      <span className="flex-shrink-0">{getItemIcon(iconType)}</span>
      <span className={`truncate flex-1 ${tab.isPreview ? 'italic' : ''}`}>
        {tab.name}
      </span>
      {tab.isPreview && onPromote && (
        <button
          aria-label="Make permanent"
          title="Make permanent"
          className="ml-1 p-0.5 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-accent-500 dark:text-gray-500 dark:hover:text-accent-400 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onPromote();
          }}
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      {!tab.isPreview && onTogglePin && (
        <button
          aria-label={tab.isPinned ? 'Unpin tab' : 'Pin tab'}
          title={tab.isPinned ? 'Unpin tab' : 'Pin tab'}
          className={`ml-1 p-0.5 rounded flex-shrink-0 transition-all ${
            tab.isPinned
              ? 'opacity-100 text-accent-500 dark:text-accent-400 hover:text-accent-600'
              : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-accent-500 dark:text-gray-500 dark:hover:text-accent-400'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill={tab.isPinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        </button>
      )}
      {!hideClose && (
        <button
          aria-label="Close tab"
          className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

Tab.displayName = 'Tab';

export default Tab;
