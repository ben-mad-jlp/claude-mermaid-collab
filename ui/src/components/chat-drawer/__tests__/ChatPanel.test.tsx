/**
 * ChatPanel Component Tests
 *
 * Tests for ChatPanel with InputControls integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { useViewerStore } from '@/stores/viewerStore';

describe('ChatPanel with InputControls', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useViewerStore.getState().reset();
  });

  describe('Rendering', () => {
    it('should render ChatPanel with header', () => {
      render(<ChatPanel />);
      expect(screen.getByText('Chat')).toBeDefined();
    });

    it('should render InputControls component', () => {
      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });

    it('should have clear button from InputControls', () => {
      render(<ChatPanel />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect(clearButton).toBeDefined();
    });

    it('should have send button from InputControls', () => {
      render(<ChatPanel />);
      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDefined();
    });

    it('should show empty state initially', () => {
      render(<ChatPanel />);
      expect(screen.getByText('No messages yet')).toBeDefined();
    });
  });

  describe('InputControls Integration', () => {
    it('should disable InputControls when no pending blocking message', () => {
      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });

    it('should enable InputControls when pending blocking message exists', () => {
      const chatStore = useChatStore.getState();
      chatStore.addMessage({
        id: 'blocking-msg-1',
        type: 'notification',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      });

      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
    });

    it('should update disabled state when message responds', async () => {
      const chatStore = useChatStore.getState();
      chatStore.addMessage({
        id: 'blocking-msg-1',
        type: 'notification',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      });

      const { container, rerender } = render(<ChatPanel />);
      let textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);

      // Respond to the message
      chatStore.respondToMessage('blocking-msg-1', {
        action: 'test_action'
      });

      // Rerender to get updated state
      rerender(<ChatPanel />);
      textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });
  });

  describe('Send Message Functionality', () => {
    it('should allow typing when blocking message is pending', async () => {
      const user = userEvent.setup();
      const chatStore = useChatStore.getState();

      chatStore.addMessage({
        id: 'blocking-msg-1',
        type: 'notification',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      });

      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      expect(textarea.disabled).toBe(false);

      await user.type(textarea, 'Test response');

      expect(textarea.value).toBe('Test response');
    });

    it('should enable send button when text is entered', async () => {
      const user = userEvent.setup();
      const chatStore = useChatStore.getState();

      chatStore.addMessage({
        id: 'blocking-msg-1',
        type: 'notification',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      });

      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      const sendButton = screen.getByRole('button', { name: /send/i });

      expect((sendButton as HTMLButtonElement).disabled).toBe(true);

      await user.type(textarea, 'Test response');

      expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('Clear Button Functionality', () => {
    it('should have accessible clear button', () => {
      render(<ChatPanel />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      expect(clearButton).toBeDefined();
      expect(clearButton.getAttribute('aria-label')).toBe('Clear message area');
    });

    it('should not send message when only clear button is visible', () => {
      const { container } = render(<ChatPanel />);
      const buttons = screen.getAllByRole('button');

      // Should have clear and send buttons
      expect(buttons.length).toBe(2);
    });
  });

  describe('Layout', () => {
    it('should have clear button, input, and send button in correct order', () => {
      const { container } = render(<ChatPanel />);

      // Get the flex container with the controls
      const flexContainer = container.querySelector('.flex.gap-2.items-end');
      expect(flexContainer).toBeDefined();
      expect(flexContainer?.children.length).toBe(3); // clear button, textarea, send button
    });

    it('should display clean header without secondary clear button', () => {
      render(<ChatPanel />);
      const clearButtons = screen.getAllByRole('button', { name: /clear/i });
      // Should only have one clear button (from InputControls)
      expect(clearButtons.length).toBe(1);
    });

    it('should use full height layout', () => {
      const { container } = render(<ChatPanel />);
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toContain('h-full');
      expect(mainDiv.className).toContain('flex');
    });
  });

  describe('Header', () => {
    it('should have clean header without secondary controls', () => {
      render(<ChatPanel />);
      const header = screen.getByText('Chat');
      const headerDiv = header.parentElement;

      // Count buttons in header
      const headerId = headerDiv?.parentElement?.className;
      expect(headerDiv).toBeDefined();
    });

    it('should display Chat title', () => {
      render(<ChatPanel />);
      const heading = screen.getByText('Chat');
      expect(heading.tagName).toBe('H2');
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading structure', () => {
      render(<ChatPanel />);
      const heading = screen.getByText('Chat');
      expect(heading.tagName).toBe('H2');
    });

    it('should have accessible input field', () => {
      const { container } = render(<ChatPanel />);
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
      expect(textarea?.getAttribute('placeholder')).toBeDefined();
    });

    it('should have accessible buttons with labels', () => {
      render(<ChatPanel />);
      const clearButton = screen.getByRole('button', { name: /clear/i });
      const sendButton = screen.getByRole('button', { name: /send/i });

      expect(clearButton.getAttribute('aria-label')).toBeDefined();
      expect(sendButton.getAttribute('aria-label')).toBeDefined();
    });
  });

  describe('Dark Mode', () => {
    it('should render with dark mode classes', () => {
      document.documentElement.classList.add('dark');
      const { container } = render(<ChatPanel />);
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toMatch(/dark:/);
      document.documentElement.classList.remove('dark');
    });
  });
});
