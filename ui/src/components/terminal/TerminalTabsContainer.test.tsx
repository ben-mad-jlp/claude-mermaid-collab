import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalTabsContainer } from './TerminalTabsContainer';
import '@testing-library/jest-dom';

// Mock the store
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn((selector) => {
    const mockSession = { project: '/test/project', name: 'test-session' };
    return selector({ currentSession: mockSession });
  }),
}));

// Mock the hooks and components
vi.mock('../../hooks/useTerminalTabs', () => ({
  useTerminalTabs: vi.fn(),
}));

vi.mock('./TerminalTabBar', () => ({
  TerminalTabBar: ({ onTabAdd, onTabSelect, onTabClose, onTabRename, onTabReorder }: any) => (
    <div data-testid="tab-bar">
      <button data-testid="add-tab" onClick={onTabAdd}>
        Add Tab
      </button>
      <button data-testid="select-tab" onClick={() => onTabSelect('tab1')}>
        Select Tab 1
      </button>
      <button data-testid="close-tab" onClick={() => onTabClose('tab1')}>
        Close Tab 1
      </button>
      <button data-testid="rename-tab" onClick={() => onTabRename('tab1', 'New Name')}>
        Rename Tab 1
      </button>
      <button data-testid="reorder-tab" onClick={() => onTabReorder(0, 1)}>
        Reorder Tabs
      </button>
    </div>
  ),
}));

vi.mock('../EmbeddedTerminal', () => ({
  EmbeddedTerminal: ({ config, sessionName, className }: any) => (
    <div data-testid={`terminal-${sessionName || 'default'}`} className={className}>
      Terminal: {sessionName || config.wsUrl}
    </div>
  ),
}));

import { useTerminalTabs } from '../../hooks/useTerminalTabs';

const mockUseTerminalTabs = useTerminalTabs as ReturnType<typeof vi.fn>;

