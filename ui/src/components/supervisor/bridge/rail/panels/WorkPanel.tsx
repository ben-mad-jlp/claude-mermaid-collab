import React, { useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { InflightPanel } from '../../InflightPanel';
import { ReadyPanel } from '../../ReadyPanel';

export type WorkTab = 'inflight' | 'ready';

export interface WorkPanelProps {
  todos: SessionTodo[];
  project: string;
  serverScope: string;
  claimableIds?: string[] | null;
  onJump?: (project: string, session: string) => void;
  onSelectTodo?: (todo: SessionTodo) => void;
  /** Uncontrolled default; controlled `tab`/`onTabChange` optional. */
  defaultTab?: WorkTab;
  tab?: WorkTab;
  onTabChange?: (t: WorkTab) => void;
}

export const WorkPanel: React.FC<WorkPanelProps> = ({
  todos,
  project,
  serverScope,
  claimableIds,
  onJump,
  onSelectTodo,
  defaultTab = 'inflight',
  tab: controlledTab,
  onTabChange,
}) => {
  const [inner, setInner] = useState<WorkTab>(defaultTab);
  const active = controlledTab !== undefined ? controlledTab : inner;

  const handleTabChange = (t: WorkTab) => {
    setInner(t);
    onTabChange?.(t);
  };

  return (
    <div data-testid="work-panel" className="flex flex-col min-h-0">
      <div data-testid="work-panel-tabs" role="tablist" className="flex border-b border-gray-200 dark:border-gray-700">
        {(['inflight', 'ready'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            data-testid={`work-tab-${k}`}
            data-active={active === k}
            aria-selected={active === k}
            onClick={() => handleTabChange(k)}
            className="px-3 py-2 text-2xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 data-[active=true]:bg-accent-50 dark:data-[active=true]:bg-accent-900/30 data-[active=true]:text-accent-700 dark:data-[active=true]:text-accent-300 transition-colors"
          >
            {k === 'inflight' ? 'In-flight' : 'Ready'}
          </button>
        ))}
      </div>

      <div data-testid="work-panel-body" className="flex-1 min-h-0 overflow-y-auto">
        {active === 'inflight' && (
          <div className="p-2">
            <InflightPanel
              todos={todos}
              project={project}
              serverScope={serverScope}
              onJump={onJump}
              onSelectTodo={onSelectTodo}
            />
          </div>
        )}
        {active === 'ready' && (
          <ReadyPanel
            todos={todos}
            claimableIds={claimableIds ?? null}
            onSelectTodo={onSelectTodo}
          />
        )}
      </div>
    </div>
  );
};

export default WorkPanel;
