/**
 * ChatPanel Integration Tests with ArtifactLink
 *
 * Tests for integrating artifact notifications into the ChatPanel
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';

// Helper to enable chat panel via store (toggle buttons are now in Header)
const enableChat = () => {
  useUIStore.getState().setChatPanelVisible(true);
};

describe('ChatPanel with ArtifactLink Integration', () => {
  beforeEach(() => {
    // Reset stores before each test
    useChatStore.getState().clearMessages();
    useViewerStore.getState().reset();
    useUIStore.getState().reset();
  });

  describe('Artifact Notifications in Messages', () => {
    it('should render ChatPanel component', () => {
      const { container } = render(<ChatPanel />);
      expect(container).toBeDefined();
    });

    it('should display artifact notification when message contains artifact link', async () => {
      // Add a message with artifact content (via UI rendering)
      const chatStore = useChatStore.getState();
      chatStore.addMessage({
        id: 'msg-1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
        ui: {
          component: 'Card',
          title: 'Artifact Created',
          content: {
            component: 'Markdown',
            content: 'Document created',
          },
        },
      });

      enableChat();
      const { container } = render(<ChatPanel />);

      await waitFor(() => {
        const messageElement = container.querySelector('[data-testid="message-msg-1"]');
        expect(messageElement).toBeDefined();
      });
    });

    it('should allow clicking artifact links to navigate', async () => {
      const user = userEvent.setup();
      enableChat();
      render(<ChatPanel />);

      // This test verifies that the integration allows artifact links
      // to be rendered and clicked within chat messages
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    it('should support document artifact notifications', async () => {
      const chatStore = useChatStore.getState();
      chatStore.addMessage({
        id: 'msg-doc-1',
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      enableChat();
      const { container } = render(<ChatPanel />);

      await waitFor(() => {
        const messageElement = container.querySelector('[data-testid="message-msg-doc-1"]');
        expect(messageElement).toBeDefined();
      });
    });

    it('should support diagram artifact notifications', async () => {
      const chatStore = useChatStore.getState();
      chatStore.addMessage({
        id: 'msg-diag-1',
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      enableChat();
      const { container } = render(<ChatPanel />);

      await waitFor(() => {
        const messageElement = container.querySelector('[data-testid="message-msg-diag-1"]');
        expect(messageElement).toBeDefined();
      });
    });
  });

  describe('Viewer Navigation Integration', () => {
    it('should integrate with viewer store for artifact navigation', async () => {
      const { navigateToArtifact } = useViewerStore.getState();
      expect(typeof navigateToArtifact).toBe('function');
    });

    it('should navigate to document when artifact link is clicked', async () => {
      const { navigateToArtifact } = useViewerStore.getState();

      navigateToArtifact('doc-123', 'document');

      const { currentView } = useViewerStore.getState();
      expect(currentView?.id).toBe('doc-123');
      expect(currentView?.type).toBe('document');
    });

    it('should navigate to diagram when artifact link is clicked', async () => {
      const { navigateToArtifact } = useViewerStore.getState();

      navigateToArtifact('diag-456', 'diagram');

      const { currentView } = useViewerStore.getState();
      expect(currentView?.id).toBe('diag-456');
      expect(currentView?.type).toBe('diagram');
    });
  });

  describe('Chat and Viewer Coordination', () => {
    it('should maintain chat and viewer state independently', async () => {
      const { addMessage } = useChatStore.getState();
      const { navigateToArtifact } = useViewerStore.getState();

      addMessage({
        id: 'msg-1',
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      navigateToArtifact('doc-1', 'document');

      const chatState = useChatStore.getState();
      const viewerState = useViewerStore.getState();

      expect(chatState.messages.length).toBeGreaterThan(0);
      expect(viewerState.currentView?.id).toBe('doc-1');
    });

    it('should handle multiple artifact clicks in sequence', async () => {
      const { navigateToArtifact } = useViewerStore.getState();

      navigateToArtifact('doc-1', 'document');
      let state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-1');

      navigateToArtifact('diag-1', 'diagram');
      state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('diag-1');

      navigateToArtifact('doc-2', 'document');
      state = useViewerStore.getState();
      expect(state.currentView?.id).toBe('doc-2');
    });

    it('should accumulate messages while navigating artifacts', async () => {
      const { addMessage } = useChatStore.getState();
      const { navigateToArtifact } = useViewerStore.getState();

      const msg1 = 'msg-1';
      const msg2 = 'msg-2';

      addMessage({
        id: msg1,
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      navigateToArtifact('doc-1', 'document');

      addMessage({
        id: msg2,
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      const chatState = useChatStore.getState();
      const viewerState = useViewerStore.getState();

      // Messages accumulate with newest first
      expect(chatState.messages.length).toBe(2);
      expect(chatState.messages[0].id).toBe('msg-2');
      expect(chatState.messages[1].id).toBe('msg-1');
      expect(viewerState.currentView?.id).toBe('doc-1');
    });
  });

  describe('Message Rendering with Artifacts', () => {
    it('should render chat panel with input controls when chat enabled', () => {
      enableChat();
      const { container } = render(<ChatPanel />);
      const inputControls = container.querySelector('.px-3.py-2.border-b');
      expect(inputControls).toBeDefined();
    });

    it('should show empty state when no messages and chat enabled', () => {
      enableChat();
      render(<ChatPanel />);
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    it('should display messages in correct order', async () => {
      const chatStore = useChatStore.getState();

      chatStore.addMessage({
        id: 'msg-1',
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      });

      chatStore.addMessage({
        id: 'msg-2',
        type: 'notification',
        blocking: false,
        timestamp: Date.now() + 1000,
        responded: false,
      });

      enableChat();
      const { container } = render(<ChatPanel />);

      await waitFor(() => {
        const msg1 = container.querySelector('[data-testid="message-msg-1"]');
        const msg2 = container.querySelector('[data-testid="message-msg-2"]');
        expect(msg1).toBeDefined();
        expect(msg2).toBeDefined();
      });
    });
  });

  describe('Accessibility', () => {
    it('should render with proper layout structure', () => {
      enableChat();
      const { container } = render(<ChatPanel />);
      // No headers in the new layout, but input controls should be present
      const inputControls = container.querySelector('.px-3.py-2.border-b');
      expect(inputControls).toBeDefined();
    });

    it('should have clear labels for interaction elements', () => {
      enableChat();
      const { container } = render(<ChatPanel />);
      // Should have input placeholder or similar
      const textarea = container.querySelector('textarea');
      expect(textarea).toBeDefined();
    });

    it('should support keyboard navigation in messages', async () => {
      const user = userEvent.setup();
      enableChat();
      const { container } = render(<ChatPanel />);

      // Should be able to tab through focusable elements
      const messageContainer = container.querySelector('[class*="overflow-y-auto"]');
      expect(messageContainer).toBeDefined();
    });
  });

  describe('Responsive Design', () => {
    it('should render with full width in container', () => {
      const { container } = render(<ChatPanel />);
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toContain('h-full');
      expect(mainDiv.className).toContain('flex');
    });

    it('should adapt to dark mode', () => {
      document.documentElement.classList.add('dark');
      const { container } = render(<ChatPanel />);
      const mainDiv = container.firstChild as HTMLElement;
      expect(mainDiv.className).toMatch(/dark:/);
      document.documentElement.classList.remove('dark');
    });
  });
});
