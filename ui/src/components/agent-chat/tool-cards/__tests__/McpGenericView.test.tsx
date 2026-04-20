import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import McpGenericView, { parseMcpToolName, accentFor } from '../McpGenericView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function makeItem(overrides: Partial<AgentToolCallItem> = {}): AgentToolCallItem {
  return {
    type: 'tool_call',
    id: 'tool-1',
    name: 'mcp__mermaid__create_diagram',
    input: { foo: 'bar' },
    status: 'ok',
    output: { ok: true },
    progress: [],
    startTs: 0,
    ...overrides,
  };
}

describe('parseMcpToolName', () => {
  it('parses canonical mcp__<server>__<tool>', () => {
    const p = parseMcpToolName('mcp__mermaid__create_diagram');
    expect(p).toEqual({ server: 'mermaid', tool: 'create_diagram', raw: 'mcp__mermaid__create_diagram' });
  });

  it('handles tool names containing underscores', () => {
    const p = parseMcpToolName('mcp__ollama-coding__semantic_search');
    expect(p?.server).toBe('ollama-coding');
    expect(p?.tool).toBe('semantic_search');
  });

  it('handles hyphenated server names', () => {
    const p = parseMcpToolName('mcp__chrome-devtools__take_snapshot');
    expect(p?.server).toBe('chrome-devtools');
    expect(p?.tool).toBe('take_snapshot');
  });

  it('returns null for non-mcp names', () => {
    expect(parseMcpToolName('Bash')).toBeNull();
    expect(parseMcpToolName('mcp__only')).toBeNull();
  });
});

describe('accentFor', () => {
  it('green for mermaid', () => {
    expect(accentFor('mermaid').serverBadge).toMatch(/green/);
    expect(accentFor('mermaid').frame).toMatch(/green/);
  });

  it('blue for chrome-devtools', () => {
    expect(accentFor('chrome-devtools').serverBadge).toMatch(/blue/);
    expect(accentFor('chrome-devtools').frame).toMatch(/blue/);
  });

  it('purple for ollama-coding', () => {
    expect(accentFor('ollama-coding').serverBadge).toMatch(/purple/);
    expect(accentFor('ollama-coding').frame).toMatch(/purple/);
  });

  it('falls back to gray for unknown servers', () => {
    expect(accentFor('unknown').serverBadge).toMatch(/gray/);
  });
});

describe('McpGenericView', () => {
  it('renders server and tool badges parsed from name', () => {
    render(<McpGenericView item={makeItem({ name: 'mcp__mermaid__create_diagram' })} />);
    const server = screen.getByTestId('mcp-server-badge');
    const tool = screen.getByTestId('mcp-tool-badge');
    expect(server.textContent).toBe('mermaid');
    expect(server.getAttribute('data-server')).toBe('mermaid');
    expect(tool.textContent).toBe('create_diagram');
  });

  it('shows pretty-printed input JSON', () => {
    render(<McpGenericView item={makeItem({ input: { foo: 'bar', n: 1 } })} />);
    const pre = screen.getByTestId('mcp-input-json');
    expect(pre.textContent).toMatch(/"foo": "bar"/);
    expect(pre.textContent).toMatch(/"n": 1/);
  });

  it('renders OutputPanel for output', () => {
    render(<McpGenericView item={makeItem()} />);
    expect(screen.getByTestId('output-panel')).toBeInTheDocument();
  });

  it('applies green accent for mermaid server', () => {
    render(<McpGenericView item={makeItem({ name: 'mcp__mermaid__list_designs' })} />);
    const badge = screen.getByTestId('mcp-server-badge');
    expect(badge.className).toMatch(/green/);
  });

  it('applies blue accent for chrome-devtools server', () => {
    render(
      <McpGenericView item={makeItem({ name: 'mcp__chrome-devtools__take_snapshot' })} />,
    );
    const badge = screen.getByTestId('mcp-server-badge');
    expect(badge.className).toMatch(/blue/);
  });

  it('applies purple accent for ollama-coding server', () => {
    render(
      <McpGenericView item={makeItem({ name: 'mcp__ollama-coding__semantic_search' })} />,
    );
    const badge = screen.getByTestId('mcp-server-badge');
    expect(badge.className).toMatch(/purple/);
  });

  it('falls back gracefully for non-mcp tool names', () => {
    render(<McpGenericView item={makeItem({ name: 'Bash' })} />);
    const server = screen.getByTestId('mcp-server-badge');
    const tool = screen.getByTestId('mcp-tool-badge');
    expect(server.textContent).toBe('mcp');
    expect(tool.textContent).toBe('Bash');
  });

  it('omits input block when input is empty', () => {
    render(<McpGenericView item={makeItem({ input: {} })} />);
    expect(screen.queryByTestId('mcp-input-json')).toBeNull();
  });
});
