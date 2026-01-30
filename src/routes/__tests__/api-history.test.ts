/**
 * API Document History Endpoints Test Suite
 * Tests for /api/document/:id/history and /api/document/:id/version endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleAPI } from '../api';
import { Validator } from '../../services/validator';
import { Renderer } from '../../services/renderer';
import { WebSocketHandler } from '../../websocket/handler';
import { sessionRegistry } from '../../services/session-registry';
import { UpdateLogManager } from '../../services/update-log-manager';

describe('API Document History Endpoints', () => {
  let testProjectPath: string;
  let testSession: string;
  let testSessionPath: string;
  let mockValidator: Validator;
  let mockRenderer: Renderer;
  let mockWSHandler: WebSocketHandler;

  beforeEach(async () => {
    // Create a unique test project path
    testProjectPath = join(tmpdir(), `test-history-${Date.now()}`);
    testSession = 'test-session';
    testSessionPath = join(testProjectPath, '.collab', 'sessions', testSession);

    // Create session directory structure
    await mkdir(testSessionPath, { recursive: true });
    await mkdir(join(testSessionPath, 'documents'), { recursive: true });

    // Register the session
    await sessionRegistry.register(testProjectPath, testSession);

    // Mock dependencies
    mockValidator = {} as Validator;
    mockRenderer = {} as Renderer;
    mockWSHandler = {
      broadcast: vi.fn(),
    } as any;
  });

  afterEach(async () => {
    // Clean up test files
    if (fs.existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('GET /api/document/:id/history', () => {
    it('should return 400 if project param is missing', async () => {
      const req = new Request(
        `http://localhost/api/document/test-doc/history?session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session');
    });

    it('should return 400 if session param is missing', async () => {
      const req = new Request(
        `http://localhost/api/document/test-doc/history?project=${encodeURIComponent(testProjectPath)}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session');
    });

    it('should return empty history if document has no history', async () => {
      const req = new Request(
        `http://localhost/api/document/nonexistent-doc/history?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.original).toBeNull();
      expect(data.changes).toEqual([]);
    });

    it('should return history with original content and changes', async () => {
      // Create update log with history
      const updateLogManager = new UpdateLogManager(testSessionPath);
      await updateLogManager.logUpdate('documents', 'test-doc', 'original content', 'updated content');
      await updateLogManager.logUpdate('documents', 'test-doc', 'updated content', 'final content', {
        oldString: 'updated',
        newString: 'final',
      });

      const req = new Request(
        `http://localhost/api/document/test-doc/history?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.original).toBe('original content');
      expect(data.changes).toHaveLength(2);
      expect(data.changes[0].diff).toBeDefined();
      expect(data.changes[0].timestamp).toBeDefined();
    });

    it('should return correct structure for history response', async () => {
      // Create update log with a single change
      const updateLogManager = new UpdateLogManager(testSessionPath);
      await updateLogManager.logUpdate('documents', 'doc-123', 'Hello world', 'Hello there');

      const req = new Request(
        `http://localhost/api/document/doc-123/history?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify response structure
      expect(data).toHaveProperty('original');
      expect(data).toHaveProperty('changes');
      expect(Array.isArray(data.changes)).toBe(true);

      // Verify change entry structure
      const change = data.changes[0];
      expect(change).toHaveProperty('timestamp');
      expect(change).toHaveProperty('diff');
      expect(change.diff).toHaveProperty('oldString');
      expect(change.diff).toHaveProperty('newString');
    });
  });

  describe('GET /api/document/:id/version', () => {
    it('should return 400 if project param is missing', async () => {
      const req = new Request(
        `http://localhost/api/document/test-doc/version?session=${testSession}&timestamp=2024-01-01T00:00:00.000Z`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session');
    });

    it('should return 400 if session param is missing', async () => {
      const req = new Request(
        `http://localhost/api/document/test-doc/version?project=${encodeURIComponent(testProjectPath)}&timestamp=2024-01-01T00:00:00.000Z`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session');
    });

    it('should return 400 if timestamp param is missing', async () => {
      const req = new Request(
        `http://localhost/api/document/test-doc/version?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('timestamp');
    });

    it('should return 404 if document has no history', async () => {
      const req = new Request(
        `http://localhost/api/document/nonexistent-doc/version?project=${encodeURIComponent(testProjectPath)}&session=${testSession}&timestamp=2024-01-01T00:00:00.000Z`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should return document content at a specific timestamp', async () => {
      // Create update log with time-based changes
      const updateLogManager = new UpdateLogManager(testSessionPath);

      // First update
      await updateLogManager.logUpdate('documents', 'test-doc', 'original content', 'updated content');

      // Get the timestamp of the first change
      const history = await updateLogManager.getHistory('documents', 'test-doc');
      const firstChangeTimestamp = history!.changes[0].timestamp;

      // Wait a bit and make another change
      await new Promise(resolve => setTimeout(resolve, 50));
      await updateLogManager.logUpdate('documents', 'test-doc', 'updated content', 'final content');

      // Request version at the first change timestamp
      const req = new Request(
        `http://localhost/api/document/test-doc/version?project=${encodeURIComponent(testProjectPath)}&session=${testSession}&timestamp=${encodeURIComponent(firstChangeTimestamp)}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe('updated content');
      expect(data.timestamp).toBe(firstChangeTimestamp);
    });

    it('should return original content if timestamp is before first change', async () => {
      // Create update log with history
      const updateLogManager = new UpdateLogManager(testSessionPath);

      // Wait a bit before making changes
      const beforeTimestamp = new Date(Date.now() - 1000).toISOString();
      await new Promise(resolve => setTimeout(resolve, 50));

      await updateLogManager.logUpdate('documents', 'test-doc', 'original content', 'updated content');

      // Request version before any changes
      const req = new Request(
        `http://localhost/api/document/test-doc/version?project=${encodeURIComponent(testProjectPath)}&session=${testSession}&timestamp=${encodeURIComponent(beforeTimestamp)}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe('original content');
      expect(data.timestamp).toBe(beforeTimestamp);
    });

    it('should return correct structure for version response', async () => {
      // Create update log with history
      const updateLogManager = new UpdateLogManager(testSessionPath);
      await updateLogManager.logUpdate('documents', 'test-doc', 'original content', 'updated content');

      const history = await updateLogManager.getHistory('documents', 'test-doc');
      const timestamp = history!.changes[0].timestamp;

      const req = new Request(
        `http://localhost/api/document/test-doc/version?project=${encodeURIComponent(testProjectPath)}&session=${testSession}&timestamp=${encodeURIComponent(timestamp)}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify response structure
      expect(data).toHaveProperty('content');
      expect(data).toHaveProperty('timestamp');
      expect(typeof data.content).toBe('string');
      expect(typeof data.timestamp).toBe('string');
    });
  });

  describe('Route matching', () => {
    it('should not conflict with GET /api/document/:id route', async () => {
      // The /history route should not match the plain document GET
      // This test ensures our regex doesn't accidentally match wrong routes
      const req = new Request(
        `http://localhost/api/document/test-doc?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      // Should return 404 (document not found) not 400 (bad params for history route)
      expect(response.status).toBe(404);
    });

    it('should not conflict with GET /api/document/:id/clean route', async () => {
      // The /history and /version routes should not match /clean
      const req = new Request(
        `http://localhost/api/document/test-doc/clean?project=${encodeURIComponent(testProjectPath)}&session=${testSession}`,
        { method: 'GET' }
      );
      const response = await handleAPI(
        req, {} as any, {} as any, {} as any,
        mockValidator, mockRenderer, mockWSHandler
      );

      // Should return 404 (document not found) not 400/404 from history routes
      expect(response.status).toBe(404);
    });
  });
});
