import { test, expect, describe, beforeEach, vi, afterEach } from 'vitest';
import { handleAPI } from '../api';
import { uiManager } from '../../services/ui-manager';

// Mock all dependencies
vi.mock('../../services/diagram-manager', () => ({}));
vi.mock('../../services/document-manager', () => ({}));
vi.mock('../../services/metadata-manager', () => ({}));
vi.mock('../../services/validator', () => ({}));
vi.mock('../../services/renderer', () => ({}));
vi.mock('../../services/question-manager', () => ({
  questionManager: {},
}));
vi.mock('../../services/smach-transpiler', () => ({
  transpile: vi.fn(),
  isSmachYaml: vi.fn(),
}));
vi.mock('../../services/session-registry', () => ({
  sessionRegistry: {
    register: vi.fn(),
    list: vi.fn(),
    unregister: vi.fn(),
    resolvePath: (project: string, session: string, type: string) => `/tmp/${project}/${session}/${type}`,
  },
}));

describe('POST /api/render-ui', () => {
  let mockDiagramManager: any;
  let mockDocumentManager: any;
  let mockMetadataManager: any;
  let mockValidator: any;
  let mockRenderer: any;
  let mockWSHandler: any;

  beforeEach(() => {
    // Reset all mocks
    mockDiagramManager = {};
    mockDocumentManager = {};
    mockMetadataManager = {};
    mockValidator = {};
    mockRenderer = {};
    mockWSHandler = {
      broadcast: vi.fn(),
    };

    // Clear any pending UIs in uiManager
    const sessionKey = 'test-project:test-session';
    uiManager.dismissUI(sessionKey);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Valid Requests', () => {
    test('should accept non-blocking render UI request and return immediately', async () => {
      const ui = {
        type: 'dialog',
        props: { title: 'Test Dialog', message: 'This is a test' },
      };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: false }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean; uiId: string };
      expect(data.success).toBe(true);
      expect(data.uiId).toBeDefined();
      expect(data.uiId).toMatch(/^ui_\d+_[a-f0-9]{6}$/);

      // Should broadcast the UI
      expect(mockWSHandler.broadcast).toHaveBeenCalledTimes(1);
      const broadcastCall = (mockWSHandler.broadcast as any).mock.calls[0];
      expect(broadcastCall[0].type).toBe('ui_render');
      expect(broadcastCall[0].blocking).toBe(false);
    });

    test('should accept blocking render UI request without timeout', async () => {
      const ui = {
        type: 'confirmation',
        props: { message: 'Do you want to proceed?' },
      };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true }),
        }
      );

      // Start the request without timeout
      const responsePromise = handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Let it start processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should broadcast the UI
      expect(mockWSHandler.broadcast).toHaveBeenCalled();

      // Don't wait for the full response (it would hang indefinitely in blocking mode)
      // Just verify the broadcast happened
    });

    test('should use default blocking=true when not specified', async () => {
      const ui = {
        type: 'alert',
        props: { message: 'Alert message' },
      };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui }),
        }
      );

      // Start the request but don't await it - blocking mode would wait forever
      const responsePromise = handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Let it start processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should broadcast the UI (blocking=true is default)
      expect(mockWSHandler.broadcast).toHaveBeenCalled();
      const broadcastCall = (mockWSHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.blocking).toBe(true);

      // Cancel the pending request by dismissing the UI
      uiManager.dismissUI('test-project:test-session');
    }, { timeout: 10000 });

    test('should handle non-blocking request without timeout', async () => {
      const ui = {
        type: 'form',
        props: { fields: [] },
      };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: false }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success?: boolean; uiId?: string };
      expect(data.success).toBe(true);
      expect(data.uiId).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should return 400 when project param is missing', async () => {
      const ui = { type: 'dialog', props: {} };

      const request = new Request(
        'http://localhost:3737/api/render-ui?session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });

    test('should return 400 when session param is missing', async () => {
      const ui = { type: 'dialog', props: {} };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });

    test('should return 400 when ui is missing from request body', async () => {
      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocking: false }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('ui required');
    });

    test('should return 400 when ui is null', async () => {
      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui: null }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('ui required');
    });

    test('should ignore timeout parameter if provided', async () => {
      const ui = { type: 'dialog', props: {} };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: false, timeout: 500 }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Should succeed even with timeout parameter (timeout is now ignored)
      expect(response.status).toBe(200);
      const data = await response.json() as { success?: boolean; uiId?: string };
      expect(data.success).toBe(true);
      expect(data.uiId).toBeDefined();
    });

    test('should return 400 when ui is not an object', async () => {
      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui: 'not-an-object' }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('ui must be an object');
    });

    test('should return 400 when ui has no type property', async () => {
      const ui = { props: { message: 'Hello' } };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui }),
        }
      );

      const response = await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('ui must have a type');
    });
  });

  describe('WebSocket Broadcasting', () => {
    test('should broadcast ui_render message with correct structure', async () => {
      const ui = {
        type: 'dialog',
        props: { title: 'Test', message: 'Test message' },
      };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: false }),
        }
      );

      await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(mockWSHandler.broadcast).toHaveBeenCalledTimes(1);
      const broadcastCall = (mockWSHandler.broadcast as any).mock.calls[0][0];

      expect(broadcastCall.type).toBe('ui_render');
      expect(broadcastCall.project).toBe('test-project');
      expect(broadcastCall.session).toBe('test-session');
      expect(broadcastCall.ui).toEqual(ui);
      expect(broadcastCall.uiId).toMatch(/^ui_\d+_[a-f0-9]{6}$/);
      expect(broadcastCall.timestamp).toBeDefined();
    });

    test('should include blocking flag in broadcast message', async () => {
      const ui = { type: 'form', props: {} };

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true }),
        }
      );

      // Start request without timeout
      const responsePromise = handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Let the request process but don't wait for it
      await new Promise(resolve => setTimeout(resolve, 50));

      const broadcastCall = (mockWSHandler.broadcast as any).mock.calls[0][0];
      expect(broadcastCall.blocking).toBe(true);

      // Clean up by dismissing the UI
      uiManager.dismissUI('test-project:test-session');
    }, { timeout: 10000 });
  });

  describe('UIManager Integration', () => {
    test('should properly store pending UI in blocking mode', async () => {
      const ui = { type: 'dialog', props: { message: 'Test' } };
      const sessionKey = 'test-project:test-session';

      const request = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true }),
        }
      );

      const responsePromise = handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Check that pending UI exists
      await new Promise(resolve => setTimeout(resolve, 10));
      const pending = uiManager.getPendingUI(sessionKey);
      expect(pending).toBeDefined();
      expect(pending?.blocking).toBe(true);

      // Clean up - dismiss the UI
      uiManager.dismissUI(sessionKey);
      await responsePromise.catch(() => {});
    });
  });
});
