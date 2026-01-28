import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTab } from '../TerminalTab';

// Mock XTermTerminal component
vi.mock('../../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ sessionId, wsUrl, className }) => (
    <div data-testid="xterm-terminal" data-session-id={sessionId} data-ws-url={wsUrl} className={className}>
      Terminal Component
    </div>
  )),
}));

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

global.ResizeObserver = MockResizeObserver as any;

describe('TerminalTab (__tests__ variant)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render terminal component when session is active', () => {
    render(
      <TerminalTab
        terminal={{ sessionId: 'active-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    expect(screen.getByTestId('xterm-terminal')).toBeInTheDocument();
  });

  it('should display no active terminal message when session is inactive', () => {
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    expect(screen.getByText('No active terminal')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm-terminal')).not.toBeInTheDocument();
  });

  it('should properly configure terminal with session ID', () => {
    const sessionId = 'unique-session-id-12345';

    render(
      <TerminalTab
        terminal={{ sessionId, wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-session-id', sessionId);
  });

  it('should properly configure terminal with websocket URL', () => {
    const wsUrl = 'wss://secure.example.com:8443/terminal';

    render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl }}
        hasSession={true}
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-ws-url', wsUrl);
  });

  it('should manage full-screen layout on container', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({
      display: 'flex',
      flexDirection: 'column',
      flex: '1',
      width: '100%',
      height: '100%',
    });
  });

  it('should center placeholder text', () => {
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    const placeholder = screen.getByText('No active terminal');
    expect(placeholder).toBeInTheDocument();

    const parent = placeholder.parentElement;
    const computedStyle = window.getComputedStyle(parent!);

    expect(computedStyle.display).toBe('flex');
    // Flex centering is applied through inline styles on the container
  });

  it('should apply overflow hidden to container for proper sizing', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle('overflow: hidden');
  });

  it('should conditionally render based on hasSession prop', () => {
    const { rerender, queryByTestId } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    expect(queryByTestId('xterm-terminal')).toBeInTheDocument();

    rerender(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={false}
      />
    );

    expect(queryByTestId('xterm-terminal')).not.toBeInTheDocument();
    expect(screen.getByText('No active terminal')).toBeInTheDocument();
  });

  it('should pass color styling to placeholder', () => {
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    const placeholder = screen.getByText('No active terminal');
    const parent = placeholder.closest('div[style]');

    expect(parent).toHaveStyle('color: #999');
  });
});
