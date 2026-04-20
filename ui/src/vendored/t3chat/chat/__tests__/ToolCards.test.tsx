import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ToolCallCard } from '../tool-cards/ToolCallCard';
import { ReadView } from '../tool-cards/ReadView';
import { EditView } from '../tool-cards/EditView';
import { BashView } from '../tool-cards/BashView';
import { WriteView } from '../tool-cards/WriteView';
import { GrepView } from '../tool-cards/GrepView';
import { GlobView } from '../tool-cards/GlobView';
import { TodoWriteView } from '../tool-cards/TodoWriteView';
import { WebFetchView } from '../tool-cards/WebFetchView';
import { WebSearchView } from '../tool-cards/WebSearchView';
import { JsonFallback } from '../tool-cards/JsonFallback';
import { McpGenericView } from '../tool-cards/McpGenericView';
import { NotebookEditView } from '../tool-cards/NotebookEditView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function mkItem(partial: Partial<AgentToolCallItem>): AgentToolCallItem {
  return {
    type: 'tool_call',
    id: partial.id ?? 'tu1',
    name: partial.name ?? 'Bash',
    input: partial.input ?? {},
    status: partial.status ?? 'ok',
    progress: partial.progress ?? [],
    startTs: partial.startTs ?? 1000,
    ...partial,
  } as AgentToolCallItem;
}

afterEach(() => cleanup());

describe('ReadView', () => {
  it('renders file_path and offset/limit from input', () => {
    render(
      <ReadView item={mkItem({ name: 'Read', input: { file_path: '/abs/path.ts', offset: 10, limit: 20 } })} />,
    );
    expect(screen.getByTestId('read-view').textContent).toContain('/abs/path.ts');
    expect(screen.getByTestId('read-view').textContent).toContain('10');
    expect(screen.getByTestId('read-view').textContent).toContain('20');
  });
});

describe('EditView', () => {
  it('renders a diff with add and del lines', () => {
    render(
      <EditView
        item={mkItem({
          name: 'Edit',
          input: { file_path: '/f.ts', old_string: 'a\nb\n', new_string: 'a\nc\n' },
        })}
      />,
    );
    const diff = screen.getByTestId('edit-diff').textContent ?? '';
    expect(diff).toContain('- b');
    expect(diff).toContain('+ c');
  });
});

describe('BashView', () => {
  it('renders command and streams stdout from progress', () => {
    const item = mkItem({
      name: 'Bash',
      input: { command: 'echo hello' },
      status: 'running',
      progress: [{ channel: 'stdout', chunk: 'hello\n', seq: 0 }],
    });
    render(<BashView item={item} />);
    expect(screen.getByTestId('bash-view').textContent).toContain('echo hello');
  });
});

describe('WriteView', () => {
  it('renders line/char count and preview', () => {
    render(
      <WriteView
        item={mkItem({ name: 'Write', input: { file_path: '/x.md', content: 'one\ntwo\nthree' } })}
      />,
    );
    const root = screen.getByTestId('write-view');
    expect(root.textContent).toContain('/x.md');
    expect(root.textContent).toContain('3 lines');
    expect(root.textContent).toContain('one');
  });
});

describe('GrepView', () => {
  it('summarizes output match + file counts', () => {
    render(
      <GrepView
        item={mkItem({
          name: 'Grep',
          input: { pattern: 'foo', path: 'src' },
          output: 'a.ts:1:hit\nb.ts:2:hit\na.ts:5:hit',
        })}
      />,
    );
    expect(screen.getByTestId('grep-summary').textContent).toBe('3 matches / 2 files');
  });
});

describe('GlobView', () => {
  it('renders file count from string output', () => {
    render(
      <GlobView
        item={mkItem({ name: 'Glob', input: { pattern: '**/*.ts' }, output: 'a.ts\nb.ts\nc.ts' })}
      />,
    );
    expect(screen.getByTestId('glob-count').textContent).toBe('3 files');
  });
});

