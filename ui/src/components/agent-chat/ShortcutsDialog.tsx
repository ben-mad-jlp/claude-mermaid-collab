import { useEffect, useId } from 'react';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: '↑ / ↓', action: 'Navigate composer history (at edge)' },
  { key: 'Ctrl+R', action: 'Search prompt history' },
  { key: 'Ctrl+E', action: 'Open in external editor' },
  { key: 'Esc Esc', action: 'Rewind to message picker' },
  { key: 'Tab', action: 'Accept inline suggestion' },
  { key: '?', action: 'Show/hide shortcuts' },
] as const;

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={onClose}
        aria-hidden="true"
        data-testid="shortcuts-dialog-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      >
        <div
          className="relative pointer-events-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-w-lg w-full mx-4 p-6"
          data-testid="shortcuts-dialog"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
              Keyboard Shortcuts
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close shortcuts dialog"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 font-medium w-36">Key</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map(({ key, action }) => (
                <tr key={key} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <td className="py-2 pr-4">
                    <kbd className="inline-flex items-center rounded border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-xs font-mono text-gray-700 dark:text-gray-300">
                      {key}
                    </kbd>
                  </td>
                  <td className="py-2 text-gray-700 dark:text-gray-300">{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
