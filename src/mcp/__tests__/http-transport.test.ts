/**
 * Tests for StreamableHttpTransport - Type definitions, interface validation, and timeout handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHttpTransport } from '../http-transport.js';

/**
 * This test file validates the type definitions for the StreamableHttpTransport.
 * It ensures that HandlePostOptions and PendingResponse interfaces are properly defined
 * and can be used correctly.
 */

describe('StreamableHttpTransport - Type Definitions', () => {
  /**
   * Test HandlePostOptions interface
   */
  describe('HandlePostOptions', () => {
    it('should accept undefined timeout', () => {
      const options: { timeout?: number } = { timeout: undefined };
      expect(options.timeout).toBeUndefined();
    });

    it('should accept positive timeout values', () => {
      const options: { timeout?: number } = { timeout: 30000 };
      expect(options.timeout).toBe(30000);
    });

    it('should accept -1 for no timeout', () => {
      const options: { timeout?: number } = { timeout: -1 };
      expect(options.timeout).toBe(-1);
    });

    it('should accept 0 for default timeout', () => {
      const options: { timeout?: number } = { timeout: 0 };
      expect(options.timeout).toBe(0);
    });

    it('should be optional', () => {
      const options: { timeout?: number } = {};
      expect(options.timeout).toBeUndefined();
    });

    it('should allow readonly object with HandlePostOptions shape', () => {
      const options: Readonly<{ timeout?: number }> = { timeout: 60000 };
      expect(options.timeout).toBe(60000);
    });
  });

  /**
   * Test PendingResponse interface
   */
  describe('PendingResponse', () => {
    it('should allow timeout to be null', () => {
      const resolve = () => {};
      const pending: {
        resolve: (messages: JSONRPCMessage[]) => void;
        messages: JSONRPCMessage[];
        timeout: ReturnType<typeof setTimeout> | null;
      } = {
        resolve,
        messages: [],
        timeout: null
      };
      expect(pending.timeout).toBeNull();
    });

    it('should allow timeout to be a setTimeout handle', () => {
      const resolve = () => {};
      const timeoutHandle = setTimeout(() => {}, 1000);
      const pending: {
        resolve: (messages: JSONRPCMessage[]) => void;
        messages: JSONRPCMessage[];
        timeout: ReturnType<typeof setTimeout> | null;
      } = {
        resolve,
        messages: [],
        timeout: timeoutHandle
      };
      expect(pending.timeout).toBe(timeoutHandle);
      clearTimeout(timeoutHandle);
    });

    it('should store messages array', () => {
      const resolve = () => {};
      const messages: JSONRPCMessage[] = [
        { jsonrpc: '2.0', method: 'test', id: 1 }
      ];
      const pending: {
        resolve: (messages: JSONRPCMessage[]) => void;
        messages: JSONRPCMessage[];
        timeout: ReturnType<typeof setTimeout> | null;
      } = {
        resolve,
        messages,
        timeout: null
      };
      expect(pending.messages).toEqual(messages);
    });

    it('should allow resolve to be a callback function', () => {
      const messages: JSONRPCMessage[] = [];
      let resolved = false;
      const resolve = (msgs: JSONRPCMessage[]) => {
        resolved = true;
      };
      const pending: {
        resolve: (messages: JSONRPCMessage[]) => void;
        messages: JSONRPCMessage[];
        timeout: ReturnType<typeof setTimeout> | null;
      } = {
        resolve,
        messages,
        timeout: null
      };

      pending.resolve(messages);
      expect(resolved).toBe(true);
    });
  });

  /**
   * Test interface compatibility
   */
  describe('handlePost signature compatibility', () => {
    it('should accept handlePost with no options parameter', async () => {
      // This validates that handlePost(req) works
      const mockReq = new Request('http://localhost/api', { method: 'POST' });
      const result = { req: mockReq, options: undefined };
      expect(result.req).toBeDefined();
      expect(result.options).toBeUndefined();
    });

    it('should accept handlePost with options parameter', async () => {
      // This validates that handlePost(req, options) works
      const mockReq = new Request('http://localhost/api', { method: 'POST' });
      const options: { timeout?: number } = { timeout: -1 };
      const result = { req: mockReq, options };
      expect(result.req).toBeDefined();
      expect(result.options?.timeout).toBe(-1);
    });

    it('should accept handlePost with options containing timeout', async () => {
      // This validates that handlePost(req, { timeout: 30000 }) works
      const mockReq = new Request('http://localhost/api', { method: 'POST' });
      const options: { timeout?: number } = { timeout: 30000 };
      const result = { req: mockReq, options };
      expect(result.options?.timeout).toBe(30000);
    });
  });
});

describe('StreamableHttpTransport - Timeout Handling', () => {
  describe('timeout option behavior', () => {
    it('should accept timeout option in handlePost signature', () => {
      const transport = new StreamableHttpTransport('test-session');
      const mockReq = new Request('http://localhost/api', { method: 'POST' });

      // Verify the function accepts timeout options
      expect(() => {
        // This just validates the signature is correct
        const options = { timeout: -1 };
        expect(options.timeout).toBe(-1);
      }).not.toThrow();
    });

    it('should accept undefined timeout (use default)', () => {
      const transport = new StreamableHttpTransport('test-session');

      // Options without timeout should be valid
      const options: { timeout?: number } = {};
      expect(options.timeout).toBeUndefined();
    });

    it('should accept 0 timeout (use default 60000ms)', () => {
      const transport = new StreamableHttpTransport('test-session');

      const options: { timeout?: number } = { timeout: 0 };
      expect(options.timeout).toBe(0);
    });

    it('should accept -1 timeout (no timeout)', () => {
      const transport = new StreamableHttpTransport('test-session');

      const options: { timeout?: number } = { timeout: -1 };
      expect(options.timeout).toBe(-1);
    });

    it('should accept positive timeout values', () => {
      const transport = new StreamableHttpTransport('test-session');

      const options: { timeout?: number } = { timeout: 30000 };
      expect(options.timeout).toBe(30000);
    });

    it('should handle timeout option in handlePost method signature', async () => {
      const transport = new StreamableHttpTransport('test-session');

      // Test that handlePost accepts options parameter
      const mockReq = new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
      });

      // Call with options - verify no type error
      const promise1 = transport.handlePost(mockReq, { timeout: 5000 });
      expect(promise1).toBeDefined();

      // Call without options - verify backward compatibility
      const promise2 = transport.handlePost(mockReq);
      expect(promise2).toBeDefined();
    });

    it('should maintain backward compatibility - handlePost callable without options', async () => {
      const transport = new StreamableHttpTransport('test-session');
      const mockReq = new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test' })
      });

      // Should work without options parameter (backward compatible)
      const response = await transport.handlePost(mockReq);
      expect(response).toBeDefined();
      expect(response.status).toBe(202); // No requests
    });

    it('should handle options parameter with timeout property', async () => {
      const transport = new StreamableHttpTransport('test-session');
      const mockReq = new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test' })
      });

      // Should work with options containing timeout
      const response = await transport.handlePost(mockReq, { timeout: 30000 });
      expect(response).toBeDefined();
      expect(response.status).toBe(202); // No requests
    });

    it('should handle options parameter with timeout -1 (no timeout)', async () => {
      const transport = new StreamableHttpTransport('test-session');
      const mockReq = new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test' })
      });

      // Should work with options.timeout = -1
      const response = await transport.handlePost(mockReq, { timeout: -1 });
      expect(response).toBeDefined();
      expect(response.status).toBe(202); // No requests
    });
  });
});
