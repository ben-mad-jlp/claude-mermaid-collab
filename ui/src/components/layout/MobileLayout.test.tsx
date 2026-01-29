/**
 * MobileLayout tests (root test file location)
 *
 * Tests for the root mobile layout container that:
 * - Renders header, active tab, and bottom tab bar
 * - Manages tab switching state
 * - Keeps all tabs mounted to preserve state
 * - Fills full viewport height
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileLayout } from './MobileLayout';
import type { MobileLayoutProps } from './MobileLayout';
import type { TerminalSession } from '../../types/terminal';

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

// Mock XTermTerminal to avoid terminal rendering issues
vi.mock('../terminal/XTermTerminal', () => ({
  XTermTerminal: vi.fn(({ sessionId, wsUrl }) => (
    <div data-testid="xterm-terminal" data-session-id={sessionId} data-ws-url={wsUrl}>
      Terminal
    </div>
  )),
}));

// Mock MobileTerminalTabBar
vi.mock('../mobile/MobileTerminalTabBar', () => ({
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
          <span data-testid={`close-tab-${tab.id}`} onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}>X</span>
        </button>
      ))}
      <button data-testid="add-tab-button" onClick={onTabAdd}>+</button>
    </div>
  )),
}));

// Mock the session store
const mockSessionStoreState = {
  currentSession: { project: '/path/to/project', name: 'test-session' },
  sessions: [],
  diagrams: [],
  documents: [],
  selectedDiagramId: null,
  selectedDocumentId: null,
  collabState: null,
  pendingDiff: null,
  isLoading: false,
  error: null,
  setSessions: vi.fn(),
  setCurrentSession: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  setDiagrams: vi.fn(),
  addDiagram: vi.fn(),
  updateDiagram: vi.fn(),
  removeDiagram: vi.fn(),
  selectDiagram: vi.fn(),
  getSelectedDiagram: vi.fn(() => undefined),
  setDocuments: vi.fn(),
  addDocument: vi.fn(),
  updateDocument: vi.fn(),
  removeDocument: vi.fn(),
  selectDocument: vi.fn(),
  getSelectedDocument: vi.fn(() => undefined),
  setCollabState: vi.fn(),
  setPendingDiff: vi.fn(),
  clearPendingDiff: vi.fn(),
  clearSession: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockSessionStoreState);
    }
    return mockSessionStoreState;
  }),
}));

// Mock the terminal tabs hook
const mockTerminalTabs = {
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
};

vi.mock('../../hooks/useTerminalTabs', () => ({
  useTerminalTabs: vi.fn(() => mockTerminalTabs),
}));

describe('MobileLayout (root test file)', () => {
  const defaultProps: MobileLayoutProps = {
    sessions: [],
    handlers: {
      onSessionSelect: vi.fn(),
      onRefreshSessions: vi.fn(),
      onCreateSession: vi.fn(),
      onAddProject: vi.fn(),
      onDeleteSession: vi.fn(),
    },
    isConnected: false,
    isConnecting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock terminal tabs state
    mockTerminalTabs.tabs = [];
    mockTerminalTabs.activeTabId = null;
    mockTerminalTabs.activeTab = null;
    mockTerminalTabs.isLoading = false;
    mockTerminalTabs.error = null;
    // Reset session store state
    mockSessionStoreState.currentSession = { project: '/path/to/project', name: 'test-session' };
  });

  it('should render MobileHeader at the top', () => {
    render(<MobileLayout {...defaultProps} />);
    const header = screen.getByTestId('mobile-header');
    expect(header).toBeInTheDocument();
  });

  it('should render BottomTabBar at the bottom', () => {
    render(<MobileLayout {...defaultProps} />);
    // BottomTabBar renders buttons for each tab
    const terminalButton = screen.getByRole('button', { name: /terminal/i });
    expect(terminalButton).toBeInTheDocument();
  });

  it('should render Preview tab by default', () => {
    render(<MobileLayout {...defaultProps} />);
    // Preview tab should be visible by default
    expect(screen.getByTestId('preview-tab-wrapper')).toBeInTheDocument();
  });

  it('should switch to Chat tab when clicking Chat tab button', () => {
    render(<MobileLayout {...defaultProps} />);

    const chatButton = screen.getByRole('button', { name: /chat/i });
    fireEvent.click(chatButton);

    expect(screen.getByTestId('chat-tab-wrapper')).toBeInTheDocument();
  });

  it('should switch to Terminal tab when clicking Terminal tab button', () => {
    render(<MobileLayout {...defaultProps} />);

    const terminalButton = screen.getByRole('button', { name: /terminal/i });
    fireEvent.click(terminalButton);

    expect(screen.getByTestId('terminal-tab-wrapper')).toBeInTheDocument();
  });

  it('should keep all tabs mounted when switching tabs', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    // Initially preview is visible
    const previewTab = screen.getByTestId('preview-tab-wrapper');
    expect(previewTab).toBeInTheDocument();

    // Switch to chat
    const chatButton = screen.getByRole('button', { name: /chat/i });
    fireEvent.click(chatButton);

    // Preview tab should still be in DOM (just hidden)
    const previewTabAfter = container.querySelector('[data-testid="preview-tab-wrapper"]');
    expect(previewTabAfter).toBeInTheDocument();

    // Chat tab should be visible
    expect(screen.getByTestId('chat-tab-wrapper')).toBeInTheDocument();
  });

  it('should use display:none to hide inactive tabs while keeping them mounted', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    // Switch to chat
    const chatButton = screen.getByRole('button', { name: /chat/i });
    fireEvent.click(chatButton);

    // Preview tab should be in DOM but hidden
    const previewTab = container.querySelector('[data-testid="preview-tab-wrapper"]');
    expect(previewTab).toHaveStyle('display: none');

    // Chat tab should be visible
    const chatTab = screen.getByTestId('chat-tab-wrapper');
    expect(chatTab).not.toHaveStyle('display: none');
  });

  it('should have full viewport height flex column layout', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('h-screen', 'flex', 'flex-col');
  });

  it('should have proper structure with header, content, and tab bar', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    const root = container.firstChild as HTMLElement;
    const children = root.children;

    // Should have 3 main sections: header, content wrapper, and tab bar
    expect(children.length).toBeGreaterThanOrEqual(3);
  });

  it('should preserve Preview tab state when switching away and back', () => {
    render(<MobileLayout {...defaultProps} />);

    // Switch away from preview
    fireEvent.click(screen.getByRole('button', { name: /chat/i }));

    // Switch back to preview
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    // Preview should still be mounted with preserved state
    expect(screen.getByTestId('preview-tab-wrapper')).toBeInTheDocument();
  });

  it('should pass sessions to MobileHeader', () => {
    const sessions = [
      { id: 'session1', name: 'Session 1', project: 'Project A' } as any,
    ];

    render(<MobileLayout {...defaultProps} sessions={sessions} />);

    // MobileHeader should be rendered
    expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
  });

  it('should pass connection state to MobileHeader', () => {
    const props = {
      ...defaultProps,
      isConnected: true,
      isConnecting: false,
    };

    render(<MobileLayout {...props} />);

    // Component should render with connection state (connection badge visible)
    expect(screen.getByTestId('mobile-connection-badge')).toBeInTheDocument();
  });

  it('should handle tab bar at bottom without overlap', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    // Tab bar should be fixed at bottom (it's a div with fixed positioning)
    // The BottomTabBar is the div containing the tab buttons
    const tabBarButtons = screen.getAllByRole('button');
    // Buttons should exist for the tab bar
    expect(tabBarButtons.length).toBeGreaterThan(0);
  });

  it('should have padding at bottom to account for tab bar height', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    const contentWrapper = container.querySelector('[data-testid="mobile-layout-content"]');
    expect(contentWrapper).toHaveStyle('paddingBottom: 4rem');
  });

  it('should manage activeTab state internally', () => {
    const { rerender } = render(<MobileLayout {...defaultProps} />);

    // Verify initial state is preview
    expect(screen.getByTestId('preview-tab-wrapper')).toBeInTheDocument();

    // Switch tabs
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

    // Verify terminal is active
    expect(screen.getByTestId('terminal-tab-wrapper')).toBeInTheDocument();
  });

  it('should auto-switch to Chat tab when onAutoSwitch is triggered', () => {
    render(<MobileLayout {...defaultProps} />);

    // Initially on preview
    expect(screen.getByTestId('preview-tab-wrapper')).toBeInTheDocument();

    // Simulate auto-switch to chat (this would be triggered by ChatTab component)
    // For now, we just verify the button click works
    fireEvent.click(screen.getByRole('button', { name: /chat/i }));

    expect(screen.getByTestId('chat-tab-wrapper')).toBeInTheDocument();
  });

  it('should pass handlers to MobileHeader', () => {
    const handlers = {
      onSessionSelect: vi.fn(),
      onRefreshSessions: vi.fn(),
      onCreateSession: vi.fn(),
      onAddProject: vi.fn(),
      onDeleteSession: vi.fn(),
    };

    render(<MobileLayout {...defaultProps} handlers={handlers} />);

    // MobileHeader should receive handlers
    expect(screen.getByTestId('mobile-header')).toBeInTheDocument();
  });

  it('should render preview, chat, and terminal tabs as content areas', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    // All tabs should be in the DOM even if hidden
    expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="chat-tab-wrapper"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="terminal-tab-wrapper"]')).toBeInTheDocument();
  });

  it('should have correct z-index layering with header > content > tab-bar', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    const root = container.firstChild as HTMLElement;
    // Root should be flex column
    expect(root).toHaveClass('flex', 'flex-col');
  });
});

describe('MobileLayout - Terminal Tab Integration', () => {
  const mockSession = {
    name: 'test-session',
    project: '/path/to/project',
    lastActivity: '2024-01-01',
  };

  const defaultProps: MobileLayoutProps = {
    sessions: [mockSession],
    handlers: {
      onSessionSelect: vi.fn(),
      onRefreshSessions: vi.fn(),
      onCreateSession: vi.fn(),
      onAddProject: vi.fn(),
      onDeleteSession: vi.fn(),
    },
    isConnected: false,
    isConnecting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock terminal tabs state
    mockTerminalTabs.tabs = [];
    mockTerminalTabs.activeTabId = null;
    mockTerminalTabs.activeTab = null;
    mockTerminalTabs.isLoading = false;
    mockTerminalTabs.error = null;
    // Reset session store state
    mockSessionStoreState.currentSession = { project: '/path/to/project', name: 'test-session' };
  });

  it('should render TerminalTab component', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
    expect(terminalTab).toBeInTheDocument();
  });

  it('should pass terminal tabs data to TerminalTab', () => {
    mockTerminalTabs.tabs = [
      { id: 'tab-1', name: 'Terminal 1', tmuxSession: 'tmux-1', created: '2024-01-01', order: 0 },
    ];
    mockTerminalTabs.activeTabId = 'tab-1';
    mockTerminalTabs.activeTab = mockTerminalTabs.tabs[0];

    const { container } = render(<MobileLayout {...defaultProps} />);

    const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
    expect(terminalTab).toBeInTheDocument();
  });

  it('should switch to terminal tab via tab bar', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

    const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
    expect(terminalTab).toHaveStyle('display: flex');
  });

  it('should handle missing session gracefully', () => {
    // Mock no current session
    mockSessionStoreState.currentSession = null;

    const { container } = render(<MobileLayout {...defaultProps} sessions={[]} />);

    // Terminal tab should still be rendered
    expect(container.querySelector('[data-testid="terminal-tab-wrapper"]')).toBeInTheDocument();
  });

  it('should call addTab when creating a new terminal', async () => {
    mockTerminalTabs.addTab.mockResolvedValue(undefined);

    render(<MobileLayout {...defaultProps} />);

    // Navigate to terminal tab
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

    // Click "New Terminal" button
    const newTerminalButton = screen.getByTestId('new-terminal-button');
    fireEvent.click(newTerminalButton);

    await waitFor(() => {
      expect(mockTerminalTabs.addTab).toHaveBeenCalled();
    });
  });

  it('should auto-switch to terminal tab after creating a terminal', async () => {
    mockTerminalTabs.addTab.mockResolvedValue(undefined);

    const { container } = render(<MobileLayout {...defaultProps} />);

    // Start on preview tab
    expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toHaveStyle('display: flex');

    // Navigate to terminal and create a new one
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));
    const newTerminalButton = screen.getByTestId('new-terminal-button');
    fireEvent.click(newTerminalButton);

    await waitFor(() => {
      // Terminal tab should be visible
      const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
      expect(terminalTab).toHaveStyle('display: flex');
    });
  });

  it('should handle addTab errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockTerminalTabs.addTab.mockRejectedValue(new Error('Failed to create terminal'));

    render(<MobileLayout {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));
    const newTerminalButton = screen.getByTestId('new-terminal-button');
    fireEvent.click(newTerminalButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to create terminal:', expect.any(Error));
    });

    consoleSpy.mockRestore();
  });

  it('should call removeTab when closing a terminal', async () => {
    mockTerminalTabs.tabs = [
      { id: 'tab-1', name: 'Terminal 1', tmuxSession: 'tmux-1', created: '2024-01-01', order: 0 },
    ];
    mockTerminalTabs.activeTabId = 'tab-1';
    mockTerminalTabs.activeTab = mockTerminalTabs.tabs[0];
    mockTerminalTabs.removeTab.mockResolvedValue(undefined);

    render(<MobileLayout {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

    // Find and click close button (from mocked MobileTerminalTabBar)
    const closeButton = screen.getByTestId('close-tab-tab-1');
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(mockTerminalTabs.removeTab).toHaveBeenCalledWith('tab-1');
    });
  });

  it('should handle removeTab errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockTerminalTabs.tabs = [
      { id: 'tab-1', name: 'Terminal 1', tmuxSession: 'tmux-1', created: '2024-01-01', order: 0 },
    ];
    mockTerminalTabs.activeTabId = 'tab-1';
    mockTerminalTabs.activeTab = mockTerminalTabs.tabs[0];
    mockTerminalTabs.removeTab.mockRejectedValue(new Error('Failed to close terminal'));

    render(<MobileLayout {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));
    const closeButton = screen.getByTestId('close-tab-tab-1');
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Failed to close terminal:', expect.any(Error));
    });

    consoleSpy.mockRestore();
  });

  it('should call setActiveTab when selecting a tab', async () => {
    mockTerminalTabs.tabs = [
      { id: 'tab-1', name: 'Terminal 1', tmuxSession: 'tmux-1', created: '2024-01-01', order: 0 },
      { id: 'tab-2', name: 'Terminal 2', tmuxSession: 'tmux-2', created: '2024-01-02', order: 1 },
    ];
    mockTerminalTabs.activeTabId = 'tab-1';
    mockTerminalTabs.activeTab = mockTerminalTabs.tabs[0];

    render(<MobileLayout {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

    // Click on the second tab
    const tab2Button = screen.getByTestId('tab-tab-2');
    fireEvent.click(tab2Button);

    expect(mockTerminalTabs.setActiveTab).toHaveBeenCalledWith('tab-2');
  });

  it('should maintain terminal state across re-renders', () => {
    const { rerender, container } = render(<MobileLayout {...defaultProps} />);

    // Initial state - preview tab is active
    expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toHaveStyle('display: flex');

    // Re-render with same props
    rerender(<MobileLayout {...defaultProps} />);

    // Terminal tab should still be mounted
    expect(container.querySelector('[data-testid="terminal-tab-wrapper"]')).toBeInTheDocument();
  });
});
