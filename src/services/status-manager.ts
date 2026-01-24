/**
 * Status Manager
 * Manages global agent status state
 */

import type { WebSocketHandler } from '../websocket/handler';

export type AgentStatus = 'working' | 'waiting' | 'idle';

export interface StatusState {
  status: AgentStatus;
  message?: string;
}

export interface StatusResponse {
  status: AgentStatus;
  message?: string;
  lastActivity: string;
}

interface InternalStatusState extends StatusState {
  lastActivity: Date;
}

class StatusManager {
  private currentStatus: InternalStatusState = {
    status: 'idle',
    message: undefined,
    lastActivity: new Date(),
  };

  private listeners: Array<(status: StatusResponse) => void> = [];
  private wsHandler: WebSocketHandler | null = null;

  setWebSocketHandler(wsHandler: WebSocketHandler): void {
    this.wsHandler = wsHandler;
  }

  updateStatus(status: AgentStatus, message?: string): void {
    this.currentStatus = {
      status,
      message,
      lastActivity: new Date(),
    };

    // Broadcast to WebSocket clients if handler is set
    if (this.wsHandler) {
      this.wsHandler.broadcastStatus(status, message, this.currentStatus.lastActivity.toISOString());
    }

    // Notify all listeners
    this.notifyListeners();
  }

  getStatus(): StatusResponse {
    return {
      status: this.currentStatus.status,
      message: this.currentStatus.message,
      lastActivity: this.currentStatus.lastActivity.toISOString(),
    };
  }

  subscribe(listener: (status: StatusResponse) => void): () => void {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error notifying status listener:', error);
      }
    });
  }
}

export const statusManager = new StatusManager();