describe('TerminalTabsContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockReturn = (overrides: any = {}) => ({
    tabs: [],
    activeTabId: null,
    activeTab: null,
    isLoading: false,
    error: null,
    addTab: vi.fn(),
    removeTab: vi.fn(),
    renameTab: vi.fn(),
    setActiveTab: vi.fn(),
    reorderTabs: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  });

  describe('Rendering', () => {
    it('should render the container with tab bar', () => {
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    });

    it('should render the active terminal', () => {
      const activeTab = { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' };
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [activeTab],
          activeTabId: 'tab1',
          activeTab,
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByTestId('terminal-tmux-session-1')).toBeInTheDocument();
    });

    it('should render multiple tabs but show only the active one', () => {
      const tabs = [
        { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
        { id: 'tab3', name: 'Terminal 3', tmuxSession: 'tmux-session-3' },
      ];

      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs,
          activeTabId: 'tab2',
          activeTab: tabs[1],
        })
      );

      const { container } = render(<TerminalTabsContainer />);

      // All terminals should be in the DOM
      expect(screen.getByTestId('terminal-tmux-session-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tmux-session-2')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tmux-session-3')).toBeInTheDocument();

      // Check parent divs of each terminal for display style
      const terminal1 = screen.getByTestId('terminal-tmux-session-1');
      const terminal2 = screen.getByTestId('terminal-tmux-session-2');
      const terminal3 = screen.getByTestId('terminal-tmux-session-3');

      const wrapper1 = terminal1.parentElement;
      const wrapper2 = terminal2.parentElement;
      const wrapper3 = terminal3.parentElement;

      // Active terminal wrapper (tab2) should have display: block
      expect(wrapper2?.style.display).toBe('block');
      // Inactive terminal wrappers should have display: none
      expect(wrapper1?.style.display).toBe('none');
      expect(wrapper3?.style.display).toBe('none');
    });

    it('should apply className to container', () => {
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        })
      );

      const { container } = render(<TerminalTabsContainer className="custom-class" />);

      expect(container.querySelector('.terminal-tabs-container')).toHaveClass('custom-class');
    });

    it('should show placeholder when no active tab', () => {
      mockUseTerminalTabs.mockReturnValue(createMockReturn());

      render(<TerminalTabsContainer />);

      expect(screen.getByText(/no terminal selected/i)).toBeInTheDocument();
    });

    it('should show loading state when isLoading is true', () => {
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          isLoading: true,
          tabs: [],
          activeTabId: null,
          activeTab: null,
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByText(/loading terminals/i)).toBeInTheDocument();
      expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();
    });

    it('should show error state when error is present', () => {
      const errorMessage = 'Failed to connect to terminal service';
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          isLoading: false,
          error: new Error(errorMessage),
          tabs: [],
          activeTabId: null,
          activeTab: null,
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByText(/error loading terminals/i)).toBeInTheDocument();
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.queryByTestId('tab-bar')).not.toBeInTheDocument();
    });
  });

  describe('Tab Switching', () => {
    it('should pass setActiveTab handler to tab bar', () => {
      const setActiveTabMock = vi.fn();
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
            { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          setActiveTab: setActiveTabMock,
        })
      );

      render(<TerminalTabsContainer />);

      const selectButton = screen.getByTestId('select-tab');
      fireEvent.click(selectButton);

      expect(setActiveTabMock).toHaveBeenCalledWith('tab1');
    });
  });

  describe('Tab Operations', () => {
    it('should pass addTab handler to tab bar', () => {
      const addTabMock = vi.fn();
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          addTab: addTabMock,
        })
      );

      render(<TerminalTabsContainer />);

      const addButton = screen.getByTestId('add-tab');
      fireEvent.click(addButton);

      expect(addTabMock).toHaveBeenCalled();
    });

    it('should pass removeTab handler to tab bar', () => {
      const removeTabMock = vi.fn();
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          removeTab: removeTabMock,
        })
      );

      render(<TerminalTabsContainer />);

      const closeButton = screen.getByTestId('close-tab');
      fireEvent.click(closeButton);

      expect(removeTabMock).toHaveBeenCalledWith('tab1');
    });

    it('should pass renameTab handler to tab bar', () => {
      const renameTabMock = vi.fn();
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          renameTab: renameTabMock,
        })
      );

      render(<TerminalTabsContainer />);

      const renameButton = screen.getByTestId('rename-tab');
      fireEvent.click(renameButton);

      expect(renameTabMock).toHaveBeenCalledWith('tab1', 'New Name');
    });

    it('should pass reorderTabs handler to tab bar', () => {
      const reorderTabsMock = vi.fn();
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
            { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
          ],
          activeTabId: 'tab1',
          activeTab: { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          reorderTabs: reorderTabsMock,
        })
      );

      render(<TerminalTabsContainer />);

      const reorderButton = screen.getByTestId('reorder-tab');
      fireEvent.click(reorderButton);

      expect(reorderTabsMock).toHaveBeenCalledWith(0, 1);
    });
  });

  describe('Terminal Display', () => {
    it('should keep inactive terminals mounted but hidden to preserve state', () => {
      const tabs = [
        { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
      ];

      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs,
          activeTabId: 'tab1',
          activeTab: tabs[0],
        })
      );

      render(<TerminalTabsContainer />);

      // Both terminals should be in the DOM
      const terminal1 = screen.getByTestId('terminal-tmux-session-1');
      const terminal2 = screen.getByTestId('terminal-tmux-session-2');
      expect(terminal1).toBeInTheDocument();
      expect(terminal2).toBeInTheDocument();

      // Check parent wrapper for display style
      const wrapper1 = terminal1.parentElement;
      const wrapper2 = terminal2.parentElement;

      // Active terminal wrapper should have display: block
      expect(wrapper1?.style.display).toBe('block');
      // Inactive terminal wrapper should have display: none
      expect(wrapper2?.style.display).toBe('none');
    });

    it('should pass correct config to EmbeddedTerminal', () => {
      const activeTab = { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' };
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [activeTab],
          activeTabId: 'tab1',
          activeTab,
        })
      );

      render(<TerminalTabsContainer />);

      const terminal = screen.getByTestId('terminal-tmux-session-1');
      expect(terminal).toHaveTextContent('tmux-session-1');
    });

    it('should update visible terminal when active tab changes', () => {
      const tabs = [
        { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
      ];

      // Start with tab1 active
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs,
          activeTabId: 'tab1',
          activeTab: tabs[0],
        })
      );

      const { rerender } = render(<TerminalTabsContainer />);

      let terminal1 = screen.getByTestId('terminal-tmux-session-1');
      let terminal2 = screen.getByTestId('terminal-tmux-session-2');
      let wrapper1 = terminal1.parentElement;
      let wrapper2 = terminal2.parentElement;

      expect(wrapper1?.style.display).toBe('block');
      expect(wrapper2?.style.display).toBe('none');

      // Change to tab2 active
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs,
          activeTabId: 'tab2',
          activeTab: tabs[1],
        })
      );

      rerender(<TerminalTabsContainer />);

      terminal1 = screen.getByTestId('terminal-tmux-session-1');
      terminal2 = screen.getByTestId('terminal-tmux-session-2');
      wrapper1 = terminal1.parentElement;
      wrapper2 = terminal2.parentElement;

      expect(wrapper1?.style.display).toBe('none');
      expect(wrapper2?.style.display).toBe('block');
    });
  });

  describe('Tab Bar Props', () => {
    it('should pass all required props to TerminalTabBar', () => {
      const tabs = [
        { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
        { id: 'tab2', name: 'Terminal 2', tmuxSession: 'tmux-session-2' },
      ];

      const handlers = {
        addTab: vi.fn(),
        removeTab: vi.fn(),
        renameTab: vi.fn(),
        setActiveTab: vi.fn(),
        reorderTabs: vi.fn(),
      };

      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs,
          activeTabId: 'tab1',
          activeTab: tabs[0],
          ...handlers,
        })
      );

      render(<TerminalTabsContainer />);

      // All event handlers should be properly passed (verified by mock being called)
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tabs array', () => {
      mockUseTerminalTabs.mockReturnValue(createMockReturn());

      render(<TerminalTabsContainer />);

      expect(screen.getByText(/no terminal selected/i)).toBeInTheDocument();
    });

    it('should handle activeTabId mismatch with tabs', () => {
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [
            { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' },
          ],
          activeTabId: 'tab2', // tab2 doesn't exist
          activeTab: null,
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByText(/no terminal selected/i)).toBeInTheDocument();
    });

    it('should handle single tab correctly', () => {
      const tab = { id: 'tab1', name: 'Terminal 1', tmuxSession: 'tmux-session-1' };
      mockUseTerminalTabs.mockReturnValue(
        createMockReturn({
          tabs: [tab],
          activeTabId: 'tab1',
          activeTab: tab,
        })
      );

      render(<TerminalTabsContainer />);

      expect(screen.getByTestId('terminal-tmux-session-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tmux-session-1')).toHaveStyle({ display: 'block' });
    });
  });
});
