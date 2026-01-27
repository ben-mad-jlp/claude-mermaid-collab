import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock the global EmbeddedTerminal mock so we can test it
vi.unmock('@/components/EmbeddedTerminal');

// Mock XTermTerminal component to avoid xterm.js/ResizeObserver issues in jsdom
vi.mock('../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ wsUrl, tmuxSession, className }) => (
    <div
      data-testid="xterm-terminal"
      data-ws-url={wsUrl}
      data-tmux-session={tmuxSession}
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
        sessionName="test-session"
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveAttribute('data-ws-url', '/terminal');
    expect(terminal).toHaveAttribute('data-tmux-session', 'test-session');
  });

  it('should use default session name when not provided', () => {
    render(<EmbeddedTerminal config={defaultConfig} />);

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-tmux-session', 'default');
  });

  it('should pass custom wsUrl to XTermTerminal', () => {
    render(
      <EmbeddedTerminal
        config={{ wsUrl: 'ws://example.com/terminal' }}
        sessionName="test"
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
      height: '100%',
    });
  });

  it('should pass className to XTermTerminal', () => {
    render(<EmbeddedTerminal config={defaultConfig} />);

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveClass('flex-1');
  });
});
