import React, { useMemo } from 'react';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { MermaidPreview } from '@/components/editors/MermaidPreview';
import { systemToMermaid } from './systemToMermaid';
import { deriveSystemNodes } from './systemNodes';

export interface SystemMapPanelProps {
  serverId: string;
  project: string;
  /** Open a session's tmux (same handler SupervisorView passes to other panels). */
  onJump?: (project: string, session: string) => void;
}

function projectBasename(project: string): string {
  return project.split('/').filter(Boolean).pop() ?? project;
}

/**
 * System Map (PCS Phase 6): live orchestration graph (Supervisor → Workers,
 * colored by status). Click a node → open its tmux. Derives nodes from the
 * supervisor config + supervised set + live subscription statuses + escalations.
 */
export const SystemMapPanel: React.FC<SystemMapPanelProps> = ({ project, onJump }) => {
  const config = useSupervisorStore((s) => s.config);
  const supervised = useSupervisorStore((s) => s.supervised);
  const escalations = useSupervisorStore((s) => s.escalations);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  const { mermaid, nodeSessionMap, count } = useMemo(() => {
    const nodes = deriveSystemNodes({
      config,
      supervised,
      subscriptions: Object.values(subscriptions),
      escalations,
      project,
    });
    const { mermaid, nodeSessionMap } = systemToMermaid(nodes);
    return { mermaid, nodeSessionMap, count: nodes.length };
  }, [config, supervised, escalations, subscriptions, project]);

  return (
    <div className="flex flex-col h-full border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            System Map
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
            · {projectBasename(project)}
          </span>
        </div>
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">click a node → open tmux</span>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {count === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              No supervised sessions to map for this project.
            </p>
          </div>
        ) : (
          <div className="h-full min-h-[200px]">
            <MermaidPreview
              content={mermaid}
              hideEditToggle
              className="h-full"
              onNodeClickWithPosition={(nodeId) => {
                const session = nodeSessionMap[nodeId];
                if (session) onJump?.(project, session);
              }}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
        {count} node{count === 1 ? '' : 's'}
      </div>
    </div>
  );
};

export default SystemMapPanel;
