import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTab } from './TerminalTab';

// Mock XTermTerminal component
vi.mock('../terminal/XTermTerminal', () => ({
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

describe('TerminalTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render a full-screen terminal when hasSession is true', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const terminalDiv = screen.getByTestId('xterm-terminal');
    expect(terminalDiv).toBeInTheDocument();
  });

  it('should render placeholder when hasSession is false', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={false}
      />
    );

    expect(screen.getByText('No active terminal')).toBeInTheDocument();
  });

  it('should render placeholder when terminal is null and hasSession is false', () => {
    const { container } = render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    expect(screen.getByText('No active terminal')).toBeInTheDocument();
  });

  it('should render XTermTerminal with correct props when hasSession is true', () => {
    const terminalConfig = {
      sessionId: 'test-session',
      wsUrl: 'ws://localhost:3737/terminal',
    };

    render(
      <TerminalTab
        terminal={terminalConfig}
        hasSession={true}
      />
    );

    const terminalDiv = screen.getByTestId('xterm-terminal');
    expect(terminalDiv).toHaveAttribute('data-session-id', 'test-session');
    expect(terminalDiv).toHaveAttribute('data-ws-url', 'ws://localhost:3737/terminal');
  });

  it('should fill available height with full-screen layout', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    const styles = window.getComputedStyle(wrapper);

    // Check for full-screen flex layout
    expect(wrapper).toHaveStyle('display: flex');
    expect(wrapper).toHaveStyle('flex: 1');
    expect(wrapper).toHaveStyle('min-height: 0');
    expect(wrapper).toHaveStyle('width: 100%');
  });

  it('should handle placeholder styling correctly', () => {
    const { container } = render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    const placeholder = screen.getByText('No active terminal');
    expect(placeholder).toBeInTheDocument();

    // Verify placeholder styling through its container
    const placeholderContainer = placeholder.parentElement;
    const computedStyle = window.getComputedStyle(placeholderContainer!);

    expect(computedStyle.display).toBe('flex');
    expect(computedStyle.flex).toContain('1');
  });

  it('should pass terminal sessionId to XTermTerminal component', () => {
    render(
      <TerminalTab
        terminal={{ sessionId: 'my-session-123', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const terminalDiv = screen.getByTestId('xterm-terminal');
    expect(terminalDiv).toHaveAttribute('data-session-id', 'my-session-123');
  });

  it('should pass terminal wsUrl to XTermTerminal component', () => {
    render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://custom.host:9999/ws' }}
        hasSession={true}
      />
    );

    const terminalDiv = screen.getByTestId('xterm-terminal');
    expect(terminalDiv).toHaveAttribute('data-ws-url', 'ws://custom.host:9999/ws');
  });

  it('should not render terminal when hasSession is false even if terminal prop exists', () => {
    const { container, queryByTestId } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={false}
      />
    );

    expect(queryByTestId('xterm-terminal')).not.toBeInTheDocument();
    expect(screen.getByText('No active terminal')).toBeInTheDocument();
  });

  it('should apply full-screen container styles to wrapper', () => {
    const { container } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle('flex-direction: column');
    expect(wrapper).toHaveStyle('width: 100%');
    expect(wrapper).toHaveStyle('height: 100%');
    expect(wrapper).toHaveStyle('overflow: hidden');
  });

  it('should render New Terminal button when hasSession is false and onCreateTerminal is provided', () => {
    const onCreateTerminal = vi.fn();
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
        onCreateTerminal={onCreateTerminal}
      />
    );

    const button = screen.getByTestId('new-terminal-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('New Terminal');
  });

  it('should not render New Terminal button when onCreateTerminal is not provided', () => {
    const { queryByTestId } = render(
      <TerminalTab
        terminal={null}
        hasSession={false}
      />
    );

    expect(queryByTestId('new-terminal-button')).not.toBeInTheDocument();
  });

  it('should call onCreateTerminal when button is clicked', async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
        onCreateTerminal={onCreateTerminal}
      />
    );

    const button = screen.getByTestId('new-terminal-button');
    await user.click(button);

    expect(onCreateTerminal).toHaveBeenCalledTimes(1);
  });

  it('should not render New Terminal button when hasSession is true', () => {
    const onCreateTerminal = vi.fn();
    const { queryByTestId } = render(
      <TerminalTab
        terminal={{ sessionId: 'test-session', wsUrl: 'ws://localhost:3737/terminal' }}
        hasSession={true}
        onCreateTerminal={onCreateTerminal}
      />
    );

    expect(queryByTestId('new-terminal-button')).not.toBeInTheDocument();
  });

  it('should apply accent button styling to New Terminal button', () => {
    const onCreateTerminal = vi.fn();
    render(
      <TerminalTab
        terminal={null}
        hasSession={false}
        onCreateTerminal={onCreateTerminal}
      />
    );

    const button = screen.getByTestId('new-terminal-button');
    expect(button).toHaveClass('bg-accent-500');
    expect(button).toHaveClass('hover:bg-accent-600');
    expect(button).toHaveClass('text-white');
    expect(button).toHaveClass('rounded-lg');
  });
});
