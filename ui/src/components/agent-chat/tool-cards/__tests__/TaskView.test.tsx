import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TaskView from '../TaskView';
import { useAgentStore, type AgentToolCallItem } from '@/stores/agentStore';

function makeItem(overrides: Partial<AgentToolCallItem> = {}): AgentToolCallItem {
  return {
    type: 'tool_call',
    id: 'task-1',
    turnId: 'turn-parent',
    name: 'Task',
    input: {
      description: 'Search repo',
      prompt: 'Find the user model and summarize fields.',
      subagent_type: 'general-purpose',
    },
    status: 'running',
    progress: [],
    startTs: 0,
    ...overrides,
  };
}

describe('TaskView', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it('renders description and prompt excerpt', () => {
    render(<TaskView item={makeItem()} />);
    expect(screen.getByText('Search repo')).toBeInTheDocument();
    expect(screen.getByText('general-purpose')).toBeInTheDocument();
    expect(screen.getByTestId('task-prompt').textContent).toContain(
      'Find the user model',
    );
  });

  it('shows spinner when no nested entries yet', () => {
    render(<TaskView item={makeItem()} />);
    expect(screen.getByTestId('task-spinner')).toBeInTheDocument();
    expect(screen.getByText(/Running subagent/i)).toBeInTheDocument();
    expect(screen.queryByTestId('task-nested-list')).not.toBeInTheDocument();
  });

  it('renders nested tool_call entries from store', () => {
    const item = makeItem();
    const store = useAgentStore.getState();

    // Register nested child turn id under parent toolUseId
    store.addNested(item.id, 'child-turn-a');

    // Inject a nested tool_call into the timeline with that turnId
    useAgentStore.setState({
      timeline: [
        {
          type: 'tool_call',
          id: 'nested-tool-1',
          turnId: 'child-turn-a',
          name: 'Read',
          input: { file_path: '/tmp/x.ts' },
          status: 'ok',
          progress: [],
          startTs: 1,
          endTs: 2,
        } as AgentToolCallItem,
        {
          type: 'message',
          id: 'nested-msg-1',
          role: 'assistant',
          text: 'summary from subagent',
          turnId: 'child-turn-a',
        },
        {
          // Should NOT appear — different turnId
          type: 'tool_call',
          id: 'unrelated',
          turnId: 'other-turn',
          name: 'Bash',
          input: {},
          status: 'ok',
          progress: [],
          startTs: 1,
        } as AgentToolCallItem,
      ],
    });

    render(<TaskView item={item} />);

    expect(screen.queryByTestId('task-spinner')).not.toBeInTheDocument();
    const list = screen.getByTestId('task-nested-list');
    const entries = within(list).getAllByTestId('task-nested-entry');
    expect(entries).toHaveLength(2);
    expect(within(list).getByText('Read')).toBeInTheDocument();
    expect(within(list).getByText(/summary from subagent/)).toBeInTheDocument();
    expect(within(list).queryByText('Bash')).not.toBeInTheDocument();
  });
});
