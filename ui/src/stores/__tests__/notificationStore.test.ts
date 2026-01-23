import { renderHook, act } from '@testing-library/react';
import { useNotificationStore, Toast, NotificationType } from '../notificationStore';

describe('useNotificationStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { result } = renderHook(() => useNotificationStore());
    act(() => {
      result.current.clearAll();
    });
  });

  describe('store initialization', () => {
    it('should initialize with empty toasts array', () => {
      const { result } = renderHook(() => useNotificationStore());

      expect(result.current.toasts).toEqual([]);
    });
  });

  describe('addToast', () => {
    it('should add a notification to the store', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Test notification',
          duration: 4000,
        });
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].type).toBe('success');
      expect(result.current.toasts[0].title).toBe('Test notification');
      expect(result.current.toasts[0].duration).toBe(4000);
    });

    it('should generate unique ID for each toast', () => {
      const { result } = renderHook(() => useNotificationStore());
      const ids: string[] = [];

      act(() => {
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 1',
            duration: 4000,
          })
        );
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 2',
            duration: 4000,
          })
        );
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 3',
            duration: 4000,
          })
        );
      });

      // All IDs should be unique
      expect(new Set(ids).size).toBe(3);
      expect(ids[0]).not.toBe(ids[1]);
      expect(ids[1]).not.toBe(ids[2]);
    });

    it('should return the generated ID', () => {
      const { result } = renderHook(() => useNotificationStore());
      let returnedId: string;

      act(() => {
        returnedId = result.current.addToast({
          type: 'error',
          title: 'Error message',
          duration: 4000,
        });
      });

      expect(returnedId).toBeDefined();
      expect(returnedId).toBe(result.current.toasts[0].id);
      expect(returnedId).toMatch(/^toast_\d+_[0-9a-f]{4}$/);
    });

    it('should set timestamp on toast', () => {
      const { result } = renderHook(() => useNotificationStore());
      const beforeTime = Date.now();

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Timestamped toast',
          duration: 4000,
        });
      });

      const afterTime = Date.now();
      const toast = result.current.toasts[0];

      expect(toast.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(toast.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should handle optional message field', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Without message',
          duration: 4000,
        });
        result.current.addToast({
          type: 'success',
          title: 'With message',
          message: 'This is a message',
          duration: 4000,
        });
      });

      expect(result.current.toasts[0].message).toBeUndefined();
      expect(result.current.toasts[1].message).toBe('This is a message');
    });

    it('should support all notification types', () => {
      const { result } = renderHook(() => useNotificationStore());
      const types: NotificationType[] = ['info', 'success', 'warning', 'error'];

      act(() => {
        types.forEach((type) => {
          result.current.addToast({
            type,
            title: `${type} notification`,
            duration: 4000,
          });
        });
      });

      expect(result.current.toasts).toHaveLength(4);
      types.forEach((type, index) => {
        expect(result.current.toasts[index].type).toBe(type);
      });
    });

    it('should auto-dismiss toast when duration > 0', async () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Auto-dismiss toast',
          duration: 100, // 100ms for testing
        });
      });

      expect(result.current.toasts).toHaveLength(1);

      // Wait for the timeout to trigger
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should not auto-dismiss toast when duration is 0', async () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Persistent toast',
          duration: 0, // Persistent
        });
      });

      expect(result.current.toasts).toHaveLength(1);

      // Wait to ensure nothing is removed
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.toasts).toHaveLength(1);
    });

    it('should maintain insertion order in toasts array', () => {
      const { result } = renderHook(() => useNotificationStore());
      const titles = ['First', 'Second', 'Third'];

      act(() => {
        titles.forEach((title) => {
          result.current.addToast({
            type: 'info',
            title,
            duration: 4000,
          });
        });
      });

      titles.forEach((title, index) => {
        expect(result.current.toasts[index].title).toBe(title);
      });
    });
  });

  describe('removeToast', () => {
    it('should remove a toast by id', () => {
      const { result } = renderHook(() => useNotificationStore());
      let toastId: string;

      act(() => {
        toastId = result.current.addToast({
          type: 'info',
          title: 'Toast to remove',
          duration: 4000,
        });
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.removeToast(toastId);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should only remove the specified toast', () => {
      const { result } = renderHook(() => useNotificationStore());
      const ids: string[] = [];

      act(() => {
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 1',
            duration: 4000,
          })
        );
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 2',
            duration: 4000,
          })
        );
        ids.push(
          result.current.addToast({
            type: 'info',
            title: 'Toast 3',
            duration: 4000,
          })
        );
      });

      act(() => {
        result.current.removeToast(ids[1]); // Remove middle toast
      });

      expect(result.current.toasts).toHaveLength(2);
      expect(result.current.toasts[0].id).toBe(ids[0]);
      expect(result.current.toasts[1].id).toBe(ids[2]);
    });

    it('should handle removing non-existent toast gracefully', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Existing toast',
          duration: 4000,
        });
      });

      expect(result.current.toasts).toHaveLength(1);

      // Should not error when removing non-existent ID
      act(() => {
        result.current.removeToast('non-existent-id');
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should clear all toasts', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Toast 1',
          duration: 4000,
        });
        result.current.addToast({
          type: 'success',
          title: 'Toast 2',
          duration: 4000,
        });
        result.current.addToast({
          type: 'error',
          title: 'Toast 3',
          duration: 4000,
        });
      });

      expect(result.current.toasts).toHaveLength(3);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should handle clearing empty store', () => {
      const { result } = renderHook(() => useNotificationStore());

      expect(result.current.toasts).toHaveLength(0);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple rapid additions and removals', () => {
      const { result } = renderHook(() => useNotificationStore());
      const ids: string[] = [];

      act(() => {
        for (let i = 0; i < 10; i++) {
          ids.push(
            result.current.addToast({
              type: 'info',
              title: `Toast ${i}`,
              duration: 4000,
            })
          );
        }
      });

      expect(result.current.toasts).toHaveLength(10);

      act(() => {
        // Remove every other toast
        for (let i = 0; i < ids.length; i += 2) {
          result.current.removeToast(ids[i]);
        }
      });

      expect(result.current.toasts).toHaveLength(5);
    });

    it('should maintain state consistency across operations', () => {
      const { result } = renderHook(() => useNotificationStore());

      act(() => {
        const id1 = result.current.addToast({
          type: 'info',
          title: 'Toast 1',
          duration: 4000,
        });
        const id2 = result.current.addToast({
          type: 'success',
          title: 'Toast 2',
          duration: 4000,
        });

        result.current.removeToast(id1);

        const id3 = result.current.addToast({
          type: 'error',
          title: 'Toast 3',
          duration: 4000,
        });

        result.current.clearAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });
  });
});
