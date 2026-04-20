import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompactionNotice } from '../CompactionNotice';

describe('CompactionNotice', () => {
  it('renders with all fields', () => {
    render(
      <CompactionNotice
        tokensBefore={12000}
        tokensAfter={3000}
        messagesRetained={8}
        ts={1700000000000}
      />,
    );
    const el = screen.getByRole('separator', { name: /context compacted/i });
    expect(el.textContent).toContain('12000');
    expect(el.textContent).toContain('3000');
    expect(el.textContent).toContain('8 messages retained');
    expect(el.getAttribute('data-ts')).toBe('1700000000000');
  });

  it('handles missing fields', () => {
    render(<CompactionNotice />);
    const el = screen.getByRole('separator', { name: /context compacted/i });
    expect(el.textContent).toContain('?');
    expect(el.textContent).toMatch(/Context compacted at \? tokens/);
    expect(el.textContent).toContain('? messages retained');
  });

  it('handles partial fields', () => {
    render(<CompactionNotice tokensBefore={500} />);
    const el = screen.getByRole('separator', { name: /context compacted/i });
    expect(el.textContent).toContain('500');
    expect(el.textContent).toContain('?');
  });
});
