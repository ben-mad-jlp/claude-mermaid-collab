import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LiveRegion } from '../LiveRegion';

describe('LiveRegion', () => {
  it('renders with default polite aria-live', () => {
    const { container } = render(<LiveRegion message="Hello" />);
    const div = container.querySelector('div')!;
    expect(div).not.toBeNull();
    expect(div.getAttribute('aria-live')).toBe('polite');
    expect(div.getAttribute('aria-atomic')).toBe('true');
    expect(div.textContent).toBe('Hello');
  });

  it('respects assertive level', () => {
    const { container } = render(
      <LiveRegion message="Urgent" level="assertive" />,
    );
    const div = container.querySelector('div')!;
    expect(div.getAttribute('aria-live')).toBe('assertive');
    expect(div.textContent).toBe('Urgent');
  });

  it('is visually hidden via sr-only (no visual chrome) but readable to AT', () => {
    const { container } = render(<LiveRegion message="Silent but seen" />);
    const div = container.querySelector('div')!;
    expect(div.className).toContain('sr-only');
    // Content is present in DOM so assistive tech can read it.
    expect(div.textContent).toBe('Silent but seen');
  });

  it('propagates message updates to the live region', () => {
    const { container, rerender } = render(<LiveRegion message="first" />);
    const div = container.querySelector('div')!;
    expect(div.textContent).toBe('first');
    rerender(<LiveRegion message="second" />);
    expect(div.textContent).toBe('second');
    // aria-live attribute persists across updates
    expect(div.getAttribute('aria-live')).toBe('polite');
  });
});
