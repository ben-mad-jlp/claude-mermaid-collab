import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileTerminalTabBar } from './MobileTerminalTabBar';
import type { TerminalSession } from '../../types/terminal';

const createMockTab = (id: string, name: string, order: number = 0): TerminalSession => ({
  id,
  name,
  tmuxSession: `tmux-${id}`,
  created: new Date().toISOString(),
  order,
});

describe('MobileTerminalTabBar', () => {
  const defaultProps = {
    tabs: [] as TerminalSession[],
    activeTabId: null as string | null,
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onTabAdd: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the tab bar container', () => {
      render(<MobileTerminalTabBar {...defaultProps} />);
      expect(screen.getByTestId('mobile-terminal-tab-bar')).toBeInTheDocument();
    });

    it('should render add terminal button', () => {
      render(<MobileTerminalTabBar {...defaultProps} />);
      expect(screen.getByTestId('add-terminal-tab')).toBeInTheDocument();
    });

    it('should render tabs when provided', () => {
      const tabs = [createMockTab('tab-1', 'Terminal 1')];
      render(<MobileTerminalTabBar {...defaultProps} tabs={tabs} />);
      expect(screen.getByTestId('terminal-tab-tab-1')).toBeInTheDocument();
    });

    it('should render multiple tabs', () => {
      const tabs = [
        createMockTab('tab-1', 'Terminal 1'),
        createMockTab('tab-2', 'Terminal 2'),
        createMockTab('tab-3', 'Terminal 3'),
      ];
      render(<MobileTerminalTabBar {...defaultProps} tabs={tabs} />);
      expect(screen.getByTestId('terminal-tab-tab-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-tab-2')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-tab-3')).toBeInTheDocument();
    });

    it('should display tab names', () => {
      const tabs = [createMockTab('tab-1', 'My Terminal')];
      render(<MobileTerminalTabBar {...defaultProps} tabs={tabs} />);
      expect(screen.getByText('My Terminal')).toBeInTheDocument();
    });
  });

  describe('Active tab highlighting', () => {
    it('should mark active tab with aria-selected', () => {
      const tabs = [
        createMockTab('tab-1', 'Terminal 1'),
        createMockTab('tab-2', 'Terminal 2'),
      ];
      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-2"
        />
      );

      const tab1 = screen.getByTestId('terminal-tab-tab-1');
      const tab2 = screen.getByTestId('terminal-tab-tab-2');

      expect(tab1).toHaveAttribute('aria-selected', 'false');
      expect(tab2).toHaveAttribute('aria-selected', 'true');
    });

    it('should apply different styles to active tab', () => {
      const tabs = [createMockTab('tab-1', 'Terminal 1')];
      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
        />
      );

      const tab = screen.getByTestId('terminal-tab-tab-1');
      expect(tab).toHaveClass('bg-white');
      expect(tab).toHaveClass('text-blue-600');
    });

    it('should apply inactive styles to non-active tabs', () => {
      const tabs = [createMockTab('tab-1', 'Terminal 1')];
      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId={null}
        />
      );

      const tab = screen.getByTestId('terminal-tab-tab-1');
      expect(tab).toHaveClass('text-gray-600');
    });
  });

  describe('Tab interactions', () => {
    it('should call onTabSelect when tab is clicked', async () => {
      const user = userEvent.setup();
      const onTabSelect = vi.fn();
      const tabs = [createMockTab('tab-1', 'Terminal 1')];

      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          onTabSelect={onTabSelect}
        />
      );

      await user.click(screen.getByTestId('terminal-tab-tab-1'));
      expect(onTabSelect).toHaveBeenCalledWith('tab-1');
    });

    it('should call onTabClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onTabClose = vi.fn();
      const tabs = [createMockTab('tab-1', 'Terminal 1')];

      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          onTabClose={onTabClose}
        />
      );

      await user.click(screen.getByTestId('close-tab-tab-1'));
      expect(onTabClose).toHaveBeenCalledWith('tab-1');
    });

    it('should not trigger onTabSelect when close button is clicked', async () => {
      const user = userEvent.setup();
      const onTabSelect = vi.fn();
      const onTabClose = vi.fn();
      const tabs = [createMockTab('tab-1', 'Terminal 1')];

      render(
        <MobileTerminalTabBar
          {...defaultProps}
          tabs={tabs}
          onTabSelect={onTabSelect}
          onTabClose={onTabClose}
        />
      );

      await user.click(screen.getByTestId('close-tab-tab-1'));
      expect(onTabClose).toHaveBeenCalledWith('tab-1');
      expect(onTabSelect).not.toHaveBeenCalled();
    });

    it('should call onTabAdd when add button is clicked', async () => {
      const user = userEvent.setup();
      const onTabAdd = vi.fn();

      render(<MobileTerminalTabBar {...defaultProps} onTabAdd={onTabAdd} />);

      await user.click(screen.getByTestId('add-terminal-tab'));
      expect(onTabAdd).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should have tablist role on container', () => {
      render(<MobileTerminalTabBar {...defaultProps} />);
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    it('should have tab role on each tab', () => {
      const tabs = [createMockTab('tab-1', 'Terminal 1')];
      render(<MobileTerminalTabBar {...defaultProps} tabs={tabs} />);
      expect(screen.getByRole('tab')).toBeInTheDocument();
    });

    it('should have aria-label on close button', () => {
      const tabs = [createMockTab('tab-1', 'Terminal 1')];
      render(<MobileTerminalTabBar {...defaultProps} tabs={tabs} />);

      const closeButton = screen.getByTestId('close-tab-tab-1');
      expect(closeButton).toHaveAttribute('aria-label', 'Close Terminal 1');
    });

    it('should have aria-label on add button', () => {
      render(<MobileTerminalTabBar {...defaultProps} />);

      const addButton = screen.getByTestId('add-terminal-tab');
      expect(addButton).toHaveAttribute('aria-label', 'Add new terminal');
    });
  });
});
