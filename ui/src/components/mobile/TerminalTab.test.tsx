import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTab } from './TerminalTab';
import type { TerminalSession } from '../../types/terminal';

// Mock XTermTerminal component
vi.mock('../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ sessionId, wsUrl, className }) => (
    <div data-testid="xterm-terminal" data-session-id={sessionId} data-ws-url={wsUrl} className={className}>
      Terminal Component
    </div>
  )),
}));

// Mock MobileTerminalTabBar component
vi.mock('./MobileTerminalTabBar', () => ({
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

describe('TerminalTab', () => {
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

  describe('Loading state', () => {
    it('should render loading message when isLoading is true', () => {
      render(<TerminalTab {...defaultProps} isLoading={true} />);
      expect(screen.getByText('Loading terminals...')).toBeInTheDocument();
    });

    it('should not render tab bar when loading', () => {
      render(<TerminalTab {...defaultProps} isLoading={true} />);
      expect(screen.queryByTestId('mobile-terminal-tab-bar')).not.toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('should render error message when error exists', () => {
      const error = new Error('Failed to load terminals');
      render(<TerminalTab {...defaultProps} error={error} />);
      expect(screen.getByText('Error loading terminals')).toBeInTheDocument();
      expect(screen.getByText('Failed to load terminals')).toBeInTheDocument();
    });

    it('should render retry button when error exists', () => {
      const error = new Error('Failed to load terminals');
      render(<TerminalTab {...defaultProps} error={error} />);
      expect(screen.getByTestId('retry-terminal-button')).toBeInTheDocument();
    });

    it('should call onTabAdd when retry button is clicked', async () => {
      const user = userEvent.setup();
      const error = new Error('Failed to load terminals');
      const onTabAdd = vi.fn();
      render(<TerminalTab {...defaultProps} error={error} onTabAdd={onTabAdd} />);

      await user.click(screen.getByTestId('retry-terminal-button'));
      expect(onTabAdd).toHaveBeenCalledTimes(1);
    });
  });

  describe('No tabs state', () => {
    it('should render "No active terminal" when tabs array is empty', () => {
      render(<TerminalTab {...defaultProps} tabs={[]} />);
      expect(screen.getByText('No active terminal')).toBeInTheDocument();
    });

    it('should render New Terminal button when no tabs', () => {
      render(<TerminalTab {...defaultProps} tabs={[]} />);
      expect(screen.getByTestId('new-terminal-button')).toBeInTheDocument();
    });

    it('should call onTabAdd when New Terminal button is clicked', async () => {
      const user = userEvent.setup();
      const onTabAdd = vi.fn();
      render(<TerminalTab {...defaultProps} tabs={[]} onTabAdd={onTabAdd} />);

      await user.click(screen.getByTestId('new-terminal-button'));
      expect(onTabAdd).toHaveBeenCalledTimes(1);
    });

    it('should apply accent button styling to New Terminal button', () => {
      render(<TerminalTab {...defaultProps} tabs={[]} />);
      const button = screen.getByTestId('new-terminal-button');
      expect(button).toHaveClass('bg-accent-500');
      expect(button).toHaveClass('hover:bg-accent-600');
      expect(button).toHaveClass('text-white');
      expect(button).toHaveClass('rounded-lg');
    });
  });

  describe('With tabs', () => {
    const tab1 = createMockTab('tab-1', 'Terminal 1');
    const tab2 = createMockTab('tab-2', 'Terminal 2');

    it('should render tab bar when tabs exist', () => {
      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
        />
      );
      expect(screen.getByTestId('mobile-terminal-tab-bar')).toBeInTheDocument();
    });

    it('should render XTermTerminal for active tab', () => {
      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
        />
      );
      expect(screen.getByTestId('xterm-terminal')).toBeInTheDocument();
    });

    it('should pass correct sessionId to XTermTerminal', () => {
      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
        />
      );
      const terminal = screen.getByTestId('xterm-terminal');
      expect(terminal).toHaveAttribute('data-session-id', 'tab-1');
    });

    it('should pass /terminal as wsUrl to XTermTerminal', () => {
      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
        />
      );
      const terminal = screen.getByTestId('xterm-terminal');
      expect(terminal).toHaveAttribute('data-ws-url', '/terminal');
    });

    it('should render all tabs but only show active one', () => {
      const { container } = render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1, tab2]}
          activeTabId={tab1.id}
          activeTab={tab1}
        />
      );

      // All terminals should be in DOM
      const terminals = container.querySelectorAll('[data-testid="xterm-terminal"]');
      expect(terminals.length).toBe(2);
    });

    it('should call onTabSelect when a tab is selected', async () => {
      const user = userEvent.setup();
      const onTabSelect = vi.fn();

      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1, tab2]}
          activeTabId={tab1.id}
          activeTab={tab1}
          onTabSelect={onTabSelect}
        />
      );

      await user.click(screen.getByTestId(`tab-${tab2.id}`));
      expect(onTabSelect).toHaveBeenCalledWith(tab2.id);
    });

    it('should call onTabClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onTabClose = vi.fn();

      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
          onTabClose={onTabClose}
        />
      );

      await user.click(screen.getByTestId(`close-${tab1.id}`));
      expect(onTabClose).toHaveBeenCalledWith(tab1.id);
    });

    it('should call onTabAdd when add button is clicked', async () => {
      const user = userEvent.setup();
      const onTabAdd = vi.fn();

      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={tab1.id}
          activeTab={tab1}
          onTabAdd={onTabAdd}
        />
      );

      await user.click(screen.getByTestId('add-tab-button'));
      expect(onTabAdd).toHaveBeenCalledTimes(1);
    });

    it('should show "No terminal selected" when tabs exist but no activeTab', () => {
      render(
        <TerminalTab
          {...defaultProps}
          tabs={[tab1]}
          activeTabId={null}
          activeTab={null}
        />
      );
      expect(screen.getByText('No terminal selected')).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('should have full-screen flex layout', () => {
      const { container } = render(<TerminalTab {...defaultProps} tabs={[]} />);
      const wrapper = container.firstChild as HTMLElement;

      expect(wrapper).toHaveStyle('display: flex');
      expect(wrapper).toHaveStyle('flex: 1');
      expect(wrapper).toHaveStyle('min-height: 0');
      expect(wrapper).toHaveStyle('width: 100%');
      expect(wrapper).toHaveStyle('height: 100%');
      expect(wrapper).toHaveStyle('overflow: hidden');
    });

    it('should apply custom className', () => {
      const { container } = render(
        <TerminalTab {...defaultProps} tabs={[]} className="custom-class" />
      );
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-class');
    });
  });
});
