import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompactionBanner } from '../CompactionBanner';

describe('CompactionBanner', () => {
  afterEach(() => cleanup());

  it('renders token counts and retained-messages text', () => {
    render(
      <CompactionBanner tokensBefore={1200} tokensAfter={400} messagesRetained={7} ts={99} />
    );
    const el = screen.getByTestId('compaction-banner');
    expect(el.getAttribute('data-ts')).toBe('99');
    expect(el.textContent).toContain('1200');
    expect(el.textContent).toContain('400');
    expect(el.textContent).toContain('7 messages retained');
  });
});
