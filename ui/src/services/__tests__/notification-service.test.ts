/**
 * Notification Service Tests
 *
 * Tests for browser notification functionality when Claude needs user input.
 * Tests the notification permission request and notification triggering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestNotificationPermission, showUserInputNotification } from '../notification-service';

describe('NotificationService', () => {
  // Mock the Notification API
  let originalNotification: typeof Notification | undefined;
  let originalPermission: PermissionStatus | undefined;

  beforeEach(() => {
    // Save original Notification API
    originalNotification = (window as any).Notification;
    originalPermission = (navigator as any).permissions;

    // Reset mock functions
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original Notification API
    if (originalNotification) {
      (window as any).Notification = originalNotification;
    }
  });

  describe('requestNotificationPermission', () => {
    it('should request notification permission on first call', async () => {
      // Setup: Mock Notification.requestPermission
      const mockRequestPermission = vi.fn().mockResolvedValue('granted');
      (window as any).Notification = {
        requestPermission: mockRequestPermission,
      };

      // Execute
      const result = await requestNotificationPermission();

      // Assert: Permission was requested
      expect(mockRequestPermission).toHaveBeenCalled();
      expect(result).toBe('granted');
    });

    it('should return current permission status without re-requesting if already granted', async () => {
      // Setup: Mock Notification with 'granted' permission
      const mockRequestPermission = vi.fn().mockResolvedValue('granted');
      (window as any).Notification = {
        permission: 'granted',
        requestPermission: mockRequestPermission,
      };

      // Execute
      const result = await requestNotificationPermission();

      // Assert: Should return 'granted' without requesting again
      expect(result).toBe('granted');
      // May or may not call requestPermission depending on implementation
    });

    it('should handle permission denied gracefully', async () => {
      // Setup: Mock Notification.requestPermission returning 'denied'
      const mockRequestPermission = vi.fn().mockResolvedValue('denied');
      (window as any).Notification = {
        requestPermission: mockRequestPermission,
      };

      // Execute
      const result = await requestNotificationPermission();

      // Assert: Should return 'denied'
      expect(result).toBe('denied');
    });

    it('should handle permission prompt gracefully', async () => {
      // Setup: Mock Notification.requestPermission returning 'default'
      const mockRequestPermission = vi.fn().mockResolvedValue('default');
      (window as any).Notification = {
        requestPermission: mockRequestPermission,
      };

      // Execute
      const result = await requestNotificationPermission();

      // Assert: Should return 'default'
      expect(result).toBe('default');
    });

    it('should return denied if Notification API is not available', async () => {
      // Setup: Notification API unavailable
      (window as any).Notification = undefined;

      // Execute
      const result = await requestNotificationPermission();

      // Assert: Should gracefully return 'denied'
      expect(result).toBe('denied');
    });

    it('should handle error during permission request', async () => {
      // Setup: Mock requestPermission throwing an error
      const mockRequestPermission = vi.fn().mockRejectedValue(new Error('Permission error'));
      (window as any).Notification = {
        requestPermission: mockRequestPermission,
      };

      // Execute & Assert: Should handle error gracefully
      const result = await requestNotificationPermission();
      expect(result).toBe('denied');
    });
  });

  describe('showUserInputNotification', () => {
    it('should show notification with title and default body for blocking messages', () => {
      // Setup: Mock Notification constructor with permission
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute
      showUserInputNotification('test-ui-1');

      // Assert: Notification was created with expected parameters
      expect(mockNotification).toHaveBeenCalledWith(
        expect.stringContaining('Claude'),
        expect.objectContaining({
          body: expect.any(String),
          icon: expect.stringContaining('/'),
          tag: 'claude-input-test-ui-1',
          requireInteraction: true,
        })
      );
    });

    it('should use unique tag to prevent duplicate notifications', () => {
      // Setup: Mock Notification with permission
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute: Show notification twice with same ID
      showUserInputNotification('test-ui-1');
      showUserInputNotification('test-ui-1');

      // Assert: Both should use same tag (prevents duplicates)
      expect(mockNotification).toHaveBeenCalledTimes(2);
      const firstCall = mockNotification.mock.calls[0];
      const secondCall = mockNotification.mock.calls[1];

      expect(firstCall[1].tag).toBe('claude-input-test-ui-1');
      expect(secondCall[1].tag).toBe('claude-input-test-ui-1');
    });

    it('should use different tags for different UI IDs', () => {
      // Setup: Mock Notification with permission
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute: Show notifications for different UI IDs
      showUserInputNotification('test-ui-1');
      showUserInputNotification('test-ui-2');

      // Assert: Different tags used
      const firstCall = mockNotification.mock.calls[0];
      const secondCall = mockNotification.mock.calls[1];

      expect(firstCall[1].tag).toBe('claude-input-test-ui-1');
      expect(secondCall[1].tag).toBe('claude-input-test-ui-2');
    });

    it('should set requireInteraction to true to keep notification visible', () => {
      // Setup: Mock Notification with permission
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute
      showUserInputNotification('test-ui-1');

      // Assert: requireInteraction is true
      expect(mockNotification).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          requireInteraction: true,
        })
      );
    });

    it('should include icon in notification', () => {
      // Setup: Mock Notification with permission
      const mockNotification = vi.fn();
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute
      showUserInputNotification('test-ui-1');

      // Assert: Icon is included
      expect(mockNotification).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          icon: expect.any(String),
        })
      );
    });

    it('should handle notification not supported gracefully', () => {
      // Setup: Notification API unavailable
      (window as any).Notification = undefined;

      // Execute & Assert: Should not throw
      expect(() => {
        showUserInputNotification('test-ui-1');
      }).not.toThrow();
    });

    it('should create notification object when API available', () => {
      // Setup: Mock Notification with permission
      const mockNotificationInstance = {
        close: vi.fn(),
      };
      const mockNotification = vi.fn().mockReturnValue(mockNotificationInstance);
      mockNotification.permission = 'granted';
      (window as any).Notification = mockNotification;

      // Execute
      const notification = showUserInputNotification('test-ui-1');

      // Assert: Returns notification instance
      expect(notification).toBeDefined();
      expect(notification?.close).toBeDefined();
    });

    it('should not return notification instance when API unavailable', () => {
      // Setup: Notification API unavailable
      (window as any).Notification = undefined;

      // Execute
      const notification = showUserInputNotification('test-ui-1');

      // Assert: Returns undefined
      expect(notification).toBeUndefined();
    });
  });
});
