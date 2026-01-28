import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the global EmbeddedTerminal mock so we can test it
vi.unmock('@/components/EmbeddedTerminal');

// Mock XTermTerminal component to avoid xterm.js/ResizeObserver issues in jsdom
vi.mock('../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ wsUrl, sessionId, className }) => (
    <div
      data-testid="xterm-terminal"
      data-ws-url={wsUrl}
      data-session-id={sessionId}
      className={className}
    />
  )),
}));

// Import after mocks are set up
import { EmbeddedTerminal } from '../EmbeddedTerminal';

describe('EmbeddedTerminal', () => {
  const defaultConfig = {
    wsUrl: '/terminal',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render XTermTerminal with correct props', () => {
    render(
      <EmbeddedTerminal
        config={defaultConfig}
        sessionId="test-session"
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveAttribute('data-ws-url', '/terminal');
    expect(terminal).toHaveAttribute('data-session-id', 'test-session');
  });

  it('should use default session ID when not provided', () => {
    render(<EmbeddedTerminal config={defaultConfig} />);

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-session-id', 'default');
  });

  it('should pass custom wsUrl to XTermTerminal', () => {
    render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://example.com/terminal' }}
        sessionId="test"
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-ws-url', 'ws://example.com/terminal');
  });

  it('should apply custom className to container', () => {
    const { container } = render(
      <EmbeddedTerminal
        config={defaultConfig}
        className="custom-class"
      />
    );

    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toBeInTheDocument();
    expect(terminalDiv).toHaveClass('custom-class');
  });

  it('should render container with flex layout', () => {
    const { container } = render(<EmbeddedTerminal config={defaultConfig} />);

    const terminalDiv = container.querySelector('.embedded-terminal');
    expect(terminalDiv).toBeInTheDocument();
    expect(terminalDiv).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      flex: '1',
    });
  });

  it('should render XTermTerminal inside the container', () => {
    render(<EmbeddedTerminal config={defaultConfig} />);

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toBeInTheDocument();
  });
});
