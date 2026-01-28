/**
 * Chat Store - Zustand store for managing chat/UI state
 * Handles message state, responses, and drawer visibility
 */

import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  type: 'ui_render' | 'notification';
  ui?: any;
  blocking: boolean;
  timestamp: number;
  responded: boolean;
  response?: any;
  project?: string;
  session?: string;
  canceled?: boolean;
}

export interface CachedUIState {
  uiId: string;
  ui: any;
  blocking: boolean;
  status: 'pending' | 'responded' | 'canceled';
  createdAt: number;
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  unreadCount: number;
  currentBlockingId: string | null;
}

interface ChatActions {
  addMessage: (msg: ChatMessage) => void;
  respondToMessage: (id: string, response: any) => Promise<void>;
  markAsRead: (id: string) => void;
  setOpen: (open: boolean) => void;
  clearMessages: () => void;
  restoreUIFromCache: (cachedUI: CachedUIState, project?: string, session?: string) => void;
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  currentBlockingId: null,

  addMessage: (msg: ChatMessage) => {
    set((state) => {
      // Dedupe by ID - ignore if message already exists
      if (state.messages.some((m) => m.id === msg.id)) {
        return state;
      }

      // If new message is blocking, cancel any existing unresponded blocking messages
      // This handles the case where Claude Code sends a new message after timeout
      let updatedMessages = state.messages;
      if (msg.blocking) {
        updatedMessages = state.messages.map((m) =>
          m.blocking && !m.responded && !m.canceled ? { ...m, canceled: true } : m
        );
      }

      // Prepend new message and keep history (max 50 messages)
      const MAX_MESSAGES = 50;
      const newState = {
        messages: [msg, ...updatedMessages].slice(0, MAX_MESSAGES),
        unreadCount: state.unreadCount,
        isOpen: state.isOpen,
        currentBlockingId: state.currentBlockingId,
      };

      // If blocking, auto-open drawer and set current blocking ID
      if (msg.blocking) {
        newState.currentBlockingId = msg.id;
        newState.isOpen = true;
      } else if (!msg.responded) {
        // If non-blocking and not already responded, increment unread count
        newState.unreadCount = state.unreadCount + 1;
      }

      return newState;
    });
  },

  respondToMessage: async (id: string, response: any) => {
    const state = get();

    // Find message by id
    const message = state.messages.find((msg) => msg.id === id);
    if (!message) {
      return;
    }

    try {
      // Build URL with project/session params
      const params = new URLSearchParams();
      if (message.project) params.set('project', message.project);
      if (message.session) params.set('session', message.session);
      const url = `/api/ui-response?${params.toString()}`;

      // Make API call to submit response
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uiId: id,
          action: response.action,
          data: response.data,
        }),
      });

      // Mark message as responded
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === id
            ? {
                ...msg,
                responded: true,
                response,
              }
            : msg
        ),
        currentBlockingId:
          id === state.currentBlockingId ? null : state.currentBlockingId,
      }));
    } catch (error) {
      console.error('Failed to respond to message:', error);
    }
  },

  markAsRead: (id: string) => {
    set((state) => {
      const message = state.messages.find((msg) => msg.id === id);

      // Only decrement unread count if message exists and hasn't been marked as read before
      const shouldDecrement = message && !message.responded && !message.blocking;

      return {
        unreadCount: shouldDecrement ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    });
  },

  setOpen: (open: boolean) => {
    set((state) => {
      let newUnreadCount = state.unreadCount;

      // If opening, mark all visible messages as read
      if (open) {
        // Count non-blocking, non-responded messages
        const visibleUnread = state.messages.filter(
          (msg) => !msg.blocking && !msg.responded
        ).length;
        newUnreadCount = 0;
      }

      return {
        isOpen: open,
        unreadCount: newUnreadCount,
      };
    });
  },

  clearMessages: () => {
    set({
      messages: [],
      unreadCount: 0,
      currentBlockingId: null,
    });
  },

  restoreUIFromCache: (cachedUI: CachedUIState, project?: string, session?: string) => {
    set((state) => {
      // Check if message with this uiId already exists
      const existingIndex = state.messages.findIndex((m) => m.id === cachedUI.uiId);

      if (existingIndex !== -1) {
        // Update existing message status (also add project/session if missing)
        const updatedMessages = [...state.messages];
        updatedMessages[existingIndex] = {
          ...updatedMessages[existingIndex],
          canceled: cachedUI.status === 'canceled',
          responded: cachedUI.status === 'responded',
          project: updatedMessages[existingIndex].project || project,
          session: updatedMessages[existingIndex].session || session,
        };
        return { messages: updatedMessages };
      }

      // Create new message from cached UI
      const newMessage: ChatMessage = {
        id: cachedUI.uiId,
        type: 'ui_render',
        ui: cachedUI.ui,
        blocking: cachedUI.blocking,
        timestamp: cachedUI.createdAt,
        responded: cachedUI.status === 'responded',
        canceled: cachedUI.status === 'canceled',
        project,
        session,
      };

      const newState = {
        messages: [newMessage, ...state.messages],
        unreadCount: state.unreadCount,
        isOpen: state.isOpen,
        currentBlockingId: state.currentBlockingId,
      };

      // If blocking and pending, auto-open drawer and set current blocking ID
      if (cachedUI.blocking && cachedUI.status === 'pending') {
        newState.currentBlockingId = cachedUI.uiId;
        newState.isOpen = true;
      }

      return newState;
    });
  },
}));
