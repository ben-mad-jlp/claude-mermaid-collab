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

describe('POST /api/ui-response', () => {
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
    test('should accept response with source param', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: { message: 'Test' } };

      // First, set up a pending UI by calling render-ui with blocking=true
      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Let render-ui process
      await new Promise(resolve => setTimeout(resolve, 50));

      // Now send the response
      const pending = uiManager.getPendingUI(sessionKey);
      expect(pending).toBeDefined();
      const uiId = pending!.uiId;

      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'submit',
            data: { value: 'test' },
            source: 'browser',
          }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);

      // Clean up the render promise
      await renderPromise.catch(() => {});
    }, { timeout: 15000 });

    test('should accept response without source param (default to browser)', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: { message: 'Test' } };

      // First, set up a pending UI
      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      // Send response without source
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'cancel',
            data: { reason: 'user cancelled' },
          }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);

      // Clean up
      await renderPromise.catch(() => {});
    }, { timeout: 15000 });

    test('should accept response with action and data', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'form', props: {} };

      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'submit',
            data: { name: 'John', email: 'john@example.com' },
            source: 'browser',
          }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);

      // Clean up
      await renderPromise.catch(() => {});
    }, { timeout: 15000 });

    test('should accept response with only uiId (no action/data)', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'alert', props: {} };

      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiId }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);

      // Clean up
      await renderPromise.catch(() => {});
    }, { timeout: 15000 });
  });

  describe('Error Handling - Missing Params', () => {
    test('should return 400 when project param is missing', async () => {
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiId: 'ui_123_abc' }),
        }
      );

      const response = await handleAPI(
        responseRequest,
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
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiId: 'ui_123_abc' }),
        }
      );

      const response = await handleAPI(
        responseRequest,
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
  });

  describe('Error Handling - Missing Body Fields', () => {
    test('should return 400 when uiId is missing from body', async () => {
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit', data: {} }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('uiId required');
    });

    test('should return 400 when uiId is empty string', async () => {
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiId: '' }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('uiId required');
    });
  });

  describe('Stale Response Handling', () => {
    test('should return 404 when no pending UI exists', async () => {
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId: 'ui_123_abc',
            action: 'submit',
          }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(404);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('No pending UI or uiId mismatch');
    });

    test('should return 404 when uiId does not match pending UI', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: {} };

      // Set up a pending UI
      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      // Send response with wrong uiId
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId: 'ui_999_xyz', // Wrong ID
            action: 'submit',
          }),
        }
      );

      const response = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(404);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('No pending UI or uiId mismatch');

      // Clean up
      await renderPromise.catch(() => {});
    }, { timeout: 15000 });

    test('should resolve pending UI promise when response is received', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: {} };

      // Set up a pending UI
      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      // Send response
      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'submit',
            data: { result: 'success' },
          }),
        }
      );

      const responseResponse = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(responseResponse.status).toBe(200);

      // The render promise should now resolve with the data
      const renderResponse = await renderPromise;
      const renderData = await renderResponse.json() as any;
      expect(renderData.completed).toBe(true);
      expect(renderData.source).toBe('browser');
      expect(renderData.action).toBe('submit');
      expect(renderData.data).toEqual({ result: 'success' });
    }, { timeout: 15000 });
  });

  describe('Source Parameter', () => {
    test('should use provided source in response', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: {} };

      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'submit',
            source: 'terminal',
          }),
        }
      );

      const responseResponse = await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(responseResponse.status).toBe(200);

      // Verify the source in the resolved promise
      const renderResponse = await renderPromise;
      const renderData = await renderResponse.json() as any;
      expect(renderData.source).toBe('terminal');
    }, { timeout: 15000 });

    test('should default source to browser when not provided', async () => {
      const sessionKey = 'test-project:test-session';
      const ui = { type: 'dialog', props: {} };

      const renderRequest = new Request(
        'http://localhost:3737/api/render-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ui, blocking: true, timeout: 10000 }),
        }
      );

      const renderPromise = handleAPI(
        renderRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const pending = uiManager.getPendingUI(sessionKey);
      const uiId = pending!.uiId;

      const responseRequest = new Request(
        'http://localhost:3737/api/ui-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uiId,
            action: 'submit',
          }),
        }
      );

      await handleAPI(
        responseRequest,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Verify the source defaults to browser
      const renderResponse = await renderPromise;
      const renderData = await renderResponse.json() as any;
      expect(renderData.source).toBe('browser');
    }, { timeout: 15000 });
  });
});
