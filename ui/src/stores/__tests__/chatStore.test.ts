import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore, type ChatMessage } from '../chatStore';

describe('useChatStore', () => {
  beforeEach(() => {
    // Clear the store before each test
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
      currentBlockingId: null,
    });
  });

  afterEach(() => {
    // Clean up after each test
    useChatStore.setState({
      messages: [],
      isOpen: false,
      unreadCount: 0,
      currentBlockingId: null,
    });
    vi.clearAllMocks();
  });

  describe('Store Initialization', () => {
    it('should initialize with empty state', () => {
      const state = useChatStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isOpen).toBe(false);
      expect(state.unreadCount).toBe(0);
      expect(state.currentBlockingId).toBeNull();
    });

    it('should have all required actions', () => {
      const state = useChatStore.getState();
      expect(typeof state.addMessage).toBe('function');
      expect(typeof state.respondToMessage).toBe('function');
      expect(typeof state.markAsRead).toBe('function');
      expect(typeof state.setOpen).toBe('function');
      expect(typeof state.clearMessages).toBe('function');
    });
  });

  describe('Adding Messages', () => {
    it('should add a non-blocking message', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(msg);
    });

    it('should increment unread count for non-blocking message', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.unreadCount).toBe(1);
    });

    it('should add blocking message and auto-open drawer', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.isOpen).toBe(true);
      expect(state.currentBlockingId).toBe('msg1');
      expect(state.unreadCount).toBe(0); // Blocking messages don't increment unread
    });

    it('should accumulate messages with newest first', () => {
      const msg1: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      const msg2: ChatMessage = {
        id: 'msg2',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now() + 1000,
        responded: false,
      };

      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);

      const state = useChatStore.getState();
      // Should keep both messages with newest first
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).toBe('msg2');
      expect(state.messages[1].id).toBe('msg1');
    });

    it('should limit messages to MAX_MESSAGES (50)', () => {
      // Add 55 messages
      for (let i = 0; i < 55; i++) {
        const msg: ChatMessage = {
          id: `msg${i}`,
          type: 'ui_render',
          blocking: false,
          timestamp: i * 1000,
          responded: false,
        };
        useChatStore.getState().addMessage(msg);
      }

      const state = useChatStore.getState();
      // Should only keep 50 messages
      expect(state.messages).toHaveLength(50);
      // Newest message should be first
      expect(state.messages[0].id).toBe('msg54');
      // Oldest kept message should be msg5 (lost msg0-msg4)
      expect(state.messages[49].id).toBe('msg5');
    });

    it('should add message with UI data', () => {
      const ui = { type: 'confirmation', message: 'Do you want to proceed?' };
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        ui,
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.messages[0].ui).toEqual(ui);
    });

    it('should update currentBlockingId when adding new blocking message', () => {
      const msg1: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      const msg2: ChatMessage = {
        id: 'msg2',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now() + 1000,
        responded: false,
      };

      useChatStore.getState().addMessage(msg1);
      expect(useChatStore.getState().currentBlockingId).toBe('msg1');

      useChatStore.getState().addMessage(msg2);
      expect(useChatStore.getState().currentBlockingId).toBe('msg2');
    });
  });

  describe('Responding to Messages', () => {
    beforeEach(() => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };
      useChatStore.getState().addMessage(msg);
    });

    it('should mark message as responded', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          })
        )
      );

      const response = { action: 'confirm', data: {} };
      await useChatStore.getState().respondToMessage('msg1', response);

      const state = useChatStore.getState();
      expect(state.messages[0].responded).toBe(true);
      expect(state.messages[0].response).toEqual(response);

      vi.unstubAllGlobals();
    });

    it('should call API with correct payload', async () => {
      const fetchSpy = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        })
      );

      vi.stubGlobal('fetch', fetchSpy);

      const response = { action: 'confirm', data: { approved: true } };
      await useChatStore.getState().respondToMessage('msg1', response);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/ui-response'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            uiId: 'msg1',
            action: 'confirm',
            data: { approved: true },
          }),
        }
      );

      vi.unstubAllGlobals();
    });

    it('should handle response for non-existent message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          })
        )
      );

      const response = { action: 'confirm', data: {} };
      await useChatStore.getState().respondToMessage('non-existent', response);

      // Should not throw and messages should remain unchanged
      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(1);

      vi.unstubAllGlobals();
    });

    it('should clear currentBlockingId when responding to blocking message', async () => {
      useChatStore.setState({
        messages: [],
        currentBlockingId: null,
      });

      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().currentBlockingId).toBe('msg1');

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          })
        )
      );

      const response = { action: 'confirm', data: {} };
      await useChatStore.getState().respondToMessage('msg1', response);

      expect(useChatStore.getState().currentBlockingId).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should handle API errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.reject(new Error('Network error'))
        )
      );

      const response = { action: 'confirm', data: {} };
      await useChatStore.getState().respondToMessage('msg1', response);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to respond to message:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });

  describe('Marking Messages as Read', () => {
    it('should decrement unread count for unread non-blocking message', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().unreadCount).toBe(1);

      useChatStore.getState().markAsRead('msg1');

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should not decrement below zero', () => {
      useChatStore.getState().markAsRead('msg1');

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should not decrement unread for blocking messages', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().unreadCount).toBe(0);

      useChatStore.getState().markAsRead('msg1');

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should not decrement unread for already responded messages', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: true,
        response: { action: 'confirm' },
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().unreadCount).toBe(0); // Non-blocking but already responded

      useChatStore.getState().markAsRead('msg1');

      expect(useChatStore.getState().unreadCount).toBe(0);
    });
  });

  describe('Setting Drawer Open/Close', () => {
    it('should set drawer open', () => {
      useChatStore.getState().setOpen(true);

      const state = useChatStore.getState();
      expect(state.isOpen).toBe(true);
    });

    it('should set drawer closed', () => {
      useChatStore.getState().setOpen(true);
      useChatStore.getState().setOpen(false);

      const state = useChatStore.getState();
      expect(state.isOpen).toBe(false);
    });

    it('should clear unread count when opening', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().unreadCount).toBe(1);

      useChatStore.getState().setOpen(true);

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should not affect unread count when closing', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      useChatStore.getState().setOpen(true);
      useChatStore.getState().setOpen(false);

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should clear unread only for non-blocking, non-responded messages', () => {
      const msg1: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      const msg2: ChatMessage = {
        id: 'msg2',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now() + 1000,
        responded: false,
      };

      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);
      expect(useChatStore.getState().unreadCount).toBe(1); // Only msg1 counts as unread

      useChatStore.getState().setOpen(true);

      expect(useChatStore.getState().unreadCount).toBe(0);
    });
  });

  describe('Clearing Messages', () => {
    it('should clear all messages', () => {
      const msg1: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      const msg2: ChatMessage = {
        id: 'msg2',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now() + 1000,
        responded: false,
      };

      useChatStore.getState().addMessage(msg1);
      useChatStore.getState().addMessage(msg2);

      useChatStore.getState().clearMessages();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
    });

    it('should reset unread count', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().unreadCount).toBe(1);

      useChatStore.getState().clearMessages();

      expect(useChatStore.getState().unreadCount).toBe(0);
    });

    it('should clear currentBlockingId', () => {
      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().currentBlockingId).toBe('msg1');

      useChatStore.getState().clearMessages();

      expect(useChatStore.getState().currentBlockingId).toBeNull();
    });
  });

  describe('Complex Workflows', () => {
    it('should handle mixed blocking and non-blocking messages', () => {
      const nonBlocking: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      const blocking: ChatMessage = {
        id: 'msg2',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now() + 1000,
        responded: false,
      };

      const nonBlocking2: ChatMessage = {
        id: 'msg3',
        type: 'ui_render',
        blocking: false,
        timestamp: Date.now() + 2000,
        responded: false,
      };

      useChatStore.getState().addMessage(nonBlocking);
      expect(useChatStore.getState().isOpen).toBe(false);
      expect(useChatStore.getState().unreadCount).toBe(1);

      useChatStore.getState().addMessage(blocking);
      expect(useChatStore.getState().isOpen).toBe(true);
      expect(useChatStore.getState().currentBlockingId).toBe('msg2');
      expect(useChatStore.getState().unreadCount).toBe(1); // Non-blocking only

      useChatStore.getState().addMessage(nonBlocking2);
      expect(useChatStore.getState().unreadCount).toBe(2);
    });

    it('should handle responding to and clearing messages', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          })
        )
      );

      const msg: ChatMessage = {
        id: 'msg1',
        type: 'ui_render',
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);
      expect(useChatStore.getState().currentBlockingId).toBe('msg1');

      const response = { action: 'confirm', data: {} };
      await useChatStore.getState().respondToMessage('msg1', response);

      expect(useChatStore.getState().currentBlockingId).toBeNull();

      useChatStore.getState().clearMessages();

      const state = useChatStore.getState();
      expect(state.messages).toHaveLength(0);
      expect(state.currentBlockingId).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should handle multiple unread messages and opening drawer', () => {
      for (let i = 0; i < 5; i++) {
        const msg: ChatMessage = {
          id: `msg${i}`,
          type: 'ui_render',
          blocking: false,
          timestamp: Date.now() + i * 1000,
          responded: false,
        };
        useChatStore.getState().addMessage(msg);
      }

      expect(useChatStore.getState().unreadCount).toBe(5);

      useChatStore.getState().setOpen(true);

      expect(useChatStore.getState().unreadCount).toBe(0);
      expect(useChatStore.getState().isOpen).toBe(true);
    });
  });

  describe('Store API', () => {
    it('should expose all required state properties', () => {
      const state = useChatStore.getState();
      expect(state).toHaveProperty('messages');
      expect(state).toHaveProperty('isOpen');
      expect(state).toHaveProperty('unreadCount');
      expect(state).toHaveProperty('currentBlockingId');
    });

    it('should have correct types for state properties', () => {
      const state = useChatStore.getState();
      expect(Array.isArray(state.messages)).toBe(true);
      expect(typeof state.isOpen).toBe('boolean');
      expect(typeof state.unreadCount).toBe('number');
      expect(
        state.currentBlockingId === null || typeof state.currentBlockingId === 'string'
      ).toBe(true);
    });

    it('should have all required action methods', () => {
      const state = useChatStore.getState();
      expect(typeof state.addMessage).toBe('function');
      expect(typeof state.respondToMessage).toBe('function');
      expect(typeof state.markAsRead).toBe('function');
      expect(typeof state.setOpen).toBe('function');
      expect(typeof state.clearMessages).toBe('function');
    });
  });

  describe('Message Types', () => {
    it('should handle notification type messages', () => {
      const msg: ChatMessage = {
        id: 'notif1',
        type: 'notification',
        blocking: false,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.messages[0].type).toBe('notification');
      expect(state.unreadCount).toBe(1);
    });

    it('should handle ui_render type messages', () => {
      const msg: ChatMessage = {
        id: 'ui1',
        type: 'ui_render',
        ui: { type: 'confirmation' },
        blocking: true,
        timestamp: Date.now(),
        responded: false,
      };

      useChatStore.getState().addMessage(msg);

      const state = useChatStore.getState();
      expect(state.messages[0].type).toBe('ui_render');
      expect(state.messages[0].ui).toBeDefined();
    });
  });
});
