import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThinkingBlock from '../ThinkingBlock';

describe('ThinkingBlock', () => {
  it('is collapsed by default when not streaming', () => {
    render(<ThinkingBlock text="my secret reasoning" />);
    const toggle = screen.getByTestId('thinking-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('thinking-content')).not.toBeInTheDocument();
    expect(screen.queryByText('my secret reasoning')).not.toBeInTheDocument();
    expect(screen.getByText(/Thinking \(19 chars\)/)).toBeInTheDocument();
  });

  it('expands when the toggle is clicked', () => {
    render(<ThinkingBlock text="my secret reasoning" />);
    const toggle = screen.getByTestId('thinking-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const content = screen.getByTestId('thinking-content');
    expect(content).toBeInTheDocument();
    expect(content).toHaveTextContent('my secret reasoning');
  });

  it('collapses again on second click', () => {
    render(<ThinkingBlock text="abc" />);
    const toggle = screen.getByTestId('thinking-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('thinking-content')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('thinking-content')).not.toBeInTheDocument();
  });

  it('shows pulsing dot and no toggle when streaming', () => {
    render(<ThinkingBlock text="partial" streaming />);
    expect(screen.getByTestId('thinking-pulse')).toBeInTheDocument();
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.queryByTestId('thinking-toggle')).not.toBeInTheDocument();
    // Content is auto-visible while streaming
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('pulse element has the pulse animation class', () => {
    render(<ThinkingBlock text="" streaming />);
    const pulse = screen.getByTestId('thinking-pulse');
    expect(pulse.className).toMatch(/animate-pulse/);
  });
});
