/**
 * Notification Service
 *
 * Handles browser notifications when Claude needs user input.
 * Manages Notification API permissions and shows browser notifications
 * for blocking UI render messages.
 */

/**
 * Request notification permission from the user
 *
 * Returns the current permission status:
 * - 'granted' - user allowed notifications
 * - 'denied' - user blocked notifications
 * - 'default' - user dismissed the prompt
 *
 * Gracefully handles cases where Notification API is not available.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  // Check if Notification API is available
  const NotificationAPI = (window as any).Notification;
  if (!NotificationAPI) {
    console.warn('Notification API not available');
    return 'denied';
  }

  // If already granted or denied, return current status
  if (NotificationAPI.permission && NotificationAPI.permission !== 'default') {
    return NotificationAPI.permission;
  }

  // Request permission
  try {
    const permission = await NotificationAPI.requestPermission();
    return permission;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return 'denied';
  }
}

/**
 * Show a browser notification for user input needed
 *
 * Creates a browser notification to alert the user that Claude is waiting for input,
 * even when the browser tab is not focused.
 *
 * @param uiId - Unique identifier for the UI render message
 * @returns The Notification instance, or undefined if API is unavailable
 */
export function showUserInputNotification(uiId: string): Notification | undefined {
  // Check if Notification API is available
  const NotificationAPI = (window as any).Notification;
  if (!NotificationAPI) {
    console.warn('Notification API not available');
    return undefined;
  }

  // Check if permission was granted
  if (NotificationAPI.permission !== 'granted') {
    console.warn('Notification permission not granted');
    return undefined;
  }

  // Create the notification
  try {
    const notification = new NotificationAPI('Claude is asking...', {
      body: 'Click here to respond',
      icon: '/claude-icon.png',
      tag: `claude-input-${uiId}`, // Prevents duplicate notifications for same message
      requireInteraction: true, // Keep notification visible until user acts
    });

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return undefined;
  }
}
