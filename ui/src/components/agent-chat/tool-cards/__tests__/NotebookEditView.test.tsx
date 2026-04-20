import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotebookEditView from '../NotebookEditView';
import type { AgentToolCallItem } from '@/stores/agentStore';

function makeItem(input: Record<string, unknown>): AgentToolCallItem {
  return { id: 'test-id', input } as unknown as AgentToolCallItem;
}

describe('NotebookEditView', () => {
  it('renders the notebook path', () => {
    const item = makeItem({
      notebook_path: '/path/to/notebook.ipynb',
      cell_id: 'cell-123',
      new_source: 'print("hello")',
      edit_mode: 'replace',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('notebook-path')).toHaveTextContent(
      '/path/to/notebook.ipynb',
    );
  });

  it('renders the cell id badge', () => {
    const item = makeItem({
      notebook_path: '/nb.ipynb',
      cell_id: 'abc-42',
      new_source: 'x = 1',
      edit_mode: 'insert',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('cell-id-badge')).toHaveTextContent('abc-42');
  });

  it('renders the edit_mode badge', () => {
    const item = makeItem({
      notebook_path: '/nb.ipynb',
      cell_id: 'c1',
      new_source: 'y = 2',
      edit_mode: 'insert',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('edit-mode-badge')).toHaveTextContent('insert');
  });

  it('shows the new_source content in the split diff', () => {
    const item = makeItem({
      notebook_path: '/nb.ipynb',
      cell_id: 'c1',
      new_source: 'print("hello world")',
      edit_mode: 'replace',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('notebook-split-diff')).toHaveTextContent(
      'print("hello world")',
    );
  });

  it('defaults to replace mode when edit_mode is missing', () => {
    const item = makeItem({
      notebook_path: '/nb.ipynb',
      cell_id: 'c1',
      new_source: 'z = 3',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('edit-mode-badge')).toHaveTextContent('replace');
  });

  it('renders delete mode with cell deleted placeholder', () => {
    const item = makeItem({
      notebook_path: '/nb.ipynb',
      cell_id: 'c1',
      new_source: 'old = 1',
      edit_mode: 'delete',
    });
    render(<NotebookEditView item={item} />);
    expect(screen.getByTestId('edit-mode-badge')).toHaveTextContent('delete');
    expect(screen.getByText(/cell deleted/i)).toBeInTheDocument();
  });
});
