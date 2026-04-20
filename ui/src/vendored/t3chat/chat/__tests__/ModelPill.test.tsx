import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModelPill } from '../ModelPill';

describe('ModelPill', () => {
  afterEach(() => cleanup());

  it('renders the model name', () => {
    render(<ModelPill model="claude-opus-4-7" />);
    const el = screen.getByTestId('model-pill');
    expect(el.textContent).toContain('claude-opus-4-7');
    expect(el.getAttribute('title')).toBe('claude-opus-4-7');
  });
});
