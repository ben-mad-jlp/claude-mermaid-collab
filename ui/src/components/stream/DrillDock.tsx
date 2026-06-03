/**
 * DrillDock — the Bridge's right-side router (Control-UI vision §6).
 *
 * A stream row, a KPI tile, a worker card, or a funnel segment opens the
 * matching EXISTING panel here while the stream keeps flowing on the left:
 *   escalation → EscalationInbox
 *   todo       → TodoDetailView
 *   worker     → WorkerDetail
 *   funnel     → the segment's filtered todo list
 * SystemMapPanel + TracePanel ride along as secondary dock tabs — the only
 * fleet "map" surfaces in the Bridge.
 */

import React, { useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';
import { EscalationInbox } from '@/components/supervisor/EscalationInbox';
import TodoDetailView from '@/components/editors/TodoDetailView';
import SystemMapPanel from '@/components/supervisor/SystemMapPanel';
import TracePanel from '@/components/supervisor/TracePanel';
import { WorkerDetail } from './WorkerDetail';
import { FUNNEL_SEGMENTS, todosInSegment, type FunnelKey } from '@/components/supervisor/bridge/funnel';

interface SubLike {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

export type DrillTarget =
  | { kind: 'escalation' }
  | { kind: 'todo'; todoId: string }
  | { kind: 'worker'; session: string }
  | { kind: 'funnel'; segment: FunnelKey };

type DockTab = 'focus' | 'map' | 'trace';

export interface DrillDockProps {
  target: DrillTarget | null;
  serverScope: string;
  project: string;
  subscriptions: SubLike[];
  todos: SessionTodo[];
  onJump?: (project: string, session: string) => void;
  onClose: () => void;
}

function focusTitle(target: DrillTarget | null): string {
  if (!target) return 'Focus';
  switch (target.kind) {
    case 'escalation':
      return 'Escalation Inbox';
    case 'todo':
      return 'Todo';
    case 'worker':
      return `Worker · ${target.session}`;
    case 'funnel':
      return `${FUNNEL_SEGMENTS.find((s) => s.key === target.segment)?.label ?? 'Stage'}`;
  }
}

const FocusView: React.FC<{
  target: DrillTarget | null;
  serverScope: string;
  subscriptions: SubLike[];
  todos: SessionTodo[];
  onJump?: (project: string, session: string) => void;
}> = ({ target, serverScope, subscriptions, todos, onJump }) => {
  if (!target) {
    return (
      <p className="p-3 text-2xs text-gray-400 dark:text-gray-500 italic">
        Select a stream row, worker, or funnel stage to drill in.
      </p>
    );
  }
  switch (target.kind) {
    case 'escalation':
      return <EscalationInbox serverId={serverScope} onJump={onJump} />;
    case 'todo':
      return <TodoDetailView todoId={target.todoId} />;
    case 'worker':
      return (
        <WorkerDetail
          session={target.session}
          subscriptions={subscriptions}
          todos={todos}
          onJump={onJump}
        />
      );
    case 'funnel': {
      const list = todosInSegment(todos, target.segment);
      return (
        <div className="p-2 space-y-1">
          {list.length === 0 ? (
            <p className="text-2xs text-gray-400 dark:text-gray-500 italic">No todos in this stage.</p>
          ) : (
            list.map((t) => (
              <div
                key={t.id}
                className="px-2 py-1 rounded border border-gray-100 dark:border-gray-800 text-2xs text-gray-700 dark:text-gray-200"
              >
                {t.title}
              </div>
            ))
          )}
        </div>
      );
    }
  }
};

export const DrillDock: React.FC<DrillDockProps> = ({
  target,
  serverScope,
  project,
  subscriptions,
  todos,
  onJump,
  onClose,
}) => {
  const [tab, setTab] = useState<DockTab>('focus');

  const tabs: { key: DockTab; label: string }[] = [
    { key: 'focus', label: 'Focus' },
    { key: 'map', label: 'Map' },
    { key: 'trace', label: 'Trace' },
  ];

  return (
    <aside
      data-testid="drill-dock"
      className="w-80 shrink-0 h-full flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
    >
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`dock-tab-${t.key}`}
            className={`px-2 py-0.5 text-2xs font-medium rounded transition-colors ${
              tab === t.key
                ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-800 dark:text-accent-200'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          data-testid="dock-close"
          className="ml-auto px-1.5 py-0.5 text-2xs rounded text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Close dock"
        >
          ✕
        </button>
      </div>

      {tab === 'focus' && (
        <div className="px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
          {focusTitle(target)}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'focus' && (
          <FocusView
            target={target}
            serverScope={serverScope}
            subscriptions={subscriptions}
            todos={todos}
            onJump={onJump}
          />
        )}
        {tab === 'map' && <SystemMapPanel serverId={serverScope} project={project} onJump={onJump} />}
        {tab === 'trace' && <TracePanel serverId={serverScope} project={project} />}
      </div>
    </aside>
  );
};

export default DrillDock;
