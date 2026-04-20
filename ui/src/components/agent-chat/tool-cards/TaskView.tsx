import React from 'react';
import { useAgentStore, type AgentToolCallItem, type AgentTimelineItem } from '@/stores/agentStore';

interface TaskViewProps {
  item: AgentToolCallItem;
}

const MAX_PROMPT_CHARS = 400;

const TaskView: React.FC<TaskViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as {
    description?: string;
    prompt?: string;
    subagent_type?: string;
  };

  const nestedTurnIds = useAgentStore((s) => s.nestedTimelines[item.id]) ?? [];
  const timeline = useAgentStore((s) => s.timeline);

  const nestedEntries: AgentTimelineItem[] = React.useMemo(() => {
    if (nestedTurnIds.length === 0) return [];
    const set = new Set(nestedTurnIds);
    return timeline.filter((t) => {
      if (t.type === 'tool_call') return t.turnId !== undefined && set.has(t.turnId);
      if (t.type === 'message') return t.turnId !== undefined && set.has(t.turnId);
      if (t.type === 'permission') return set.has(t.turnId);
      return false;
    });
  }, [nestedTurnIds, timeline]);

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const promptExcerpt =
    prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) + '…' : prompt;

  return (
    <div data-testid="task-view">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {input.description ? (
          <>
            <div className="text-gray-500">description</div>
            <div className="text-gray-800 dark:text-gray-200">{input.description}</div>
          </>
        ) : null}
        {input.subagent_type ? (
          <>
            <div className="text-gray-500">subagent</div>
            <div className="font-mono text-gray-800 dark:text-gray-200">{input.subagent_type}</div>
          </>
        ) : null}
      </div>

      {promptExcerpt ? (
        <pre
          data-testid="task-prompt"
          className="mt-2 p-2 bg-gray-900 text-gray-100 rounded text-[11px] leading-4 font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-40 overflow-y-auto"
        >
          {promptExcerpt}
        </pre>
      ) : null}

      <div className="mt-3 border-l-2 border-gray-300 dark:border-gray-600 pl-3">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
          Subagent timeline
        </div>
        {nestedEntries.length === 0 ? (
          <div
            data-testid="task-spinner"
            className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
          >
            <span
              className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"
              role="status"
              aria-label="Running subagent"
            />
            <span>Running subagent…</span>
          </div>
        ) : (
          <ul data-testid="task-nested-list" className="space-y-1">
            {nestedEntries.map((entry) => {
              if (entry.type === 'tool_call') {
                return (
                  <li
                    key={entry.id}
                    data-testid="task-nested-entry"
                    className="text-xs flex items-center gap-2"
                  >
                    <span className="font-mono text-gray-800 dark:text-gray-200">{entry.name}</span>
                    <span className="text-[10px] text-gray-500">{entry.status}</span>
                  </li>
                );
              }
              if (entry.type === 'message') {
                return (
                  <li
                    key={entry.id}
                    data-testid="task-nested-entry"
                    className="text-xs text-gray-700 dark:text-gray-300 truncate"
                  >
                    <span className="text-[10px] text-gray-500 mr-1">{entry.role}:</span>
                    {entry.text}
                  </li>
                );
              }
              return (
                <li
                  key={entry.id}
                  data-testid="task-nested-entry"
                  className="text-xs text-gray-700 dark:text-gray-300"
                >
                  <span className="text-[10px] text-gray-500 mr-1">permission:</span>
                  {entry.name}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TaskView;
