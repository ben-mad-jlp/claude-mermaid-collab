import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandPicker } from '../SlashCommandPicker';

describe('SlashCommandPicker', () => {
  it('renders default built-in commands when query is empty', () => {
    render(
      <SlashCommandPicker query="" onSelect={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByText('/clear')).toBeInTheDocument();
    expect(screen.getByText('/compact')).toBeInTheDocument();
    expect(screen.getByText('/model')).toBeInTheDocument();
    expect(screen.getByText('/resume')).toBeInTheDocument();
    expect(screen.getByText('/cost')).toBeInTheDocument();
  });

  it('fuzzy-filters commands case-insensitively by substring', () => {
    render(
      <SlashCommandPicker
        query="cle"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('/clear')).toBeInTheDocument();
    expect(screen.queryByText('/help')).not.toBeInTheDocument();
    expect(screen.queryByText('/model')).not.toBeInTheDocument();
  });

  it('filters with uppercase query (case-insensitive)', () => {
    render(
      <SlashCommandPicker
        query="HELP"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.queryByText('/clear')).not.toBeInTheDocument();
  });

  it('renders nothing when no commands match', () => {
    const { container } = render(
      <SlashCommandPicker
        query="zzznotacommand"
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('uses a custom commands list when provided', () => {
    render(
      <SlashCommandPicker
        query=""
        commands={[
          { name: '/foo', description: 'foo cmd' },
          { name: '/bar', description: 'bar cmd' },
        ]}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('/foo')).toBeInTheDocument();
    expect(screen.getByText('/bar')).toBeInTheDocument();
    expect(screen.queryByText('/help')).not.toBeInTheDocument();
  });

  it('selects first item by default; ArrowDown moves selection down', () => {
    render(
      <SlashCommandPicker query="" onSelect={() => {}} onDismiss={() => {}} />,
    );
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    const updated = screen.getAllByRole('option');
    expect(updated[0]).toHaveAttribute('aria-selected', 'false');
    expect(updated[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp from the first item wraps to the last', () => {
    render(
      <SlashCommandPicker query="" onSelect={() => {}} onDismiss={() => {}} />,
    );
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Enter calls onSelect with the currently highlighted command', () => {
    const onSelect = vi.fn();
    render(
      <SlashCommandPicker
        query=""
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    // First item is /help per built-in order.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe('/help');
  });

  it('ArrowDown then Enter selects the second command', () => {
    const onSelect = vi.fn();
    render(
      <SlashCommandPicker
        query=""
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe('/clear');
  });

  it('Escape calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <SlashCommandPicker
        query=""
        onSelect={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clicking an option calls onSelect with that command', () => {
    const onSelect = vi.fn();
    render(
      <SlashCommandPicker
        query=""
        onSelect={onSelect}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('/model'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe('/model');
  });
});
