import React from 'react';
import { PlanPanel } from '@/components/supervisor/PlanPanel';
import { StreamTicker } from '../StreamTicker';
import type { RailKey } from '../rail/RailNav';
import type { SessionTodo } from '@/types/sessionTodo';
import type { StreamEvent } from '@/lib/eventTaxonomy';

export interface BridgeStageProps {
  serverId: string;
  project: string;
  /** Fleet events — feed the collapsed ticker pinned to the stage's bottom edge. */
  events: StreamEvent[];
  activePanel?: React.ReactNode;
  onSelectTodo?: (todo: SessionTodo) => void;
  onSelectEpic?: (epic: { id: string; label: string }) => void;
  /** Clicking the ticker expands it: select the Stream rail panel. */
  onSelectRailPanel?: (key: RailKey) => void;
  titleByTodoId?: Map<string, string>;
}

export const BridgeStage: React.FC<BridgeStageProps> = ({
  serverId,
  project,
  events,
  activePanel,
  onSelectTodo,
  onSelectEpic,
  onSelectRailPanel,
  titleByTodoId,
}) => {
  return (
    <section data-testid="bridge-stage" className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-hidden">
        {activePanel ?? (
          <PlanPanel
            serverId={serverId}
            project={project}
            onSelectTodo={onSelectTodo}
            onSelectEpic={onSelectEpic}
          />
        )}
      </div>
      <button
        type="button"
        data-testid="bridge-stage-ticker"
        aria-label="Expand stream"
        onClick={() => onSelectRailPanel?.('stream')}
        className="shrink-0 w-full text-left border-t border-gray-200 dark:border-gray-700
                   hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <StreamTicker
          events={events}
          collapsed
          titleByTodoId={titleByTodoId}
        />
      </button>
    </section>
  );
};

export default BridgeStage;
