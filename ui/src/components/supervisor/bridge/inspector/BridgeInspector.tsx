/**
 * BridgeInspector — the click-to destination for InflightPanel, ReadyPanel, StrandedPanel,
 * SubscribersPanel, and StreamTicker. Renders the selected epic's history or the selected
 * todo's worker lane + detail. Design constraint D3 (design doc option-C §4) forbids an
 * escalation preview here; escalations open the focal DecisionCard directly in BridgeDashboard.
 */

import React from 'react';
import { EpicHistoryView } from '../EpicHistoryView';
import { TodoWorkerPanel } from '../LaneCallout';
import { TodoDetailView } from '@/components/editors/TodoDetailView';

export interface InspectorEpicSelection {
  id: string;
  label: string;
}

export interface BridgeInspectorProps {
  /** Epic selection wins over todo selection (matches BridgeDashboard precedence). */
  selectedEpic?: InspectorEpicSelection | null;
  selectedTodoId?: string | null;
  project: string;
  serverScope: string;
}

export const BridgeInspector: React.FC<BridgeInspectorProps> = ({
  selectedEpic,
  selectedTodoId,
  project,
  serverScope,
}) => {
  return (
    <div data-testid="bridge-inspector" className="flex flex-col h-full min-h-0 overflow-y-auto">
      {selectedEpic ? (
        <div data-testid="inspector-epic">
          <EpicHistoryView
            epicId={selectedEpic.id}
            epicLabel={selectedEpic.label}
            serverScope={serverScope}
            project={project}
          />
        </div>
      ) : selectedTodoId ? (
        <div data-testid="inspector-todo">
          <TodoWorkerPanel todoId={selectedTodoId} project={project} serverId={serverScope} />
          <div className="p-3">
            <TodoDetailView todoId={selectedTodoId} />
          </div>
        </div>
      ) : (
        <p data-testid="inspector-empty" className="p-3 text-xs text-gray-400 dark:text-gray-500 italic">
          Nothing selected.
        </p>
      )}
    </div>
  );
};

export default BridgeInspector;
