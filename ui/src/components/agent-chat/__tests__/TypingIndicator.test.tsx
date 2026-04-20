import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TypingIndicator } from '../TypingIndicator';

describe('TypingIndicator', () => {
  it('returns null when state is idle', () => {
    const { container } = render(<TypingIndicator state="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Thinking…" when state is thinking', () => {
    render(<TypingIndicator state="thinking" />);
    expect(screen.getByRole('status').textContent).toContain('Thinking…');
  });

  it('renders "Streaming…" when state is streaming', () => {
    render(<TypingIndicator state="streaming" />);
    expect(screen.getByRole('status').textContent).toContain('Streaming…');
  });

  it('renders "Running tools…" when state is running_tools', () => {
    render(<TypingIndicator state="running_tools" />);
    expect(screen.getByRole('status').textContent).toContain('Running tools…');
    expect(screen.getByTestId('typing-indicator-spinner')).toBeInTheDocument();
  });
});
