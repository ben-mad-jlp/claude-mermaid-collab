import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the EmbeddedTerminal so we test the real component (not the global mock)
vi.unmock('@/components/EmbeddedTerminal');

import { EmbeddedTerminal } from './EmbeddedTerminal';

describe('EmbeddedTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render iframe immediately on mount', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', 'http://localhost:7681');
  });

  it('should apply custom className to container', () => {
    const { container } = render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://localhost:7681/ws' }}
        className="custom-class"
      />
    );
    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toHaveClass('custom-class');
  });

  it('should include sessionName in iframe URL when provided', () => {
    const { container } = render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://localhost:7681/ws' }}
        sessionName="my-session"
      />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toHaveAttribute('src', 'http://localhost:7681?arg=my-session');
  });

  it('should encode special characters in sessionName', () => {
    const { container } = render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://localhost:7681/ws' }}
        sessionName="my session & things"
      />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toHaveAttribute('src', 'http://localhost:7681?arg=my%20session%20%26%20things');
  });

  it('should convert wss:// to https://', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'wss://example.com:7681/ws' }} />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toHaveAttribute('src', 'https://example.com:7681');
  });

  it('should have correct iframe attributes and basic styling', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).toHaveAttribute('title', 'Terminal');
    const style = iframe?.getAttribute('style') || '';
    expect(style).toContain('flex');
    expect(style).toContain('background');
  });

  it('should have correct container styling', () => {
    const { container } = render(
      <EmbeddedTerminal config={{ wsUrl: 'ws://localhost:7681/ws' }} />
    );

    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    });
  });
});
