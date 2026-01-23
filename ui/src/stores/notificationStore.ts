import { create } from 'zustand';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration: number;
  timestamp: number;
}

interface NotificationState {
  toasts: Toast[];
}

interface NotificationActions {
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

// Helper function to generate a random hex string
const randomHex = (length: number): string => {
  return Math.floor(Math.random() * Math.pow(16, length))
    .toString(16)
    .padStart(length, '0');
};

export const useNotificationStore = create<NotificationState & NotificationActions>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    // Generate id = `toast_${Date.now()}_${randomHex(4)}`
    const id = `toast_${Date.now()}_${randomHex(4)}`;

    // Create full toast with id and timestamp
    const fullToast: Toast = {
      id,
      timestamp: Date.now(),
      ...toast,
    };

    // Add to toasts array
    set((state) => ({
      toasts: [...state.toasts, fullToast],
    }));

    // If toast.duration > 0, set auto-dismiss timeout
    if (toast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, toast.duration);
    }

    return id;
  },

  removeToast: (id) => {
    // Filter toasts to remove matching id
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    // Set toasts = []
    set({ toasts: [] });
  },
}));
