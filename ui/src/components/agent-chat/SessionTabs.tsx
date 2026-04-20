import { useAgentStore } from '../../stores/agentStore';

interface SessionTabsProps {
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
}

export function SessionTabs({ onSelect, onClose }: SessionTabsProps) {
  const multiSession = useAgentStore((s) => s.multiSession);
  const { activeSessionId, sessions } = multiSession;
  const entries = Object.entries(sessions);

  if (entries.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Agent sessions"
      className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1 overflow-x-auto"
      data-testid="session-tabs"
    >
      {entries.map(([id, s]) => {
        const isActive = id === activeSessionId;
        const showBadge = !isActive && s.unread > 0;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={isActive}
            data-testid={`session-tab-${id}`}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onSelect?.(id)}
            className={
              'relative flex items-center gap-2 rounded-t px-3 py-1 text-sm cursor-pointer select-none ' +
              (isActive
                ? 'bg-white border border-b-0 border-gray-200 font-medium'
                : 'text-gray-600 hover:bg-gray-100')
            }
          >
            <span className="truncate max-w-[140px]">{s.name}</span>
            {showBadge && (
              <span
                data-testid={`session-tab-unread-${id}`}
                aria-label={`${s.unread} unread`}
                className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-none"
              >
                {s.unread}
              </span>
            )}
            {onClose && (
              <button
                type="button"
                aria-label={`Close ${s.name}`}
                data-testid={`session-tab-close-${id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
                className="text-gray-400 hover:text-gray-700 text-xs"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default SessionTabs;
