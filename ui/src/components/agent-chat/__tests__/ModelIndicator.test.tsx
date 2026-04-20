import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelIndicator } from '../ModelIndicator';

describe('ModelIndicator', () => {
  it('renders current model as pill button', () => {
    render(<ModelIndicator model="claude-opus-4-7" />);
    const btn = screen.getByRole('button', { name: 'claude-opus-4-7' });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens dropdown on click showing default models', () => {
    render(<ModelIndicator model="claude-opus-4-7" />);
    const btn = screen.getByRole('button', { name: 'claude-opus-4-7' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    // Three default models
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(listbox.textContent).toContain('claude-opus-4-7');
    expect(listbox.textContent).toContain('claude-sonnet-4-6');
    expect(listbox.textContent).toContain('claude-haiku-4-5-20251001');
  });

  it('calls onChange when a different model is picked', () => {
    const onChange = vi.fn();
    render(<ModelIndicator model="claude-opus-4-7" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'claude-opus-4-7' }));
    const sonnetBtn = screen.getByRole('button', { name: 'claude-sonnet-4-6' });
    fireEvent.click(sonnetBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4-6');
    // Dropdown closes
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not call onChange when the currently-selected model is clicked', () => {
    const onChange = vi.fn();
    render(<ModelIndicator model="claude-opus-4-7" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'claude-opus-4-7' }));
    // Click the option matching current model (the listbox option, not the pill)
    const options = screen.getAllByRole('option');
    const currentOptionBtn = options[0].querySelector('button');
    expect(currentOptionBtn).toBeTruthy();
    fireEvent.click(currentOptionBtn!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('respects custom models prop', () => {
    render(
      <ModelIndicator model="a" models={['a', 'b']} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });
});
