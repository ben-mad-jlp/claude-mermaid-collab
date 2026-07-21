import React from 'react';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';
import { BridgeEscalationInbox } from '@/components/supervisor/bridge/BridgeEscalationInbox';

interface OpsEscalationGroupsProps {
  escalations: Escalation[];
  serverScope: string;
}

export const OpsEscalationGroups: React.FC<OpsEscalationGroupsProps> = ({
  escalations,
  serverScope,
}) => {
  const { resetTodo, overrideAcceptTodo, resolveBudgetCap } = useSupervisorStore();

  const landReady = escalations.filter((e) => e.kind === 'epic-ready-to-land');
  const poisonOrReserve = escalations.filter(
    (e) => e.kind === 'poison-loop-cap' || e.kind === 'reserve-leaf'
  );
  const tokenBurn = escalations.filter((e) => e.kind === 'token-burn');
  const other = escalations.filter(
    (e) =>
      e.kind !== 'epic-ready-to-land' &&
      e.kind !== 'poison-loop-cap' &&
      e.kind !== 'reserve-leaf' &&
      e.kind !== 'token-burn'
  );

  const renderGroup = (title: string, items: Escalation[], content: React.ReactNode) => {
    if (items.length === 0) return null;
    return (
      <div key={title} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs">
          <span className="font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {title}
          </span>
          <span className="text-gray-600 dark:text-gray-300 font-medium">{items.length}</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">{content}</div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {renderGroup(
        'Ready to Land',
        landReady,
        <BridgeEscalationInbox
          bare
          escalations={landReady}
          serverScope={serverScope}
          variant="land"
        />
      )}

      {renderGroup(
        'Poison Loop / Reserve',
        poisonOrReserve,
        <div className="space-y-2">
          {poisonOrReserve.map((e) => (
            <div
              key={e.id}
              className="p-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
            >
              <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">{e.questionText}</p>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    resetTodo(serverScope, e.project, e.todoId!, 'ready', {
                      escalationId: e.id,
                    })
                  }
                  disabled={!e.todoId}
                  className="flex-1 px-2 py-1 text-xs font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset to ready
                </button>
                <button
                  onClick={() =>
                    overrideAcceptTodo(serverScope, e.project, e.todoId!, 'operator', {
                      escalationId: e.id,
                    })
                  }
                  disabled={!e.todoId}
                  className="flex-1 px-2 py-1 text-xs font-medium rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Override accept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {renderGroup(
        'Token Burn',
        tokenBurn,
        <div className="space-y-2">
          {tokenBurn.map((e) => (
            <div
              key={e.id}
              className="p-3 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
            >
              <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">{e.questionText}</p>
              <button
                onClick={() => resolveBudgetCap(serverScope, e.id)}
                className="w-full px-2 py-1 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60"
              >
                Acknowledge
              </button>
            </div>
          ))}
        </div>
      )}

      {renderGroup(
        'Other Escalations',
        other,
        <BridgeEscalationInbox
          bare
          escalations={other}
          serverScope={serverScope}
          variant="escalation"
        />
      )}
    </div>
  );
};
