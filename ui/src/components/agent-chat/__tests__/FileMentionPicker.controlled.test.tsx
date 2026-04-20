import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileMentionPicker } from '../FileMentionPicker';

describe('FileMentionPicker (controlled mode)', () => {
  const files = [
    'src/index.ts',
    'src/components/Foo.tsx',
    'src/components/Bar.tsx',
    'README.md',
  ];

  it('filters list based on controlled query prop', () => {
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

  it('calls onSelect with the path on click (no internal textarea mutation)', () => {
    const onSelect = vi.fn();
    render(
      <FileMentionPicker
        query="foo"
        files={files}
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    const item = screen.getByTestId('file-mention-item-0');
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('src/components/Foo.tsx');
  });

  it('calls onSelect after ArrowDown + Enter keyboard navigation', () => {
    const onSelect = vi.fn();
    // Query matching multiple entries so ArrowDown has somewhere to go
    render(
      <FileMentionPicker
        query="src"
        files={files}
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );

    // Initially activeIndex = 0 → 'src/index.ts'
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('src/components/Foo.tsx');
  });

  it('Enter alone selects the active (first) item', () => {
    const onSelect = vi.fn();
    render(
      <FileMentionPicker
        query="foo"
        files={files}
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('src/components/Foo.tsx');
  });

  it('applies fixed positioning when anchorRect is provided', () => {
    const rect = {
      top: 10,
      left: 20,
      bottom: 40,
      right: 120,
      width: 100,
      height: 30,
      x: 20,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect;
    render(
      <FileMentionPicker
        query="foo"
        anchorRect={rect}
        files={files}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    const picker = screen.getByTestId('file-mention-picker');
    expect(picker).toHaveStyle({ position: 'fixed' });
    expect(picker.style.top).toBe('40px');
    expect(picker.style.left).toBe('20px');
  });
});
