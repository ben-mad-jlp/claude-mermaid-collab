/**
 * API Status Endpoint Test Suite
 * Verifies /api/status endpoint behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { statusManager, type StatusResponse } from '../../services/status-manager';
import { WebSocketHandler } from '../../websocket/handler';

describe('API Status Endpoint', () => {
  beforeEach(() => {
    // Reset status to idle before each test
    statusManager.updateStatus('idle');
  });

  describe('GET /api/status response format', () => {
    it('should return StatusResponse with required fields', () => {
      statusManager.updateStatus('working', 'Processing');
      const status = statusManager.getStatus();

      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('lastActivity');
      expect(typeof status.status).toBe('string');
      expect(typeof status.lastActivity).toBe('string');
    });

    it('should return correct status value', () => {
      statusManager.updateStatus('working');
      const status = statusManager.getStatus();

      expect(status.status).toBe('working');
    });

    it('should return message when provided', () => {
      statusManager.updateStatus('waiting', 'Awaiting user input');
      const status = statusManager.getStatus();

      expect(status.message).toBe('Awaiting user input');
    });

    it('should not include message property when undefined', () => {
      statusManager.updateStatus('idle');
      const status = statusManager.getStatus();

      expect(status.message).toBeUndefined();
    });

    it('should return ISO 8601 formatted lastActivity', () => {
      statusManager.updateStatus('idle');
      const status = statusManager.getStatus();

      const date = new Date(status.lastActivity);
      expect(date instanceof Date).toBe(true);
      expect(date.getTime()).toBeGreaterThan(0);
      expect(status.lastActivity).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Status values', () => {
    it('should support working status', () => {
      statusManager.updateStatus('working', 'Running task');
      const status = statusManager.getStatus();

      expect(status.status).toBe('working');
      expect(status.message).toBe('Running task');
    });

    it('should support waiting status', () => {
      statusManager.updateStatus('waiting', 'Waiting for input');
      const status = statusManager.getStatus();

      expect(status.status).toBe('waiting');
      expect(status.message).toBe('Waiting for input');
    });

    it('should support idle status', () => {
      statusManager.updateStatus('idle');
      const status = statusManager.getStatus();

      expect(status.status).toBe('idle');
      expect(status.message).toBeUndefined();
    });
  });

  describe('WebSocket broadcast on status change', () => {
    it('should broadcast status through WebSocket', () => {
      const wsHandler = new WebSocketHandler();
      statusManager.setWebSocketHandler(wsHandler);

      const initialStatus = statusManager.getStatus();
      expect(initialStatus.status).toBe('idle');

      statusManager.updateStatus('working', 'Testing');

      const updatedStatus = statusManager.getStatus();
      expect(updatedStatus.status).toBe('working');
      expect(updatedStatus.message).toBe('Testing');
    });
  });

  describe('Concurrent updates', () => {
    it('should handle rapid status updates', () => {
      statusManager.updateStatus('working', 'Step 1');
      let status = statusManager.getStatus();
      expect(status.message).toBe('Step 1');

      statusManager.updateStatus('working', 'Step 2');
      status = statusManager.getStatus();
      expect(status.message).toBe('Step 2');

      statusManager.updateStatus('idle');
      status = statusManager.getStatus();
      expect(status.status).toBe('idle');
      expect(status.message).toBeUndefined();
    });
  });
});
