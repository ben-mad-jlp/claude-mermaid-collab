import { useEffect, useId, useState } from 'react';
import { PermissionRulesEditor } from './PermissionRulesEditor';
import { EnvVarsEditor } from './EnvVarsEditor';
import { McpServersPanel } from '../mcp/McpServersPanel';
import { AddMcpServerDialog } from '../mcp/AddMcpServerDialog';

export type SettingsTab = 'permissions' | 'mcp' | 'env' | 'policy';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  openTab?: SettingsTab;
  project?: string;
}

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'permissions', label: 'Permissions' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'env', label: 'Env Vars' },
  { id: 'policy', label: 'Managed Policy' },
];

export function SettingsPanel({ open, onClose, openTab, project }: SettingsPanelProps) {
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<SettingsTab>(openTab ?? 'permissions');
  const [addMcpOpen, setAddMcpOpen] = useState(false);

  useEffect(() => {
    if (open && openTab) setActiveTab(openTab);
  }, [open, openTab]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-xl bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 5L5 15M5 5l10 10" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div role="tablist" className="flex gap-1 px-6 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 pb-3 pt-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'permissions' && <PermissionRulesEditor />}
          {activeTab === 'mcp' && (
            <McpServersPanel onAdd={() => setAddMcpOpen(true)} />
          )}
          {activeTab === 'env' && (
            <EnvVarsEditor project={project ?? window.location.pathname} />
          )}
          {activeTab === 'policy' && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
              Managed Policy — coming soon
            </div>
          )}
        </div>
      </div>

      {/* Add MCP server dialog — rendered outside the slide-over so z-index stacks correctly */}
      <AddMcpServerDialog
        open={addMcpOpen}
        onClose={() => setAddMcpOpen(false)}
        onSuccess={() => setAddMcpOpen(false)}
      />
    </>
  );
}

export default SettingsPanel;
