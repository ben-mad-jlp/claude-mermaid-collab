import React from 'react';
import type { AgentToolCallItem } from '@/stores/agentStore';
import ToolCardFrame from './ToolCardFrame';
import ReadView from './ReadView';
import EditView from './EditView';
import WriteView from './WriteView';
import BashView from './BashView';
import GrepView from './GrepView';
import GlobView from './GlobView';
import ComposeView from './ComposeView';
import TodoWriteView from './TodoWriteView';
import TaskView from './TaskView';
import WebFetchView from './WebFetchView';
import WebSearchView from './WebSearchView';
import NotebookEditView from './NotebookEditView';
import McpGenericView from './McpGenericView';
import JsonFallback from './JsonFallback';

type ViewComponent = React.FC<{ item: AgentToolCallItem }>;

function pickView(name: string): ViewComponent {
  if (name.startsWith('mcp__')) {
    return McpGenericView;
  }
  switch (name) {
    case 'Read':
      return ReadView;
    case 'Edit':
    case 'MultiEdit':
      return EditView;
    case 'Write':
      return WriteView;
    case 'Bash':
      return BashView;
    case 'Grep':
      return GrepView;
    case 'Glob':
      return GlobView;
    case 'ComposeCommitPushPR':
      return ComposeView;
    case 'TodoWrite':
      return TodoWriteView;
    case 'Task':
      return TaskView;
    case 'WebFetch':
      return WebFetchView;
    case 'WebSearch':
      return WebSearchView;
    case 'NotebookEdit':
      return NotebookEditView;
    default:
      return JsonFallback;
  }
}

function computeTitle(item: AgentToolCallItem): string | undefined {
  const input = (item.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  switch (item.name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return str(input.file_path);
    case 'Bash':
      return str(input.description) ?? str(input.command);
    case 'Grep':
      return str(input.pattern);
    case 'Glob':
      return str(input.pattern);
    default:
      return undefined;
  }
}

const ToolCallCard: React.FC<{ item: AgentToolCallItem }> = ({ item }) => {
  const Body = pickView(item.name);
  const title = computeTitle(item);
  const durationMs = item.endTs ? item.endTs - item.startTs : undefined;

  return (
    <ToolCardFrame
      name={item.name}
      title={title}
      status={item.status}
      durationMs={durationMs}
      historical={item.historical}
      defaultCollapsed={item.historical || item.status === 'ok'}
    >
      <Body item={item} />
    </ToolCardFrame>
  );
};

export default ToolCallCard;
