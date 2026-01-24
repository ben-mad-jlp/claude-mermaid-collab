/**
 * Status Manager Test Suite
 * Verifies status tracking, retrieval, and notifications
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { statusManager, type AgentStatus, type StatusResponse } from '../status-manager';
import { WebSocketHandler } from '../../websocket/handler';

describe('StatusManager', () => {
  beforeEach(() => {
    // Reset status to idle
    statusManager.updateStatus('idle');
  });

  describe('getStatus', () => {
    it('should return current status with lastActivity timestamp', () => {
      const status = statusManager.getStatus();

      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('lastActivity');
      expect(status.status).toBe('idle');
      expect(typeof status.lastActivity).toBe('string');
    });

    it('should include message when provided', () => {
      statusManager.updateStatus('working', 'Processing');
      const status = statusManager.getStatus();

      expect(status.status).toBe('working');
      expect(status.message).toBe('Processing');
    });

    it('should return undefined for message when not provided', () => {
      statusManager.updateStatus('idle');
      const status = statusManager.getStatus();

      expect(status.message).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    it('should update status without message', () => {
      statusManager.updateStatus('working');
      const status = statusManager.getStatus();

      expect(status.status).toBe('working');
      expect(status.message).toBeUndefined();
    });

    it('should update status with message', () => {
      statusManager.updateStatus('waiting', 'Awaiting input');
      const status = statusManager.getStatus();

      expect(status.status).toBe('waiting');
      expect(status.message).toBe('Awaiting input');
    });

    it('should update lastActivity timestamp', async () => {
      const status1 = statusManager.getStatus();

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      statusManager.updateStatus('idle');
      const status2 = statusManager.getStatus();

      expect(new Date(status2.lastActivity).getTime()).toBeGreaterThan(
        new Date(status1.lastActivity).getTime()
      );
    });

    it('should support all agent status types', () => {
      const statuses: AgentStatus[] = ['working', 'waiting', 'idle'];

      statuses.forEach(agentStatus => {
        statusManager.updateStatus(agentStatus);
        const status = statusManager.getStatus();
        expect(status.status).toBe(agentStatus);
      });
    });
  });

  describe('subscribe', () => {
    it('should notify listener on status update', async () => {
      return new Promise<void>((resolve) => {
        const listener = (status: StatusResponse) => {
          expect(status.status).toBe('working');
          expect(status.message).toBe('Testing');
          unsubscribe();
          resolve();
        };

        const unsubscribe = statusManager.subscribe(listener);
        statusManager.updateStatus('working', 'Testing');
      });
    });

    it('should support multiple listeners', async () => {
      return new Promise<void>((resolve) => {
        let callCount = 0;

        const listener1 = () => {
          callCount++;
          if (callCount === 2) {
            unsubscribe1();
            unsubscribe2();
            resolve();
          }
        };

        const listener2 = () => {
          callCount++;
          if (callCount === 2) {
            unsubscribe1();
            unsubscribe2();
            resolve();
          }
        };

        const unsubscribe1 = statusManager.subscribe(listener1);
        const unsubscribe2 = statusManager.subscribe(listener2);
        statusManager.updateStatus('working');
      });
    });

    it('should return unsubscribe function', async () => {
      let callCount = 0;

      const listener = () => {
        callCount++;
      };

      const unsubscribe = statusManager.subscribe(listener);

      statusManager.updateStatus('working');
      expect(callCount).toBe(1);

      unsubscribe();

      statusManager.updateStatus('waiting');
      expect(callCount).toBe(1);
    });

    it('should handle listener errors gracefully', async () => {
      return new Promise<void>((resolve) => {
        const errorListener = () => {
          throw new Error('Listener error');
        };

        const goodListener = (status: StatusResponse) => {
          expect(status.status).toBe('idle');
          unsubscribe1();
          unsubscribe2();
          resolve();
        };

        const unsubscribe1 = statusManager.subscribe(errorListener);
        const unsubscribe2 = statusManager.subscribe(goodListener);

        // Should not throw, both listeners should be called
        statusManager.updateStatus('idle');
      });
    });
  });

  describe('StatusResponse format', () => {
    it('should have ISO format lastActivity', () => {
      statusManager.updateStatus('working');
      const status = statusManager.getStatus();

      // Should be parseable as ISO date
      const date = new Date(status.lastActivity);
      expect(date instanceof Date).toBe(true);
      expect(date.toISOString()).toBe(status.lastActivity);
    });
  });

  describe('WebSocket integration', () => {
    it('should set WebSocket handler', () => {
      const wsHandler = new WebSocketHandler();
      const broadcastSpy = vi.spyOn(wsHandler, 'broadcastStatus');

      statusManager.setWebSocketHandler(wsHandler);
      statusManager.updateStatus('working', 'Testing');

      expect(broadcastSpy).toHaveBeenCalledWith('working', 'Testing', expect.any(String));
      broadcastSpy.mockRestore();
    });

    it('should broadcast status changes', () => {
      const wsHandler = new WebSocketHandler();
      const broadcastSpy = vi.spyOn(wsHandler, 'broadcastStatus');

      statusManager.setWebSocketHandler(wsHandler);
      statusManager.updateStatus('idle', undefined);

      expect(broadcastSpy).toHaveBeenCalledWith('idle', undefined, expect.any(String));
      broadcastSpy.mockRestore();
    });

    it('should work without WebSocket handler', () => {
      const newStatusManager = new (statusManager.constructor as any)();
      expect(() => {
        newStatusManager.updateStatus('working');
      }).not.toThrow();
    });
  });
});
