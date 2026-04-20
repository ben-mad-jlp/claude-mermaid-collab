import { useAgentStore } from '../../stores/agentStore';

interface TrustedToolsDrawerProps {
  open: boolean;
  onClose: () => void;
  onRevoke: (tool: string) => void;
}

export function TrustedToolsDrawer({ open, onClose, onRevoke }: TrustedToolsDrawerProps) {
  const trustedTools = useAgentStore((s) => s.trustedTools);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Trusted tools"
      data-testid="trusted-tools-drawer"
      className="fixed top-0 right-0 h-full w-80 bg-white dark:bg-gray-900 shadow-lg border-l border-gray-200 dark:border-gray-700 z-50 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Trusted Tools (Session)
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trusted tools drawer"
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {trustedTools.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No tools trusted in this session.
          </p>
        ) : (
          <ul className="space-y-2">
            {trustedTools.map((tool) => (
              <li
                key={tool}
                className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800"
              >
                <span className="text-sm font-mono text-gray-800 dark:text-gray-200 truncate">
                  {tool}
                </span>
                <button
                  type="button"
                  onClick={() => onRevoke(tool)}
                  aria-label={`Revoke ${tool}`}
                  className="ml-2 text-xs px-2 py-0.5 rounded border border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TrustedToolsDrawer;
