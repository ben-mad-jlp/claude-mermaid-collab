import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WebFetchView from '../WebFetchView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function makeItem(overrides: Partial<AgentToolCallItem> = {}): AgentToolCallItem {
  return {
    type: 'tool_call',
    id: 'tool-1',
    name: 'WebFetch',
    input: {
      url: 'https://example.com/article',
      prompt: 'Summarize the article',
    },
    status: 'ok',
    progress: [],
    startTs: 0,
    ...overrides,
  };
}

describe('WebFetchView', () => {
  it('renders url as a link', () => {
    render(<WebFetchView item={makeItem({ status: 'running' })} />);
    const link = screen.getByRole('link', {
      name: 'https://example.com/article',
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com/article');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows the prompt as an italic quote', () => {
    render(<WebFetchView item={makeItem({ status: 'running' })} />);
    const prompt = screen.getByText('Summarize the article');
    expect(prompt).toBeInTheDocument();
    expect(prompt.tagName).toBe('BLOCKQUOTE');
  });

  it('shows output via OutputPanel when result available', () => {
    const longText = 'A'.repeat(500);
    render(
      <WebFetchView
        item={makeItem({ status: 'ok', output: longText })}
      />,
    );
    const panel = screen.getByTestId('output-panel');
    expect(panel).toBeInTheDocument();
    // Expand to reveal the excerpt
    fireEvent.click(screen.getByRole('button', { name: /show output/i }));
    const pre = screen.getByText(
      (_c, el) =>
        el?.tagName === 'PRE' && (el?.textContent ?? '').includes('A'.repeat(400)),
    );
    expect(pre).toBeInTheDocument();
    // Truncated with ellipsis
    expect(pre.textContent?.endsWith('…')).toBe(true);
  });
});
