import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTab } from '../TerminalTab';
import type { TerminalSession } from '../../../types/terminal';

// Mock XTermTerminal component
vi.mock('../../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ sessionId, wsUrl, className }) => (
    <div data-testid="xterm-terminal" data-session-id={sessionId} data-ws-url={wsUrl} className={className}>
      Terminal Component
    </div>
  )),
}));

// Mock MobileTerminalTabBar component
vi.mock('../MobileTerminalTabBar', () => ({
  MobileTerminalTabBar: vi.fn(({ tabs, activeTabId, onTabSelect, onTabClose, onTabAdd }) => (
    <div data-testid="mobile-terminal-tab-bar">
      {tabs.map((tab: TerminalSession) => (
        <button
          key={tab.id}
          data-testid={`tab-${tab.id}`}
          data-active={tab.id === activeTabId}
          onClick={() => onTabSelect(tab.id)}
        >
          {tab.name}
          <span data-testid={`close-${tab.id}`} onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}>X</span>
        </button>
      ))}
      <button data-testid="add-tab-button" onClick={onTabAdd}>+</button>
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

const createMockTab = (id: string, name: string): TerminalSession => ({
  id,
  name,
  tmuxSession: `tmux-${id}`,
  created: new Date().toISOString(),
  order: 0,
});

describe('TerminalTab (__tests__ variant)', () => {
  const defaultProps = {
    tabs: [] as TerminalSession[],
    activeTabId: null as string | null,
    activeTab: null as TerminalSession | null,
    isLoading: false,
    error: null as Error | null,
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onTabAdd: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render terminal component when session is active', () => {
    const tab = createMockTab('active-session', 'Terminal 1');
    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
      />
    );

    expect(screen.getByTestId('xterm-terminal')).toBeInTheDocument();
  });

  it('should display no active terminal message when no tabs', () => {
    render(<TerminalTab {...defaultProps} tabs={[]} />);

    expect(screen.getByText('No active terminal')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm-terminal')).not.toBeInTheDocument();
  });

  it('should properly configure terminal with session ID', () => {
    const tab = createMockTab('unique-session-id-12345', 'Terminal 1');

    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-session-id', 'unique-session-id-12345');
  });

  it('should use /terminal as websocket URL', () => {
    const tab = createMockTab('test-session', 'Terminal 1');

    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
      />
    );

    const terminal = screen.getByTestId('xterm-terminal');
    expect(terminal).toHaveAttribute('data-ws-url', '/terminal');
  });

  it('should manage full-screen layout on container', () => {
    const tab = createMockTab('test-session', 'Terminal 1');

    const { container } = render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
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

  it('should center placeholder text when no tabs', () => {
    render(<TerminalTab {...defaultProps} tabs={[]} />);

    const placeholder = screen.getByText('No active terminal');
    expect(placeholder).toBeInTheDocument();

    const parent = placeholder.parentElement;
    const computedStyle = window.getComputedStyle(parent!);

    expect(computedStyle.display).toBe('flex');
  });

  it('should apply overflow hidden to container for proper sizing', () => {
    const tab = createMockTab('test-session', 'Terminal 1');

    const { container } = render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
      />
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle('overflow: hidden');
  });

  it('should show loading state', () => {
    render(<TerminalTab {...defaultProps} isLoading={true} />);

    expect(screen.getByText('Loading terminals...')).toBeInTheDocument();
    expect(screen.queryByTestId('xterm-terminal')).not.toBeInTheDocument();
  });

  it('should show error state', () => {
    const error = new Error('Failed to load terminals');
    render(<TerminalTab {...defaultProps} error={error} />);

    expect(screen.getByText('Error loading terminals')).toBeInTheDocument();
    expect(screen.getByText('Failed to load terminals')).toBeInTheDocument();
  });

  it('should render tab bar when tabs exist', () => {
    const tab = createMockTab('test-session', 'Terminal 1');

    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
      />
    );

    expect(screen.getByTestId('mobile-terminal-tab-bar')).toBeInTheDocument();
  });

  it('should call onTabAdd when New Terminal button is clicked', async () => {
    const user = userEvent.setup();
    const onTabAdd = vi.fn();

    render(<TerminalTab {...defaultProps} tabs={[]} onTabAdd={onTabAdd} />);

    await user.click(screen.getByTestId('new-terminal-button'));
    expect(onTabAdd).toHaveBeenCalledTimes(1);
  });

  it('should call onTabSelect when tab is clicked', async () => {
    const user = userEvent.setup();
    const onTabSelect = vi.fn();
    const tab1 = createMockTab('tab-1', 'Terminal 1');
    const tab2 = createMockTab('tab-2', 'Terminal 2');

    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab1, tab2]}
        activeTabId={tab1.id}
        activeTab={tab1}
        onTabSelect={onTabSelect}
      />
    );

    await user.click(screen.getByTestId('tab-tab-2'));
    expect(onTabSelect).toHaveBeenCalledWith('tab-2');
  });

  it('should call onTabClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onTabClose = vi.fn();
    const tab = createMockTab('tab-1', 'Terminal 1');

    render(
      <TerminalTab
        {...defaultProps}
        tabs={[tab]}
        activeTabId={tab.id}
        activeTab={tab}
        onTabClose={onTabClose}
      />
    );

    await user.click(screen.getByTestId('close-tab-1'));
    expect(onTabClose).toHaveBeenCalledWith('tab-1');
  });

  it('should pass color styling to placeholder', () => {
    render(<TerminalTab {...defaultProps} tabs={[]} />);

    const placeholder = screen.getByText('No active terminal');
    const parent = placeholder.closest('div[style]');

    expect(parent).toHaveStyle('color: #999');
  });
});
