import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThinkingBlock } from '../ThinkingBlock';

describe('ThinkingBlock', () => {
  afterEach(() => cleanup());

  it('streaming mode: shows pulse and text', () => {
    render(<ThinkingBlock text="pondering…" streaming />);
    expect(screen.getByTestId('thinking-pulse')).toBeTruthy();
    expect(screen.getByTestId('thinking-block').textContent).toContain('pondering');
  });

  it('static mode: renders collapsed by default and toggles on click', () => {
    render(<ThinkingBlock text="abcdef" />);
    const toggle = screen.getByTestId('thinking-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows char count in label', () => {
    render(<ThinkingBlock text="1234567890" />);
    expect(screen.getByTestId('thinking-toggle').textContent).toContain('10 chars');
  });
});
