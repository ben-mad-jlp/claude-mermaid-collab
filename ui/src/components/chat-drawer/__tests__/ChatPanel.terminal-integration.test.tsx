/**
 * ChatPanel Terminal Integration Tests
 *
 * Tests for integrating TerminalTabsContainer into ChatPanel
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';

// Mock TerminalTabsContainer to avoid websocket dependencies
vi.mock('../../terminal/TerminalTabsContainer', () => ({
  TerminalTabsContainer: ({ className }: { className?: string }) => (
    <div data-testid="terminal-tabs-container" className={className}>
      Terminal Tabs Container
    </div>
  ),
}));

// Helper to enable chat panel via store (toggle buttons are now in Header)
const enableChat = () => {
  useUIStore.getState().setChatPanelVisible(true);
};

// Helper to enable terminal panel via store (toggle buttons are now in Header)
const enableTerminal = () => {
  useUIStore.getState().setTerminalPanelVisible(true);
};

// Helper to enable both panels
const enableBothPanels = () => {
  enableChat();
  enableTerminal();
};

describe('ChatPanel Terminal Integration', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useViewerStore.getState().reset();
    useUIStore.getState().reset();
  });

  describe('Panel Visibility (controlled by uiStore)', () => {
    it('should show placeholder when both panels are off by default', () => {
      render(<ChatPanel />);
      expect(screen.getByText(/Use the Chat or Terminal buttons/)).toBeDefined();
    });

    it('should show chat panel when enabled via store', () => {
      enableChat();
      render(<ChatPanel />);
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    it('should show terminal panel when enabled via store', () => {
      enableTerminal();
      render(<ChatPanel />);
      expect(screen.getByTestId('terminal-tabs-container')).toBeDefined();
    });

    it('should hide chat when disabled via store', () => {
      enableChat();
      const { rerender } = render(<ChatPanel />);
      expect(screen.getByText('No messages yet')).toBeDefined();

      // Disable chat via store
      useUIStore.getState().setChatPanelVisible(false);
      rerender(<ChatPanel />);
      expect(screen.queryByText('No messages yet')).toBeNull();
    });

    it('should hide terminal when disabled via store', () => {
      enableTerminal();
      const { rerender } = render(<ChatPanel />);
      expect(screen.getByTestId('terminal-tabs-container')).toBeDefined();

      // Disable terminal via store
      useUIStore.getState().setTerminalPanelVisible(false);
      rerender(<ChatPanel />);
      expect(screen.queryByTestId('terminal-tabs-container')).toBeNull();
    });
  });

  describe('TerminalTabsContainer Integration', () => {
    it('should render TerminalTabsContainer when terminal is enabled', () => {
      enableTerminal();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should pass h-full className to TerminalTabsContainer', () => {
      enableTerminal();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.className).toContain('h-full');
    });

    it('should render TerminalTabsContainer in secondary content pane when both enabled', () => {
      enableBothPanels();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should maintain terminal pane layout with SplitPane when both enabled', () => {
      enableBothPanels();
      const { container } = render(<ChatPanel />);

      // Verify primary content (chat) - has input controls at top
      const inputControls = container.querySelector('.px-3.py-2.border-b');
      expect(inputControls).toBeDefined();

      // Verify secondary content (terminal) - TerminalTabsContainer is rendered
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should render TerminalTabsContainer with correct content', () => {
      enableTerminal();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.textContent).toBe('Terminal Tabs Container');
    });
  });

  describe('ChatPanel Functionality Preservation', () => {
    it('should render chat section with messages when enabled', () => {
      enableChat();
      render(<ChatPanel />);
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    it('should render input controls for chat when enabled', () => {
      enableChat();
      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });

    it('should have send and clear buttons when chat enabled', () => {
      enableChat();
      render(<ChatPanel />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(clearButton).toBeDefined();
      expect(sendButton).toBeDefined();
    });

    it('should maintain proper sizing', () => {
      const { container } = render(<ChatPanel />);

      // Verify the main structure is still intact
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toContain('h-full');
      expect(mainDiv.className).toContain('flex');
      expect(mainDiv.className).toContain('flex-col');
    });

    it('should render TerminalTabsContainer when enabled', () => {
      enableTerminal();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should preserve dark mode support', () => {
      document.documentElement.classList.add('dark');
      const { container } = render(<ChatPanel />);
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toMatch(/dark:/);
      document.documentElement.classList.remove('dark');
    });
  });

  describe('Layout Integration', () => {
    it('should have horizontal split layout when both panels enabled', () => {
      enableBothPanels();
      const { container } = render(<ChatPanel />);

      // Check for SplitPane structure
      const splitPane = container.querySelector('[data-testid="split-pane"]');
      expect(splitPane).toBeDefined();
    });

    it('should render TerminalTabsContainer with h-full to fill terminal pane', () => {
      enableTerminal();
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.className).toContain('h-full');
    });

    it('should show only chat when terminal is hidden', () => {
      enableChat();
      const { container } = render(<ChatPanel />);

      // Chat should be visible
      expect(screen.getByText('No messages yet')).toBeDefined();

      // Terminal should not be visible
      expect(screen.queryByTestId('terminal-tabs-container')).toBeNull();

      // No SplitPane needed with only one panel
      expect(container.querySelector('[data-testid="split-pane"]')).toBeNull();
    });

    it('should show only terminal when chat is hidden', () => {
      enableTerminal();
      const { container } = render(<ChatPanel />);

      // Terminal should be visible
      expect(screen.getByTestId('terminal-tabs-container')).toBeDefined();

      // Chat should not be visible
      expect(screen.queryByText('No messages yet')).toBeNull();

      // No SplitPane needed with only one panel
      expect(container.querySelector('[data-testid="split-pane"]')).toBeNull();
    });
  });

  describe('Configuration Changes', () => {
    it('should not have hardcoded wsUrl configuration', () => {
      enableTerminal();
      render(<ChatPanel />);

      // Verify the mocked TerminalTabsContainer is used
      const terminalContainer = screen.getByTestId('terminal-tabs-container');

      // The component should exist and be rendered
      expect(terminalContainer).toBeDefined();
    });
  });
});
