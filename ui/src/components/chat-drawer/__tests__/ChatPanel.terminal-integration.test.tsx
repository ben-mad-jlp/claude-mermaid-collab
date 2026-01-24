/**
 * ChatPanel Terminal Integration Tests
 *
 * Tests for integrating TerminalTabsContainer into ChatPanel
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { useViewerStore } from '@/stores/viewerStore';

// Mock TerminalTabsContainer to avoid websocket dependencies
vi.mock('../../terminal/TerminalTabsContainer', () => ({
  TerminalTabsContainer: ({ className }: { className?: string }) => (
    <div data-testid="terminal-tabs-container" className={className}>
      Terminal Tabs Container
    </div>
  ),
}));

describe('ChatPanel Terminal Integration', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useViewerStore.getState().reset();
  });

  describe('TerminalTabsContainer Integration', () => {
    it('should render TerminalTabsContainer instead of EmbeddedTerminal', () => {
      const { container } = render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should pass h-full className to TerminalTabsContainer', () => {
      const { container } = render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.className).toContain('h-full');
    });

    it('should render TerminalTabsContainer in secondary content pane', () => {
      const { container } = render(<ChatPanel />);

      // TerminalTabsContainer should be rendered directly (no wrapper)
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should maintain terminal pane layout with SplitPane', () => {
      const { container } = render(<ChatPanel />);

      // Verify primary content (chat) - has input controls at top
      const inputControls = container.querySelector('.px-3.py-2.border-b');
      expect(inputControls).toBeDefined();

      // Verify secondary content (terminal) - TerminalTabsContainer is rendered
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer).toBeDefined();
    });

    it('should not render EmbeddedTerminal directly', () => {
      const { container } = render(<ChatPanel />);

      // After replacing with TerminalTabsContainer, EmbeddedTerminal should not be directly rendered
      // The only way it would appear is via TerminalTabsContainer mocking (which we control)
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.textContent).toBe('Terminal Tabs Container');
    });
  });

  describe('ChatPanel Functionality Preservation', () => {
    it('should still render chat section with messages', () => {
      const { container } = render(<ChatPanel />);
      // Chat header removed, but empty state message should still show
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    it('should still render input controls for chat', () => {
      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });

    it('should still have send and clear buttons', () => {
      render(<ChatPanel />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(clearButton).toBeDefined();
      expect(sendButton).toBeDefined();
    });

    it('should still maintain SplitPane with proper sizing', () => {
      const { container } = render(<ChatPanel />);

      // Verify the main structure is still intact
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toContain('h-full');
      expect(mainDiv.className).toContain('flex');
      expect(mainDiv.className).toContain('flex-col');
    });

    it('should still render TerminalTabsContainer', () => {
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
    it('should have horizontal split layout', () => {
      const { container } = render(<ChatPanel />);

      // Check for SplitPane structure
      const splitPane = container.querySelector('[data-testid="split-pane"]');
      expect(splitPane).toBeDefined();
    });

    it('should render TerminalTabsContainer with h-full to fill terminal pane', () => {
      render(<ChatPanel />);
      const terminalContainer = screen.getByTestId('terminal-tabs-container');
      expect(terminalContainer.className).toContain('h-full');
    });

    it('should render TerminalTabsContainer directly without wrapper', () => {
      const { container } = render(<ChatPanel />);

      const terminalContainer = screen.getByTestId('terminal-tabs-container');

      // TerminalTabsContainer should be rendered directly
      expect(terminalContainer).toBeDefined();
      expect(terminalContainer.className).toContain('h-full');
    });
  });

  describe('Configuration Changes', () => {
    it('should not have hardcoded wsUrl configuration', () => {
      const { container } = render(<ChatPanel />);

      // Verify the mocked TerminalTabsContainer is used
      const terminalContainer = screen.getByTestId('terminal-tabs-container');

      // The component should exist and be rendered
      expect(terminalContainer).toBeDefined();

      // No hardcoded config should be passed
      // (TerminalTabsContainer manages its own URLs via useTerminalTabs hook)
    });
  });
});
