/**
 * UI Manager Service
 * Manages pending UI renders and Promise resolution for blocking mode.
 */

export interface PendingUI {
  uiId: string;
  project: string;
  session: string;
  blocking: boolean;
  timeout: number;
  createdAt: number;
  resolve: (response: UIResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface UIResponse {
  completed: boolean;
  source: 'browser' | 'terminal' | 'timeout';
  action?: string;
  data?: Record<string, any>;
  error?: string;
}

export type UIStatus = 'pending' | 'responded' | 'canceled';

export interface CachedUI {
  uiId: string;
  project: string;
  session: string;
  ui: any;
  blocking: boolean;
  status: UIStatus;
  createdAt: number;
  respondedAt?: number;
  response?: Partial<UIResponse>;
}

export interface RenderUIRequest {
  project: string;
  session: string;
  ui: any;
  blocking?: boolean;
  timeout?: number;
  uiId?: string;  // Optional external uiId to use instead of generating one
}

/**
 * Generate a unique UI ID
 */
function generateUIId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `ui_${timestamp}_${random}`;
}

export class UIManager {
  private pendingUIs: Map<string, PendingUI> = new Map();
  private currentUIBySession: Map<string, CachedUI> = new Map();

  /**
   * Register a UI render request and optionally wait for response.
   * Returns a Promise that resolves when user responds (blocking mode)
   * or immediately (non-blocking mode).
   */
  async renderUI(request: RenderUIRequest): Promise<UIResponse> {
    const { project, session, ui, blocking: rawBlocking, timeout: rawTimeout, uiId: externalUiId } = request;

    // 1. Validate inputs
    if (!project || !session) {
      throw new Error('project and session required');
    }
    if (!ui || typeof ui !== 'object') {
      throw new Error('ui must be an object');
    }
    if (!ui.type) {
      throw new Error('ui must have a type');
    }

    // 2. Normalize options
    const blocking = rawBlocking ?? true;
    const timeout = rawTimeout ?? 30000;

    if (timeout < 1000) {
      throw new Error('timeout must be at least 1000ms');
    }
    if (timeout > 300000) {
      throw new Error('timeout must not exceed 300000ms');
    }

    // 3. Use provided UI ID or generate one
    const uiId = externalUiId || generateUIId();

    // 4. Build session key
    const sessionKey = `${project}:${session}`;

    // 5. Cache the UI for reconnection recovery
    const cachedUI: CachedUI = {
      uiId,
      project,
      session,
      ui,
      blocking,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.currentUIBySession.set(sessionKey, cachedUI);

    // 6. If non-blocking mode, return immediately
    if (!blocking) {
      return {
        completed: true,
        source: 'terminal',
        action: undefined,
        data: undefined,
      };
    }

    // 7. If blocking mode, create Promise with resolve/reject handlers
    return new Promise<UIResponse>((resolve, reject) => {
      // Set up timeout handler
      const timeoutHandle = setTimeout(() => {
        // Clean up the pending UI
        this.pendingUIs.delete(sessionKey);
        reject(new Error(`Timeout after ${timeout}ms`));
      }, timeout);

      // Store pending UI
      const pendingUI: PendingUI = {
        uiId,
        project,
        session,
        blocking,
        timeout,
        createdAt: Date.now(),
        resolve,
        reject,
        timeoutHandle,
      };

      this.pendingUIs.set(sessionKey, pendingUI);
    });
  }

  /**
   * Receive a response from browser/terminal for a pending UI.
   * Resolves the Promise and cleans up state.
   */
  receiveResponse(sessionKey: string, uiId: string, response: Partial<UIResponse>): boolean {
    // 1. Get pending UI for session
    const pending = this.pendingUIs.get(sessionKey);
    if (!pending) {
      return false;
    }

    // 2. Validate uiId matches
    if (pending.uiId !== uiId) {
      return false; // Stale response ignored
    }

    // 3. Clear timeout
    clearTimeout(pending.timeoutHandle);

    // 4. Build response object
    const result: UIResponse = {
      completed: true,
      source: response.source || 'browser',
      action: response.action,
      data: response.data,
    };

    // 5. Update cache status
    const cachedUI = this.currentUIBySession.get(sessionKey);
    if (cachedUI && cachedUI.uiId === uiId) {
      cachedUI.status = 'responded';
      cachedUI.respondedAt = Date.now();
      cachedUI.response = response;
    }

    // 6. Resolve the Promise
    pending.resolve(result);

    // 7. Cleanup
    this.pendingUIs.delete(sessionKey);

    // 8. Return true (success)
    return true;
  }

  /**
   * Get the current pending UI for a session.
   */
  getPendingUI(sessionKey: string): PendingUI | null {
    return this.pendingUIs.get(sessionKey) || null;
  }

  /**
   * Dismiss a pending UI without response (timeout or user cancel).
   */
  dismissUI(sessionKey: string): boolean {
    const pending = this.pendingUIs.get(sessionKey);
    if (!pending) {
      return false;
    }

    // Update cache status to canceled
    const cachedUI = this.currentUIBySession.get(sessionKey);
    if (cachedUI && cachedUI.uiId === pending.uiId) {
      cachedUI.status = 'canceled';
    }

    // Clear timeout
    clearTimeout(pending.timeoutHandle);

    // Reject the Promise
    pending.reject(new Error('UI dismissed'));

    // Cleanup
    this.pendingUIs.delete(sessionKey);

    return true;
  }

  /**
   * Get the current cached UI for a session (for reconnection recovery).
   */
  getCurrentUI(sessionKey: string): CachedUI | null {
    return this.currentUIBySession.get(sessionKey) || null;
  }
}

// Singleton instance for convenience
export const uiManager = new UIManager();
