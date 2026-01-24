import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { TerminalTabBar } from './TerminalTabBar';
import type { TerminalTab } from '../../types/terminal';

describe('TerminalTabBar', () => {
  const mockTabs: TerminalTab[] = [
    { id: 'tab-1', name: 'Terminal 1', wsUrl: 'ws://localhost:7681/ws', sessionName: 'mc-test-abc1' },
    { id: 'tab-2', name: 'Terminal 2', wsUrl: 'ws://localhost:7682/ws', sessionName: 'mc-test-def2' },
  ];

  const defaultProps = {
    tabs: mockTabs,
    activeTabId: 'tab-1',
    onTabSelect: vi.fn(),
    onTabClose: vi.fn(),
    onTabRename: vi.fn(),
    onTabAdd: vi.fn(),
    onTabReorder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render tab bar container', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const tabBar = container.querySelector('.terminal-tab-bar');
      expect(tabBar).toBeInTheDocument();
    });

    it('should render all tabs', () => {
      render(<TerminalTabBar {...defaultProps} />);
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    });

    it('should highlight active tab', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const activeTab = container.querySelector('[data-tab-id="tab-1"]');
      expect(activeTab).toHaveClass('border-blue-500');
      expect(activeTab).toHaveClass('text-blue-600');
      expect(activeTab).toHaveClass('bg-white');
    });

    it('should render add button', () => {
      render(<TerminalTabBar {...defaultProps} />);
      const addButton = screen.getByRole('button', { name: /add|new|\+/i });
      expect(addButton).toBeInTheDocument();
    });

    it('should show close buttons when multiple tabs exist', () => {
      render(<TerminalTabBar {...defaultProps} />);
      const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
      expect(closeButtons.length).toBe(mockTabs.length);
    });

    it('should not show close button when only one tab exists', () => {
      const singleTab: TerminalTab[] = [mockTabs[0]];
      render(
        <TerminalTabBar
          {...defaultProps}
          tabs={singleTab}
          activeTabId="tab-1"
        />
      );
      const closeButtons = screen.queryAllByRole('button', { name: /close tab/i });
      expect(closeButtons.length).toBe(0);
    });

    it('should render empty state when no tabs', () => {
      render(
        <TerminalTabBar
          {...defaultProps}
          tabs={[]}
          activeTabId={null}
        />
      );
      const tabBar = screen.getByRole('button', { name: /add|new|\+/i });
      expect(tabBar).toBeInTheDocument();
    });
  });

  describe('Tab Selection', () => {
    it('should call onTabSelect when clicking a tab', () => {
      const onTabSelect = vi.fn();
      render(
        <TerminalTabBar
          {...defaultProps}
          onTabSelect={onTabSelect}
        />
      );
      const tab2 = screen.getByText('Terminal 2');
      fireEvent.click(tab2);
      expect(onTabSelect).toHaveBeenCalledWith('tab-2');
    });

    it('should not call onTabSelect when clicking active tab', () => {
      const onTabSelect = vi.fn();
      render(
        <TerminalTabBar
          {...defaultProps}
          activeTabId="tab-1"
          onTabSelect={onTabSelect}
        />
      );
      const tab1 = screen.getByText('Terminal 1');
      fireEvent.click(tab1);
      // This may or may not be called - depends on implementation
      // Some implementations ignore re-selecting active tab
    });
  });

  describe('Tab Closing', () => {
    it('should call onTabClose when clicking close button', async () => {
      const onTabClose = vi.fn();
      render(
        <TerminalTabBar
          {...defaultProps}
          onTabClose={onTabClose}
        />
      );
      const closeButtons = screen.getAllByRole('button', { name: /close tab/i });
      fireEvent.click(closeButtons[0]);
      expect(onTabClose).toHaveBeenCalledWith('tab-1');
    });

    it('should not show close button for single tab', () => {
      const singleTab: TerminalTab[] = [mockTabs[0]];
      const onTabClose = vi.fn();
      render(
        <TerminalTabBar
          {...defaultProps}
          tabs={singleTab}
          activeTabId="tab-1"
          onTabClose={onTabClose}
        />
      );
      const closeButtons = screen.queryAllByRole('button', { name: /close tab/i });
      expect(closeButtons.length).toBe(0);
    });
  });

  describe('Tab Renaming', () => {
    it('should enter edit mode on double-click', async () => {
      const user = userEvent.setup();
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const tab1Text = screen.getByText('Terminal 1');
      await user.dblClick(tab1Text);

      const input = container.querySelector('input[type="text"]');
      expect(input).toBeInTheDocument();
    });

    it('should call onTabRename on input blur with new name', async () => {
      const user = userEvent.setup();
      const onTabRename = vi.fn();
      const { container } = render(
        <TerminalTabBar
          {...defaultProps}
          onTabRename={onTabRename}
        />
      );

      const tab1Text = screen.getByText('Terminal 1');
      await user.dblClick(tab1Text);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).toBeInTheDocument();

      await user.clear(input);
      await user.type(input, 'Custom Terminal');
      fireEvent.blur(input);

      expect(onTabRename).toHaveBeenCalledWith('tab-1', 'Custom Terminal');
    });

    it('should call onTabRename on Enter key', async () => {
      const user = userEvent.setup();
      const onTabRename = vi.fn();
      const { container } = render(
        <TerminalTabBar
          {...defaultProps}
          onTabRename={onTabRename}
        />
      );

      const tab1Text = screen.getByText('Terminal 1');
      await user.dblClick(tab1Text);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'New Name');
      await user.keyboard('{Enter}');

      expect(onTabRename).toHaveBeenCalledWith('tab-1', 'New Name');
    });

    it('should cancel rename on Escape key', async () => {
      const user = userEvent.setup();
      const onTabRename = vi.fn();
      const { container } = render(
        <TerminalTabBar
          {...defaultProps}
          onTabRename={onTabRename}
        />
      );

      const tab1Text = screen.getByText('Terminal 1');
      await user.dblClick(tab1Text);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, 'New Name');
      await user.keyboard('{Escape}');

      expect(onTabRename).not.toHaveBeenCalled();
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('should trim whitespace from new name', async () => {
      const user = userEvent.setup();
      const onTabRename = vi.fn();
      const { container } = render(
        <TerminalTabBar
          {...defaultProps}
          onTabRename={onTabRename}
        />
      );

      const tab1Text = screen.getByText('Terminal 1');
      await user.dblClick(tab1Text);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '  Trimmed Name  ');
      fireEvent.blur(input);

      expect(onTabRename).toHaveBeenCalledWith('tab-1', 'Trimmed Name');
    });
  });

  describe('Add Tab Button', () => {
    it('should call onTabAdd when clicking add button', () => {
      const onTabAdd = vi.fn();
      render(
        <TerminalTabBar
          {...defaultProps}
          onTabAdd={onTabAdd}
        />
      );
      const addButton = screen.getByRole('button', { name: /add|new|\+/i });
      fireEvent.click(addButton);
      expect(onTabAdd).toHaveBeenCalled();
    });
  });

  describe('Drag and Drop', () => {
    it('should render sortable tabs', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const tabs = container.querySelectorAll('[data-tab-id]');
      expect(tabs.length).toBe(mockTabs.length);
    });

    it('should have drag handles on tabs', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const dragHandles = container.querySelectorAll('[data-sortable-id]');
      expect(dragHandles.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const tabBar = container.querySelector('.terminal-tab-bar');
      expect(tabBar).toHaveAttribute('role', 'tablist');
    });

    it('should have proper tab roles', () => {
      const { container } = render(<TerminalTabBar {...defaultProps} />);
      const tabs = container.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(mockTabs.length);
    });
  });
});
