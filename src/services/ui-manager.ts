/**
 * UI Manager Service
 * Manages pending UI renders and Promise resolution for blocking mode.
 */

export interface PendingUI {
  uiId: string;
  project: string;
  session: string;
  blocking: boolean;
  createdAt: number;
  resolve: (response: UIResponse) => void;
  reject: (error: Error) => void;
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
    const { project, session, ui, blocking: rawBlocking, uiId: externalUiId } = request;

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
      // Store pending UI
      const pendingUI: PendingUI = {
        uiId,
        project,
        session,
        blocking,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      this.pendingUIs.set(sessionKey, pendingUI);
    });
  }

  /**
   * Receive a response from browser/terminal for a pending or non-blocking UI.
   * For blocking mode: resolves the Promise and cleans up state.
   * For non-blocking mode: updates the cached UI status for polling.
   */
  receiveResponse(sessionKey: string, uiId: string, response: Partial<UIResponse>): boolean {
    // 1. Check for cached UI (required for both blocking and non-blocking modes)
    const cachedUI = this.currentUIBySession.get(sessionKey);
    if (!cachedUI || cachedUI.uiId !== uiId) {
      return false; // No cached UI or stale response
    }

    // 2. Update cache status (for both blocking and non-blocking modes)
    cachedUI.status = 'responded';
    cachedUI.respondedAt = Date.now();
    cachedUI.response = response;

    // 3. For blocking mode, also resolve the pending Promise
    const pending = this.pendingUIs.get(sessionKey);
    if (pending && pending.uiId === uiId) {
      const result: UIResponse = {
        completed: true,
        source: response.source || 'browser',
        action: response.action,
        data: response.data,
      };
      pending.resolve(result);
      this.pendingUIs.delete(sessionKey);
    }

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

  /**
   * Get UI response status for polling pattern.
   * Used when render_ui is called with blocking=false.
   */
  getUIStatus(project: string, session: string, uiId: string): {
    status: 'pending' | 'responded' | 'stale' | 'not_found';
    action?: string;
    data?: Record<string, any>;
  } {
    const sessionKey = `${project}:${session}`;
    const cachedUI = this.currentUIBySession.get(sessionKey);

    if (!cachedUI) {
      return { status: 'not_found' };
    }

    if (cachedUI.uiId !== uiId) {
      return { status: 'stale' };
    }

    if (cachedUI.status === 'responded') {
      return {
        status: 'responded',
        action: cachedUI.response?.action,
        data: cachedUI.response?.data,
      };
    }

    return { status: 'pending' };
  }
}

// Singleton instance for convenience
export const uiManager = new UIManager();
