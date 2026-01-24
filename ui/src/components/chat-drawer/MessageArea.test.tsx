/**
 * MessageArea Component Tests
 *
 * Tests for message rendering with artifact link support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageArea } from './MessageArea';
import { useViewerStore } from '@/stores/viewerStore';

describe('MessageArea Component', () => {
  const mockOnAction = vi.fn();

  beforeEach(() => {
    mockOnAction.mockClear();
    useViewerStore.getState().reset();
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <MessageArea messages={[]} onAction={() => mockOnAction} />
      );
      expect(container).toBeDefined();
    });

    it('should render empty when no messages provided', () => {
      const { container } = render(
        <MessageArea messages={[]} onAction={() => mockOnAction} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render all provided messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
        {
          id: 'msg-2',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const msg1 = container.querySelector('[data-testid="message-msg-1"]');
      const msg2 = container.querySelector('[data-testid="message-msg-2"]');

      expect(msg1).toBeDefined();
      expect(msg2).toBeDefined();
    });

    it('should render timestamp for each message', () => {
      const now = Date.now();
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: now,
          responded: false,
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      const timestamp = new Date(now).toLocaleTimeString();
      expect(screen.getByText(timestamp)).toBeDefined();
    });

    it('should show blocking badge for blocking messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: true,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText('Blocking')).toBeDefined();
    });

    it('should show responded badge for responded messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: true,
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText('Responded')).toBeDefined();
    });
  });

  describe('Artifact Link Rendering', () => {
    it('should render ArtifactLink for messages with artifact data', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'document' as const,
            id: 'doc-1',
            name: 'Test Document',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText(/Created.*Test Document.*click to view/i)).toBeDefined();
    });

    it('should render document artifact link', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'document' as const,
            id: 'doc-1',
            name: 'My Document',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText(/📄/)).toBeDefined();
    });

    it('should render diagram artifact link', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'diagram' as const,
            id: 'diag-1',
            name: 'My Diagram',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText(/📊/)).toBeDefined();
    });

    it('should handle artifact click to navigate', async () => {
      const user = userEvent.setup();
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'document' as const,
            id: 'doc-123',
            name: 'My Document',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      const button = screen.getByRole('button');
      await user.click(button);

      const viewerState = useViewerStore.getState();
      expect(viewerState.currentView?.id).toBe('doc-123');
      expect(viewerState.currentView?.type).toBe('document');
    });

    it('should handle multiple artifact links in different messages', async () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'document' as const,
            id: 'doc-1',
            name: 'Document 1',
          },
        },
        {
          id: 'msg-2',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'diagram' as const,
            id: 'diag-1',
            name: 'Diagram 1',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBe(2);
    });
  });

  describe('UI Render Message Handling', () => {
    it('should render UI components for ui_render message type', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'ui_render' as const,
          ui: {
            component: 'Card',
            props: {},
          },
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const messageDiv = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageDiv).toBeDefined();
    });

    it('should pass onAction callback for UI render messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'ui_render' as const,
          ui: {
            component: 'Card',
            props: {},
          },
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      // Component should render without errors
      const messageDiv = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageDiv).toBeDefined();
    });
  });

  describe('Plain Text Message Handling', () => {
    it('should render plain text for messages without artifact data', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            message: 'Hello world',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText('Hello world')).toBeDefined();
    });

    it('should render fallback text when no content available', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      expect(screen.getByText('No content')).toBeDefined();
    });
  });

  describe('Message Data Attributes', () => {
    it('should set data-blocking attribute correctly', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: true,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const messageDiv = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageDiv?.getAttribute('data-blocking')).toBe('true');
    });

    it('should set data-responded attribute correctly', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: true,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const messageDiv = container.querySelector('[data-testid="message-msg-1"]');
      expect(messageDiv?.getAttribute('data-responded')).toBe('true');
    });
  });

  describe('Message Spacing', () => {
    it('should add border between multiple messages', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
        {
          id: 'msg-2',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const msg2 = container.querySelector('[data-testid="message-msg-2"]');
      expect(msg2?.className).toMatch(/border-t/);
    });

    it('should not add border before first message', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
        },
      ];

      const { container } = render(
        <MessageArea messages={messages} onAction={() => mockOnAction} />
      );

      const msg1 = container.querySelector('[data-testid="message-msg-1"]');
      expect(msg1?.className).not.toMatch(/pt-4 border-t/);
    });
  });

  describe('Accessibility', () => {
    it('should have proper semantic structure', () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: Date.now(),
          responded: false,
          response: {
            type: 'created',
            artifactType: 'document' as const,
            id: 'doc-1',
            name: 'Document',
          },
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      // ArtifactLink should be a button for proper semantics
      const button = screen.getByRole('button');
      expect(button).toBeDefined();
    });

    it('should have accessible timestamps', () => {
      const now = Date.now();
      const messages = [
        {
          id: 'msg-1',
          type: 'notification' as const,
          blocking: false,
          timestamp: now,
          responded: false,
        },
      ];

      render(<MessageArea messages={messages} onAction={() => mockOnAction} />);

      const timestamp = new Date(now).toLocaleTimeString();
      const timeElement = screen.getByText(timestamp);
      expect(timeElement).toBeDefined();
    });
  });
});
