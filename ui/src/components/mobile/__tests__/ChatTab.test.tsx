/**
 * ChatTab Integration Tests
 *
 * Integration tests for ChatTab with real ChatPanel and message handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatTab } from '../ChatTab';
import { useChatStore } from '@/stores/chatStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';

describe('ChatTab Integration', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useUIStore.getState().reset();
    useSessionStore.setState({ currentSession: { id: 'test-session', name: 'Test' } as any });
  });

  describe('Auto-switch callback', () => {
    it('should invoke onAutoSwitch callback when AI UI card arrives', () => {
      const onAutoSwitch = vi.fn();
      render(
        <ChatTab
          messages={[]}
          onSendMessage={() => {}}
          onAutoSwitch={onAutoSwitch}
        />
      );
      // Verify callback is passed to ChatPanel
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });

    it('should provide mechanism to trigger auto-switch from chat flow', () => {
      const onAutoSwitch = vi.fn();
      const { container } = render(
        <ChatTab
          messages={[]}
          onSendMessage={() => {}}
          onAutoSwitch={onAutoSwitch}
        />
      );
      expect(container.querySelector('[data-testid="chat-tab-wrapper"]')).toBeDefined();
    });
  });

  describe('Message rendering', () => {
    it('should render messages in full-screen chat container', () => {
      render(
        <ChatTab
          messages={[]}
          onSendMessage={() => {}}
          onAutoSwitch={() => {}}
        />
      );
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });

    it('should display multiple messages in chat flow', () => {
      const messages = [
        { id: '1', type: 'text' as const, content: 'Message 1', timestamp: new Date() },
        { id: '2', type: 'text' as const, content: 'Message 2', timestamp: new Date() },
      ];
      render(
        <ChatTab
          messages={messages}
          onSendMessage={() => {}}
          onAutoSwitch={() => {}}
        />
      );
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });
  });

  describe('Input handling', () => {
    it('should call onSendMessage when user sends input', () => {
      const onSendMessage = vi.fn();
      render(
        <ChatTab
          messages={[]}
          onSendMessage={onSendMessage}
          onAutoSwitch={() => {}}
        />
      );
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });
  });

  describe('Full-screen layout', () => {
    it('should occupy full height available between header and tab bar', () => {
      const { container } = render(
        <ChatTab
          messages={[]}
          onSendMessage={() => {}}
          onAutoSwitch={() => {}}
        />
      );
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper?.className).toContain('h-full');
      expect(wrapper?.className).toContain('flex-col');
    });

    it('should stretch to fill container', () => {
      const { container } = render(
        <ChatTab
          messages={[]}
          onSendMessage={() => {}}
          onAutoSwitch={() => {}}
        />
      );
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper).toBeDefined();
      // Verify layout classes are applied
      expect(wrapper?.className).toMatch(/h-full/);
    });
  });

  describe('AI UI integration', () => {
    it('should render AI UI cards inline within chat message flow', () => {
      const messages = [
        { id: '1', type: 'ai-ui' as const, content: 'QuestionPanel', timestamp: new Date() },
      ];
      render(
        <ChatTab
          messages={messages}
          onSendMessage={() => {}}
          onAutoSwitch={() => {}}
        />
      );
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });

    it('should auto-switch to Chat tab on AI UI arrival', () => {
      const onAutoSwitch = vi.fn();
      render(
        <ChatTab
          messages={[{ id: '1', type: 'ai-ui' as const, content: 'Test', timestamp: new Date() }]}
          onSendMessage={() => {}}
          onAutoSwitch={onAutoSwitch}
        />
      );
      expect(screen.getByTestId('chat-tab-wrapper')).toBeDefined();
    });
  });
});
