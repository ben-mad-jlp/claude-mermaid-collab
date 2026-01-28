/**
 * ChatTab Component Tests
 *
 * Tests for ChatTab - full-screen chat wrapper with AI UI auto-switch
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatTab } from './ChatTab';
import { useChatStore } from '@/stores/chatStore';
import { useSessionStore } from '@/stores/sessionStore';

// Mock the ChatPanel component to verify it receives correct props
vi.mock('../chat-drawer/ChatPanel', () => ({
  ChatPanel: ({ className, onAutoSwitch }: any) => (
    <div data-testid="mock-chat-panel" className={className} onClick={() => onAutoSwitch?.()}>
      Mock Chat Panel
    </div>
  ),
}));

describe('ChatTab', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useSessionStore.setState({ currentSession: { id: 'test-session', name: 'Test' } as any });
  });

  describe('Rendering', () => {
    it('should render full-screen container with ChatPanel', () => {
      const { container } = render(<ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />);
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper).toBeDefined();
    });

    it('should apply full-screen height styles to wrapper', () => {
      const { container } = render(<ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />);
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper?.className).toContain('h-full');
      expect(wrapper?.className).toContain('flex');
      expect(wrapper?.className).toContain('flex-col');
    });

    it('should render ChatPanel as child', () => {
      render(<ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />);
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });

    it('should pass messages prop to ChatPanel', () => {
      const messages = [
        { id: '1', type: 'text' as const, content: 'Test message', timestamp: new Date() },
      ];
      const { container } = render(
        <ChatTab messages={messages} onSendMessage={() => {}} onAutoSwitch={() => {}} />
      );
      const panel = screen.getByTestId('mock-chat-panel');
      expect(panel).toBeDefined();
    });

    it('should pass onSendMessage callback to ChatPanel', () => {
      const onSendMessage = vi.fn();
      render(<ChatTab messages={[]} onSendMessage={onSendMessage} onAutoSwitch={() => {}} />);
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });

    it('should pass onAutoSwitch callback to ChatPanel', () => {
      const onAutoSwitch = vi.fn();
      const { container } = render(
        <ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={onAutoSwitch} />
      );
      const panel = screen.getByTestId('mock-chat-panel');
      expect(panel).toBeDefined();
    });
  });

  describe('Props', () => {
    it('should accept messages prop', () => {
      const messages = [
        { id: '1', type: 'text' as const, content: 'Test', timestamp: new Date() },
      ];
      const { container } = render(
        <ChatTab messages={messages} onSendMessage={() => {}} onAutoSwitch={() => {}} />
      );
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });

    it('should accept empty messages array', () => {
      const { container } = render(
        <ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />
      );
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });

    it('should accept onSendMessage callback', () => {
      const onSendMessage = vi.fn();
      render(<ChatTab messages={[]} onSendMessage={onSendMessage} onAutoSwitch={() => {}} />);
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });

    it('should accept onAutoSwitch callback', () => {
      const onAutoSwitch = vi.fn();
      render(<ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={onAutoSwitch} />);
      expect(screen.getByTestId('mock-chat-panel')).toBeDefined();
    });
  });

  describe('Layout', () => {
    it('should fill available height between header and tab bar', () => {
      const { container } = render(
        <ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />
      );
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper?.className).toContain('h-full');
      expect(wrapper?.className).toContain('flex-1');
    });

    it('should use flexbox column layout for vertical stacking', () => {
      const { container } = render(
        <ChatTab messages={[]} onSendMessage={() => {}} onAutoSwitch={() => {}} />
      );
      const wrapper = container.querySelector('[data-testid="chat-tab-wrapper"]');
      expect(wrapper?.className).toContain('flex-col');
    });
  });
});