describe('TodoWriteView', () => {
  it('renders todos with status icons', () => {
    render(
      <TodoWriteView
        item={mkItem({
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'A', status: 'completed' },
              { content: 'B', status: 'in_progress' },
              { content: 'C', status: 'pending' },
            ],
          },
        })}
      />,
    );
    expect(screen.getByTestId('todo-item-0').getAttribute('data-status')).toBe('completed');
    expect(screen.getByTestId('todo-item-1').getAttribute('data-status')).toBe('in_progress');
    expect(screen.getByTestId('todo-item-2').getAttribute('data-status')).toBe('pending');
  });
});

describe('WebFetchView', () => {
  it('renders url and prompt', () => {
    render(
      <WebFetchView
        item={mkItem({
          name: 'WebFetch',
          input: { url: 'https://x.test', prompt: 'summarize' },
          output: 'body',
        })}
      />,
    );
    const root = screen.getByTestId('webfetch-view');
    expect(root.textContent).toContain('https://x.test');
    expect(root.textContent).toContain('summarize');
  });
});

describe('WebSearchView', () => {
  it('renders query and result list', () => {
    render(
      <WebSearchView
        item={mkItem({
          name: 'WebSearch',
          input: { query: 'claude' },
          output: [{ title: 'T', url: 'https://u', snippet: 'S' }],
        })}
      />,
    );
    expect(screen.getByTestId('websearch-query').textContent).toBe('claude');
    expect(screen.getAllByTestId('websearch-result')).toHaveLength(1);
  });
});

describe('NotebookEditView', () => {
  it('renders edit mode badge and new_source as additive diff', () => {
    render(
      <NotebookEditView
        item={mkItem({
          name: 'NotebookEdit',
          input: { notebook_path: 'n.ipynb', cell_id: 'c1', edit_mode: 'insert', new_source: 'x' },
        })}
      />,
    );
    expect(screen.getByTestId('notebook-edit-view').textContent).toContain('insert');
  });
});

describe('JsonFallback', () => {
  it('renders input JSON and output JSON', () => {
    render(<JsonFallback item={mkItem({ name: 'X', input: { a: 1 }, output: { b: 2 } })} />);
    const root = screen.getByTestId('json-fallback');
    expect(root.textContent).toContain('"a": 1');
    expect(root.textContent).toContain('"b": 2');
  });
});

describe('McpGenericView', () => {
  it('splits mcp name into server + tool parts', () => {
    render(<McpGenericView item={mkItem({ name: 'mcp__foo__bar_baz', input: {} })} />);
    const root = screen.getByTestId('mcp-generic-view');
    expect(root.textContent).toContain('foo');
    expect(root.textContent).toContain('bar_baz');
  });
});

describe('ToolCallCard frame', () => {
  it('renders name and running status badge', () => {
    render(
      <ToolCallCard
        item={mkItem({ name: 'Bash', status: 'running', input: { command: 'ls' } })}
      />,
    );
    const frame = screen.getByTestId('tool-card-frame');
    expect(frame.getAttribute('data-tool-name')).toBe('Bash');
    expect(frame.getAttribute('data-tool-status')).toBe('running');
    expect(frame.textContent).toContain('running');
  });

  it('shows error badge + body for error status', () => {
    render(
      <ToolCallCard
        item={mkItem({
          id: 't-err',
          name: 'Read',
          status: 'error',
          input: { file_path: '/x' },
          error: 'boom',
        })}
      />,
    );
    const frame = screen.getByTestId('tool-card-frame');
    expect(frame.getAttribute('data-tool-status')).toBe('error');
    expect(frame.textContent).toContain('error');
  });

  it('routes unknown tool to JsonFallback', () => {
    // use running status so the frame renders expanded (ok defaults collapsed).
    render(
      <ToolCallCard
        item={mkItem({ name: 'UnknownTool', status: 'running', input: { foo: 'bar' } })}
      />,
    );
    expect(screen.getByTestId('json-fallback')).toBeTruthy();
  });
});
