import * as React from 'react';
import { useAgentStore, type AgentToolCallItem, type AgentTimelineItem } from '@/stores/agentStore';
import { Spinner } from '../../ui/spinner';

export interface TaskViewProps {
  item: AgentToolCallItem;
}

const MAX_PROMPT_CHARS = 400;

export const TaskView: React.FC<TaskViewProps> = ({ item }) => {
  const input = (item.input ?? {}) as {
    description?: string;
    prompt?: string;
    subagent_type?: string;
  };

  // Nested tool_calls carry `parentTurnId` pointing at this Task's turnId.
  // (Historic sub_agent_turn events also populate `nestedTimelines`; we
  // still honor those for back-compat with replayed sessions.)
  const taskTurnId = item.turnId ?? '';
  const nestedTurnIds = useAgentStore((s) => s.nestedTimelines[taskTurnId]) ?? [];
  const timeline = useAgentStore((s) => s.timeline);

  const nestedEntries: AgentTimelineItem[] = React.useMemo(() => {
    const nestedSet = new Set(nestedTurnIds);
    return timeline.filter((t) => {
      // Skip the Task tool_call itself.
      if (t.type === 'tool_call' && t.id === item.id) return false;
      if (t.type === 'tool_call') {
        if (t.parentTurnId && t.parentTurnId === taskTurnId) return true;
        if (t.turnId !== undefined && nestedSet.has(t.turnId)) return true;
        return false;
      }
      if (t.type === 'message') {
        return t.turnId !== undefined && nestedSet.has(t.turnId);
      }
      if (t.type === 'permission') {
        return nestedSet.has(t.turnId);
      }
      return false;
    });
  }, [nestedTurnIds, timeline, item.id, taskTurnId]);

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const promptExcerpt =
    prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) + '…' : prompt;

  return (
    <div data-testid="task-view">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {input.description ? (
          <>
            <div className="text-muted-foreground">description</div>
            <div className="text-foreground">{input.description}</div>
          </>
        ) : null}
        {input.subagent_type ? (
          <>
            <div className="text-muted-foreground">subagent</div>
            <div className="font-mono text-foreground">{input.subagent_type}</div>
          </>
        ) : null}
      </div>

      {promptExcerpt ? (
        <pre
          data-testid="task-prompt"
          className="mt-2 p-2 bg-muted rounded text-[11px] leading-4 font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-40 overflow-y-auto"
        >
          {promptExcerpt}
        </pre>
      ) : null}

      <div className="mt-3 border-l-2 border-border pl-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Sub-agent{input.subagent_type ? `: ${input.subagent_type}` : ''}
        </div>
        {nestedEntries.length === 0 ? (
          <div
            data-testid="task-spinner"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Spinner size={12} aria-label="Running subagent" />
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
                    <span className="font-mono text-foreground">{entry.name}</span>
                    <span className="text-[10px] text-muted-foreground">{entry.status}</span>
                  </li>
                );
              }
              if (entry.type === 'message') {
                return (
                  <li
                    key={entry.id}
                    data-testid="task-nested-entry"
                    className="text-xs text-foreground truncate"
                  >
                    <span className="text-[10px] text-muted-foreground mr-1">{entry.role}:</span>
                    {entry.text}
                  </li>
                );
              }
              return (
                <li
                  key={entry.id}
                  data-testid="task-nested-entry"
                  className="text-xs text-foreground"
                >
                  <span className="text-[10px] text-muted-foreground mr-1">permission:</span>
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
