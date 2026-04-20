import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorRecoveryBanner } from '../ErrorRecoveryBanner';

describe('ErrorRecoveryBanner', () => {
  it('renders the error text', () => {
    render(<ErrorRecoveryBanner error="child exited unexpectedly" />);
    const el = screen.getByRole('alert');
    expect(el.textContent).toContain('child exited unexpectedly');
  });

  it('invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorRecoveryBanner error="oops" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('invokes onResume when Resume is clicked', () => {
    const onResume = vi.fn();
    render(<ErrorRecoveryBanner error="oops" onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('invokes onDismiss when Dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorRecoveryBanner error="oops" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('omits buttons whose handlers are not provided', () => {
    render(<ErrorRecoveryBanner error="oops" />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  it('renders all three buttons when all handlers provided', () => {
    const onRetry = vi.fn();
    const onResume = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ErrorRecoveryBanner
        error="child exited"
        onRetry={onRetry}
        onResume={onResume}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});
