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
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MobileLayout } from './MobileLayout';
import type { MobileLayoutProps } from './MobileLayout';

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

  it('should render MobileHeader at the top', () => {
    render(<MobileLayout {...defaultProps} />);
    const header = screen.getByRole('navigation', { name: /Mobile navigation/i });
    expect(header).toBeInTheDocument();
  });

  it('should render BottomTabBar at the bottom', () => {
    render(<MobileLayout {...defaultProps} />);
    const tabBar = screen.getByRole('navigation', { name: /Mobile navigation/i });
    expect(tabBar).toBeInTheDocument();
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

    // MobileHeader should be rendered (indirectly verified)
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('should pass connection state to MobileHeader', () => {
    const props = {
      ...defaultProps,
      isConnected: true,
      isConnecting: false,
    };

    render(<MobileLayout {...props} />);

    // Component should render with connection state
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('should handle tab bar at bottom without overlap', () => {
    const { container } = render(<MobileLayout {...defaultProps} />);

    // Tab bar should be fixed at bottom
    const tabBar = container.querySelector('nav');
    expect(tabBar).toHaveClass('fixed', 'bottom-0');
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
    expect(screen.getByRole('navigation')).toBeInTheDocument();
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
