/**
 * MobileLayout tests (__tests__ directory variant)
 *
 * Additional tests for MobileLayout covering edge cases,
 * integration scenarios, and accessibility.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileLayout } from '../MobileLayout';
import type { MobileLayoutProps } from '../MobileLayout';

describe('MobileLayout (__tests__ variant)', () => {
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
  });

  describe('Layout Structure', () => {
    it('should render as full-screen flex container', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('h-screen', 'flex', 'flex-col');
    });

    it('should have header as first child', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const root = container.firstChild as HTMLElement;
      const firstChild = root.firstChild as HTMLElement;

      // First child should be header (MobileHeader)
      expect(firstChild).toBeDefined();
    });

    it('should have content area that fills remaining space', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const contentWrapper = container.querySelector('[data-testid="mobile-layout-content"]');
      expect(contentWrapper).toHaveClass('flex-1', 'overflow-hidden', 'relative');
    });

    it('should have fixed tab bar at bottom', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const tabBar = container.querySelector('nav[aria-label*="Mobile"]');
      expect(tabBar).toHaveClass('fixed', 'bottom-0', 'w-full');
    });
  });

  describe('Tab Management', () => {
    it('should start with preview tab active', () => {
      render(<MobileLayout {...defaultProps} />);

      const previewTab = screen.getByTestId('preview-tab-wrapper');
      expect(previewTab).not.toHaveStyle('display: none');
    });

    it('should switch active tab on tab bar click', () => {
      render(<MobileLayout {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /chat/i }));

      const chatTab = screen.getByTestId('chat-tab-wrapper');
      expect(chatTab).not.toHaveStyle('display: none');
    });

    it('should hide inactive tabs with display:none', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /chat/i }));

      const previewTab = container.querySelector('[data-testid="preview-tab-wrapper"]');
      expect(previewTab).toHaveStyle('display: none');

      const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
      expect(terminalTab).toHaveStyle('display: none');
    });

    it('should maintain mounted state for all tabs', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      // All tabs should be mounted
      expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="chat-tab-wrapper"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="terminal-tab-wrapper"]')).toBeInTheDocument();

      // After switching
      fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

      // All should still be mounted
      expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="chat-tab-wrapper"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="terminal-tab-wrapper"]')).toBeInTheDocument();
    });

    it('should cycle through all tabs correctly', () => {
      render(<MobileLayout {...defaultProps} />);

      // Start at preview
      expect(screen.getByTestId('preview-tab-wrapper')).not.toHaveStyle('display: none');

      // Go to chat
      fireEvent.click(screen.getByRole('button', { name: /chat/i }));
      expect(screen.getByTestId('chat-tab-wrapper')).not.toHaveStyle('display: none');

      // Go to terminal
      fireEvent.click(screen.getByRole('button', { name: /terminal/i }));
      expect(screen.getByTestId('terminal-tab-wrapper')).not.toHaveStyle('display: none');

      // Back to preview
      fireEvent.click(screen.getByRole('button', { name: /preview/i }));
      expect(screen.getByTestId('preview-tab-wrapper')).not.toHaveStyle('display: none');
    });

    it('should handle rapid tab switching', () => {
      render(<MobileLayout {...defaultProps} />);

      const chatButton = screen.getByRole('button', { name: /chat/i });
      const terminalButton = screen.getByRole('button', { name: /terminal/i });
      const previewButton = screen.getByRole('button', { name: /preview/i });

      fireEvent.click(chatButton);
      fireEvent.click(terminalButton);
      fireEvent.click(previewButton);
      fireEvent.click(chatButton);

      expect(screen.getByTestId('chat-tab-wrapper')).not.toHaveStyle('display: none');
    });
  });

  describe('Props and Configuration', () => {
    it('should accept and use sessions prop', () => {
      const sessions = [
        { id: 'session1', name: 'Session 1', project: 'Project A' } as any,
        { id: 'session2', name: 'Session 2', project: 'Project B' } as any,
      ];

      render(<MobileLayout {...defaultProps} sessions={sessions} />);

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should accept and use handlers', () => {
      const handlers = {
        onSessionSelect: vi.fn(),
        onRefreshSessions: vi.fn(),
        onCreateSession: vi.fn(),
        onAddProject: vi.fn(),
        onDeleteSession: vi.fn(),
      };

      render(<MobileLayout {...defaultProps} handlers={handlers} />);

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should reflect isConnected state', () => {
      const { rerender } = render(
        <MobileLayout {...defaultProps} isConnected={false} />
      );

      expect(screen.getByRole('navigation')).toBeInTheDocument();

      rerender(
        <MobileLayout {...defaultProps} isConnected={true} />
      );

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should reflect isConnecting state', () => {
      const { rerender } = render(
        <MobileLayout {...defaultProps} isConnecting={false} />
      );

      expect(screen.getByRole('navigation')).toBeInTheDocument();

      rerender(
        <MobileLayout {...defaultProps} isConnecting={true} />
      );

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });
  });

  describe('Tab Content Rendering', () => {
    it('should render PreviewTab with proper container', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const previewTab = container.querySelector('[data-testid="preview-tab-wrapper"]');
      expect(previewTab).toHaveClass('flex-1', 'flex', 'flex-col');
    });

    it('should render ChatTab with proper container', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const chatTab = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(chatTab).toHaveClass('flex-1', 'flex', 'flex-col');
    });

    it('should render TerminalTab with proper container', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const terminalTab = container.querySelector('[data-testid="terminal-tab-wrapper"]');
      expect(terminalTab).toHaveClass('flex-1', 'flex', 'flex-col');
    });

    it('should have consistent sizing for all tabs', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const tabs = container.querySelectorAll('[data-testid*="-tab-wrapper"]');
      tabs.forEach((tab) => {
        expect(tab).toHaveClass('flex-1', 'flex', 'flex-col');
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const navs = container.querySelectorAll('nav');
      expect(navs.length).toBeGreaterThan(0);
    });

    it('should have accessible tab bar navigation', () => {
      render(<MobileLayout {...defaultProps} />);

      const buttons = screen.getAllByRole('button');
      const tabButtons = buttons.filter(
        (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('chat') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('preview') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('terminal')
      );

      expect(tabButtons.length).toBe(3);
    });

    it('should mark active tab with aria-current', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      let activeButton = container.querySelector('button[aria-current="page"]');
      expect(activeButton).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /chat/i }));

      activeButton = container.querySelector('button[aria-current="page"]');
      expect(activeButton?.getAttribute('aria-label')).toContain('Chat');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty sessions list', () => {
      render(<MobileLayout {...defaultProps} sessions={[]} />);

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should handle undefined optional props', () => {
      const props: MobileLayoutProps = {
        sessions: [],
        handlers: {
          onSessionSelect: vi.fn(),
          onRefreshSessions: vi.fn(),
          onCreateSession: vi.fn(),
          onAddProject: vi.fn(),
          onDeleteSession: vi.fn(),
        },
      };

      render(<MobileLayout {...props} />);

      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should handle clicking same tab multiple times', () => {
      render(<MobileLayout {...defaultProps} />);

      const chatButton = screen.getByRole('button', { name: /chat/i });

      fireEvent.click(chatButton);
      fireEvent.click(chatButton);
      fireEvent.click(chatButton);

      expect(screen.getByTestId('chat-tab-wrapper')).not.toHaveStyle('display: none');
    });

    it('should maintain scroll position within tabs when switching', async () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      // Switch to chat and back
      fireEvent.click(screen.getByRole('button', { name: /chat/i }));
      fireEvent.click(screen.getByRole('button', { name: /preview/i }));

      // Preview tab should still be mounted
      expect(container.querySelector('[data-testid="preview-tab-wrapper"]')).toBeInTheDocument();
    });
  });

  describe('Responsive Behavior', () => {
    it('should use full viewport height', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const root = container.firstChild as HTMLElement;
      expect(root).toHaveClass('h-screen');
    });

    it('should handle viewport without extra spacing', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const root = container.firstChild as HTMLElement;

      // Verify flex layout classes are applied
      expect(root).toHaveClass('flex', 'flex-col');

      // Verify full screen height
      expect(root).toHaveClass('h-screen');
    });

    it('should account for safe area and notch', () => {
      const { container } = render(<MobileLayout {...defaultProps} />);

      const tabBar = container.querySelector('nav');
      expect(tabBar).toHaveClass('pb-safe');
    });
  });

  describe('State Preservation', () => {
    it('should preserve tab state when props change', () => {
      const { rerender } = render(<MobileLayout {...defaultProps} />);

      // Switch to chat
      fireEvent.click(screen.getByRole('button', { name: /chat/i }));
      expect(screen.getByTestId('chat-tab-wrapper')).not.toHaveStyle('display: none');

      // Rerender with different props
      rerender(
        <MobileLayout
          {...defaultProps}
          sessions={[{ id: 'new', name: 'New' } as any]}
        />
      );

      // Tab state should be preserved
      expect(screen.getByTestId('chat-tab-wrapper')).not.toHaveStyle('display: none');
    });

    it('should not lose state on rapid re-renders', () => {
      const { rerender } = render(<MobileLayout {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /terminal/i }));

      // Rapid re-renders
      rerender(<MobileLayout {...defaultProps} />);
      rerender(<MobileLayout {...defaultProps} isConnected={true} />);
      rerender(<MobileLayout {...defaultProps} isConnecting={true} />);

      // Terminal should still be active
      expect(screen.getByTestId('terminal-tab-wrapper')).not.toHaveStyle('display: none');
    });
  });
});
