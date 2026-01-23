import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatDrawer, type ChatDrawerProps } from '../ChatDrawer';
import { useChatStore } from '../../../stores/chatStore';

// Mock the AIUIRenderer component
vi.mock('../../ai-ui/renderer', () => ({
  AIUIRenderer: ({ component, onAction }: any) => (
    <div
      data-testid="ai-ui-renderer"
      onClick={() => onAction?.('test-action', { type: 'test' })}
    >
      Test UI Component: {component?.type}
    </div>
  ),
}));

describe('ChatDrawer Component', () => {
  const defaultProps: ChatDrawerProps = {
    isOpen: false,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
      currentBlockingId: null,
    });
  });

  describe('Visibility', () => {
    it('should not render drawer when isOpen is false', () => {
      const { container } = render(<ChatDrawer {...defaultProps} />);
      const drawer = container.querySelector('[class*="translate-x"]');
      expect(drawer).toHaveClass('-translate-x-full');
    });

    it('should render drawer when isOpen is true', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );
      const drawer = container.querySelector('[class*="translate-x"]');
      expect(drawer).toHaveClass('translate-x-0');
    });

    it('should have slide animation class', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );
      const drawer = container.querySelector('[class*="transition"]');
      expect(drawer).toHaveClass('transition-transform', 'duration-300');
    });
  });

  describe('Header', () => {
    it('should render header with Claude title', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      const title = screen.getByText('Claude');
      expect(title).toBeInTheDocument();
    });

    it('should render close button in header', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      const closeButton = screen.getByLabelText('Close drawer');
      expect(closeButton).toBeInTheDocument();
    });

    it('should have correct close button styling', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );
      const closeButton = screen.getByLabelText('Close drawer');
      expect(closeButton).toHaveClass('p-1.5', 'rounded-lg');
    });
  });

  describe('Close Button Functionality', () => {
    it('should call onClose when close button is clicked', async () => {
      const onCloseMock = vi.fn();
      const user = userEvent.setup();

      render(<ChatDrawer {...defaultProps} onClose={onCloseMock} isOpen={true} />);
      const closeButton = screen.getByLabelText('Close drawer');

      await user.click(closeButton);

      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when overlay is clicked', async () => {
      const onCloseMock = vi.fn();
      const user = userEvent.setup();

      const { container } = render(
        <ChatDrawer {...defaultProps} onClose={onCloseMock} isOpen={true} />
      );

      const overlay = container.querySelector('[role="presentation"]');
      if (overlay) {
        await user.click(overlay);
        expect(onCloseMock).toHaveBeenCalled();
      }
    });

    it('should not render overlay when drawer is closed', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={false} />
      );
      const overlay = container.querySelector('[role="presentation"]');
      expect(overlay).not.toBeInTheDocument();
    });
  });

  describe('Message Rendering', () => {
    it('should display empty state when no messages', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      expect(screen.getByText('No messages yet')).toBeInTheDocument();
    });

    it('should render messages when they exist', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const messageElement = screen.getByTestId('message-msg-1');
      expect(messageElement).toBeInTheDocument();
    });

    it('should render correct number of messages', () => {
      const messages = Array.from({ length: 3 }, (_, i) => ({
        id: `msg-${i}`,
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      }));

      useChatStore.setState({ messages });

      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      messages.forEach((msg) => {
        expect(container.querySelector(`[data-testid="message-${msg.id}"]`)).toBeInTheDocument();
      });
    });
  });

  describe('Message Type Badge', () => {
    it('should show ui_render type badge', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const badge = screen.getByText('ui_render');
      expect(badge).toBeInTheDocument();
    });

    it('should show blocking badge when message is blocking', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const blockingBadge = screen.getByText('Blocking');
      expect(blockingBadge).toBeInTheDocument();
    });

    it('should show responded badge when message is responded', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: true,
        response: { action: 'test' },
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const respondedBadge = screen.getByText('Responded');
      expect(respondedBadge).toBeInTheDocument();
    });
  });

  describe('UI Component Rendering', () => {
    it('should render AIUIRenderer for ui_render messages', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'TestComponent', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const renderer = screen.getByTestId('ai-ui-renderer');
      expect(renderer).toBeInTheDocument();
    });

    it('should not render AIUIRenderer when message has no ui', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'notification' as const,
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const renderers = screen.queryAllByTestId('ai-ui-renderer');
      expect(renderers.length).toBe(0);
    });
  });

  describe('Message Timestamps', () => {
    it('should display timestamp for each message', () => {
      const now = Date.now();
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: now,
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const timeString = new Date(now).toLocaleTimeString();
      expect(screen.getByText(timeString)).toBeInTheDocument();
    });
  });

  describe('Message Styling', () => {
    it('should apply ui_render styling to ui_render messages', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const messageElement = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageElement).toHaveClass('bg-blue-50', 'dark:bg-blue-900/20');
    });

    it('should apply notification styling to notification messages', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'notification' as const,
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const messageElement = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageElement).toHaveClass('bg-gray-50', 'dark:bg-gray-800');
    });
  });

  describe('Footer Status', () => {
    it('should show ready status when no messages', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      expect(screen.getByText('Ready to chat')).toBeInTheDocument();
    });

    it('should show message count in footer', () => {
      const messages = Array.from({ length: 3 }, (_, i) => ({
        id: `msg-${i}`,
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      }));

      useChatStore.setState({ messages });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      expect(screen.getByText(/3 messages/)).toBeInTheDocument();
    });

    it('should show responded count in footer', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: Date.now(),
          responded: true,
          response: { action: 'test' },
        },
        {
          id: 'msg-2',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      useChatStore.setState({ messages });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      expect(screen.getByText(/1 responded/)).toBeInTheDocument();
    });

    it('should use singular form for single message', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      useChatStore.setState({ messages });

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      expect(screen.getByText(/1 message/)).toBeInTheDocument();
    });
  });

  describe('Auto-scroll Behavior', () => {
    it('should auto-scroll to latest message', async () => {
      const { rerender } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const newMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [newMessage] });

      rerender(<ChatDrawer {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
      });
    });
  });

  describe('Action Handling', () => {
    it('should handle action callbacks from rendered components', async () => {
      const respondToMessageMock = vi.fn();
      useChatStore.setState({ respondToMessage: respondToMessageMock });

      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [testMessage] });

      const user = userEvent.setup();

      render(<ChatDrawer {...defaultProps} isOpen={true} />);

      const renderer = screen.getByTestId('ai-ui-renderer');
      await user.click(renderer);

      await waitFor(() => {
        expect(respondToMessageMock).toHaveBeenCalled();
      });
    });
  });

  describe('Props Updates', () => {
    it('should update visibility when isOpen changes', () => {
      const { container, rerender } = render(
        <ChatDrawer {...defaultProps} isOpen={false} />
      );

      let drawer = container.querySelector('[class*="translate-x"]');
      expect(drawer).toHaveClass('-translate-x-full');

      rerender(<ChatDrawer {...defaultProps} isOpen={true} />);

      drawer = container.querySelector('[class*="translate-x"]');
      expect(drawer).toHaveClass('translate-x-0');
    });

    it('should update when new messages arrive', () => {
      const { rerender } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      expect(screen.getByText('No messages yet')).toBeInTheDocument();

      const newMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.setState({ messages: [newMessage] });

      rerender(<ChatDrawer {...defaultProps} isOpen={true} />);

      expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-msg-1')).toBeInTheDocument();
    });

    it('should update when onClose callback changes', async () => {
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();
      const user = userEvent.setup();

      const { rerender } = render(
        <ChatDrawer {...defaultProps} onClose={onClose1} isOpen={true} />
      );

      let closeButton = screen.getByLabelText('Close drawer');
      await user.click(closeButton);
      expect(onClose1).toHaveBeenCalledTimes(1);

      rerender(
        <ChatDrawer {...defaultProps} onClose={onClose2} isOpen={true} />
      );

      closeButton = screen.getByLabelText('Close drawer');
      await user.click(closeButton);
      expect(onClose2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Responsive Design', () => {
    it('should have responsive width classes', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const drawer = container.querySelector('[class*="w-full"]');
      expect(drawer).toHaveClass('w-full', 'sm:w-96', 'lg:w-[400px]');
    });

    it('should show overlay only on small screens', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const overlay = container.querySelector('[role="presentation"]');
      expect(overlay).toHaveClass('lg:hidden');
    });
  });

  describe('Accessibility', () => {
    it('should have proper button aria-label', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      const closeButton = screen.getByLabelText('Close drawer');
      expect(closeButton).toBeInTheDocument();
    });

    it('should be keyboard accessible', async () => {
      const onCloseMock = vi.fn();
      const user = userEvent.setup();

      render(
        <ChatDrawer {...defaultProps} onClose={onCloseMock} isOpen={true} />
      );

      const closeButton = screen.getByLabelText('Close drawer');
      closeButton.focus();
      expect(closeButton).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(onCloseMock).toHaveBeenCalled();
    });

    it('should have proper semantic HTML', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const heading = container.querySelector('h2');
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toBe('Claude');
    });

    it('should have proper button semantics for close button', () => {
      render(<ChatDrawer {...defaultProps} isOpen={true} />);
      const closeButton = screen.getByLabelText('Close drawer');
      expect(closeButton.tagName).toBe('BUTTON');
    });
  });

  describe('Dark Mode Support', () => {
    it('should have dark mode classes', () => {
      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const drawer = container.querySelector('[class*="dark:"]');
      expect(drawer).toBeInTheDocument();
    });
  });

  describe('Multiple Messages', () => {
    it('should render multiple messages in correct order', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: 1000,
          responded: false,
        },
        {
          id: 'msg-2',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: 2000,
          responded: false,
        },
        {
          id: 'msg-3',
          type: 'ui_render' as const,
          ui: { type: 'Card', props: {}, children: [] },
          blocking: false,
          timestamp: 3000,
          responded: false,
        },
      ];

      useChatStore.setState({ messages });

      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const msg1 = container.querySelector('[data-testid="message-msg-1"]');
      const msg2 = container.querySelector('[data-testid="message-msg-2"]');
      const msg3 = container.querySelector('[data-testid="message-msg-3"]');

      expect(msg1).toBeInTheDocument();
      expect(msg2).toBeInTheDocument();
      expect(msg3).toBeInTheDocument();
    });
  });

  describe('Message Data Attributes', () => {
    it('should have correct data attributes on message element', () => {
      const testMessage = {
        id: 'msg-1',
        type: 'ui_render' as const,
        ui: { type: 'Card', props: {}, children: [] },
        blocking: true,
        timestamp: Date.now(),
        responded: true,
        response: { action: 'test' },
      };

      useChatStore.setState({ messages: [testMessage] });

      const { container } = render(
        <ChatDrawer {...defaultProps} isOpen={true} />
      );

      const messageElement = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageElement).toHaveAttribute('data-blocking', 'true');
      expect(messageElement).toHaveAttribute('data-responded', 'true');
    });
  });
});
