import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileMentionPicker } from '../FileMentionPicker';

describe('FileMentionPicker', () => {
  const files = [
    'src/index.ts',
    'src/components/Foo.tsx',
    'src/components/Bar.tsx',
    'README.md',
  ];

  it('filters from files prop by query', () => {
    render(
      <FileMentionPicker
        query="foo"
        files={files}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('src/components/Foo.tsx')).toBeInTheDocument();
    expect(screen.queryByText('src/components/Bar.tsx')).not.toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  it('shows all files when query empty', () => {
    render(
      <FileMentionPicker
        query=""
        files={files}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('navigates with arrow keys and updates active selection', () => {
    render(
      <FileMentionPicker
        query=""
        files={files}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    // First item selected by default
    const first = screen.getByTestId('file-mention-item-0');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('file-mention-item-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('file-mention-item-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByTestId('file-mention-item-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Enter selects active item', () => {
    const onSelect = vi.fn();
    render(
      <FileMentionPicker
        query=""
        files={files}
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('src/components/Foo.tsx');
  });

  it('Esc dismisses', () => {
    const onDismiss = vi.fn();
    render(
      <FileMentionPicker
        query=""
        files={files}
        onSelect={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('click selects item', () => {
    const onSelect = vi.fn();
    render(
      <FileMentionPicker
        query=""
        files={files}
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelect).toHaveBeenCalledWith('README.md');
  });
});
