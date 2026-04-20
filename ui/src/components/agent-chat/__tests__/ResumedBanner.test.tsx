import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResumedBanner } from '../ResumedBanner';

describe('ResumedBanner', () => {
  it('renders truncated session id and turn count', () => {
    render(
      <ResumedBanner
        sessionId="abcdef1234567890deadbeef"
        previousTurnCount={5}
      />,
    );
    const el = screen.getByRole('status');
    expect(el.textContent).toContain('abcdef12');
    expect(el.textContent).not.toContain('abcdef123');
    expect(el.textContent).toContain('5 prior turns');
  });

  it('defaults turn count to 0 when not provided', () => {
    render(<ResumedBanner sessionId="abcdef1234567890" />);
    const el = screen.getByRole('status');
    expect(el.textContent).toContain('0 prior turns');
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ResumedBanner
        sessionId="abcdef1234567890"
        previousTurnCount={3}
        onDismiss={onDismiss}
      />,
    );
    const btn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('omits dismiss button when onDismiss is not provided', () => {
    render(
      <ResumedBanner sessionId="abcdef1234567890" previousTurnCount={1} />,
    );
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });
});
