/**
 * Status Manager Integration Test
 * Verifies status system works correctly end-to-end
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { statusManager } from '../status-manager';
import { WebSocketHandler } from '../../websocket/handler';

describe('Status System Integration', () => {
  beforeEach(() => {
    statusManager.updateStatus('idle');
  });

  it('should provide complete status lifecycle', () => {
    // Initial state
    let status = statusManager.getStatus();
    expect(status.status).toBe('idle');
    expect(status.message).toBeUndefined();
    expect(status.lastActivity).toBeDefined();

    // Working state
    statusManager.updateStatus('working', 'Running task');
    status = statusManager.getStatus();
    expect(status.status).toBe('working');
    expect(status.message).toBe('Running task');

    // Waiting state
    statusManager.updateStatus('waiting', 'Waiting for input');
    status = statusManager.getStatus();
    expect(status.status).toBe('waiting');
    expect(status.message).toBe('Waiting for input');

    // Back to idle
    statusManager.updateStatus('idle');
    status = statusManager.getStatus();
    expect(status.status).toBe('idle');
  });

  it('should support subscriber pattern', async () => {
    return new Promise<void>((resolve) => {
      const updates: string[] = [];

      const unsubscribe = statusManager.subscribe((status) => {
        updates.push(status.status);
        if (updates.length === 3) {
          expect(updates).toEqual(['working', 'waiting', 'idle']);
          unsubscribe();
          resolve();
        }
      });

      statusManager.updateStatus('working');
      statusManager.updateStatus('waiting');
      statusManager.updateStatus('idle');
    });
  });

  it('should broadcast to WebSocket clients', () => {
    const wsHandler = new WebSocketHandler();
    statusManager.setWebSocketHandler(wsHandler);

    const broadcastCalls: Array<[string, string | undefined, string]> = [];
    const originalBroadcast = wsHandler.broadcastStatus.bind(wsHandler);

    wsHandler.broadcastStatus = function(status: 'working' | 'waiting' | 'idle', message?: string, lastActivity?: string) {
      broadcastCalls.push([status, message, lastActivity || new Date().toISOString()]);
      return originalBroadcast(status, message, lastActivity);
    };

    statusManager.updateStatus('working', 'Task 1');
    statusManager.updateStatus('waiting', 'Input needed');
    statusManager.updateStatus('idle');

    expect(broadcastCalls).toHaveLength(3);
    expect(broadcastCalls[0][0]).toBe('working');
    expect(broadcastCalls[0][1]).toBe('Task 1');
    expect(broadcastCalls[1][0]).toBe('waiting');
    expect(broadcastCalls[1][1]).toBe('Input needed');
    expect(broadcastCalls[2][0]).toBe('idle');
  });

  it('should handle multiple simultaneous listeners', async () => {
    return new Promise<void>((resolve) => {
      const results = {
        listener1Count: 0,
        listener2Count: 0,
        listener3Count: 0,
      };

      const listener1 = () => {
        results.listener1Count++;
      };

      const listener2 = () => {
        results.listener2Count++;
      };

      const listener3 = () => {
        results.listener3Count++;
      };

      const unsub1 = statusManager.subscribe(listener1);
      const unsub2 = statusManager.subscribe(listener2);
      const unsub3 = statusManager.subscribe(listener3);

      statusManager.updateStatus('working');
      statusManager.updateStatus('waiting');

      expect(results.listener1Count).toBe(2);
      expect(results.listener2Count).toBe(2);
      expect(results.listener3Count).toBe(2);

      unsub1();
      unsub2();
      unsub3();

      resolve();
    });
  });

  it('should persist lastActivity across updates', async () => {
    statusManager.updateStatus('idle');
    const initialStatus = statusManager.getStatus();
    const initialTime = new Date(initialStatus.lastActivity);

    await new Promise(resolve => setTimeout(resolve, 5));

    statusManager.updateStatus('working', 'Task');
    const workingStatus = statusManager.getStatus();
    const workingTime = new Date(workingStatus.lastActivity);

    expect(workingTime.getTime()).toBeGreaterThanOrEqual(initialTime.getTime());
  });
});
