import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WebSearchView from '../WebSearchView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function makeItem(overrides: Partial<AgentToolCallItem> = {}): AgentToolCallItem {
  return {
    type: 'tool_call',
    id: 'tool-1',
    name: 'WebSearch',
    input: {},
    status: 'ok',
    progress: [],
    startTs: 0,
    ...overrides,
  };
}

describe('WebSearchView', () => {
  it('renders the query string from input', () => {
    const item = makeItem({ input: { query: 'how to rebind ctrl+s' } });
    render(<WebSearchView item={item} />);
    expect(screen.getByTestId('websearch-query')).toHaveTextContent(
      'how to rebind ctrl+s',
    );
  });

  it('renders result rows with title, url, and snippet', () => {
    const item = makeItem({
      input: { query: 'react hooks' },
      output: [
        {
          title: 'React Hooks Overview',
          url: 'https://react.dev/reference/react',
          snippet: 'Hooks let you use state and other React features.',
        },
        {
          title: 'useState Guide',
          url: 'https://react.dev/reference/react/useState',
          snippet: 'useState is a React Hook that lets you add state.',
        },
      ],
    });
    render(<WebSearchView item={item} />);

    const rows = screen.getAllByTestId('websearch-result');
    expect(rows).toHaveLength(2);

    expect(screen.getByText('React Hooks Overview')).toBeInTheDocument();
    expect(screen.getByText('https://react.dev/reference/react')).toBeInTheDocument();
    expect(
      screen.getByText('Hooks let you use state and other React features.'),
    ).toBeInTheDocument();

    expect(screen.getByText('useState Guide')).toBeInTheDocument();
    expect(
      screen.getByText('https://react.dev/reference/react/useState'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('useState is a React Hook that lets you add state.'),
    ).toBeInTheDocument();
  });

  it('accepts output wrapped under a results key', () => {
    const item = makeItem({
      input: { query: 'test' },
      output: {
        results: [
          { title: 'A', url: 'https://a.example', snippet: 'snip-a' },
        ],
      },
    });
    render(<WebSearchView item={item} />);
    expect(screen.getAllByTestId('websearch-result')).toHaveLength(1);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('https://a.example')).toBeInTheDocument();
    expect(screen.getByText('snip-a')).toBeInTheDocument();
  });
});
