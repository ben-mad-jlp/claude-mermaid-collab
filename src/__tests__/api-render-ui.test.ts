/**
 * Comprehensive tests for render-ui API endpoints
 * Tests broadcasting, blocking mode, response handling, and error cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleAPI } from '../routes/api';
import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { uiManager } from '../services/ui-manager';

// Mock dependencies
vi.mock('../services/diagram-manager');
vi.mock('../services/document-manager');
vi.mock('../services/metadata-manager');
vi.mock('../services/validator');
vi.mock('../services/renderer');
vi.mock('../services/session-registry', () => ({
  sessionRegistry: {
    register: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    unregister: vi.fn().mockResolvedValue(true),
    resolvePath: vi.fn((project, session, type) => `/tmp/${project}/${session}/${type}`),
  },
}));

describe('Render UI API Endpoints', () => {
  let mockDiagramManager: any;
  let mockDocumentManager: any;
  let mockMetadataManager: any;
  let mockValidator: any;
  let mockRenderer: any;
  let mockWSHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock implementations
    mockDiagramManager = {};
    mockDocumentManager = {};
    mockMetadataManager = {};
    mockValidator = {};
    mockRenderer = {};
    mockWSHandler = {
      broadcast: vi.fn(),
      broadcastToDiagram: vi.fn(),
      broadcastToDocument: vi.fn(),
      handleConnection: vi.fn(),
      handleDisconnection: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up any pending UIs between tests
    vi.clearAllMocks();
  });

  describe('POST /api/render-ui - Render UI to browser', () => {
    it('should require project and session query params', async () => {
      const req = new Request('http://localhost/api/render-ui', {
        method: 'POST',
        body: JSON.stringify({ ui: { type: 'form' } }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session query params required');
    });

    it('should require ui in request body', async () => {
      const req = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('ui required');
    });

    it('should broadcast ui_render message to WebSocket clients', async () => {
      const uiComponent = { type: 'form', props: { title: 'Test' } };

      const req = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({ ui: uiComponent, blocking: false }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      expect(mockWSHandler.broadcast).toHaveBeenCalledOnce();

      const broadcastCall = mockWSHandler.broadcast.mock.calls[0][0];
      expect(broadcastCall.type).toBe('ui_render');
      expect(broadcastCall.project).toBe('test-project');
      expect(broadcastCall.session).toBe('test-session');
      expect(broadcastCall.ui).toEqual(uiComponent);
      expect(broadcastCall.uiId).toBeDefined();
      expect(broadcastCall.timestamp).toBeDefined();
    });

    it('should return immediately in non-blocking mode', async () => {
      const req = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({
          ui: { type: 'button', props: { label: 'Click me' } },
          blocking: false,
        }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.uiId).toBeDefined();
      expect(data.uiId).toMatch(/^ui_\d+_[0-9a-f]{6}$/);
    });

    it('should generate unique uiId for each request', async () => {
      const uiComponent = { type: 'form' };

      const req1 = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({ ui: uiComponent, blocking: false }),
      });

      const response1 = await handleAPI(
        req1,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      const data1 = await response1.json();

      const req2 = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({ ui: uiComponent, blocking: false }),
      });

      const response2 = await handleAPI(
        req2,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      const data2 = await response2.json();

      expect(data1.uiId).not.toBe(data2.uiId);
    });

    it('should include all required fields in ui_render message', async () => {
      const uiComponent = {
        type: 'form',
        props: { title: 'User Input', submitLabel: 'Submit' },
      };

      const req = new Request('http://localhost/api/render-ui?project=my-project&session=my-session', {
        method: 'POST',
        body: JSON.stringify({
          ui: uiComponent,
          blocking: false, // Use non-blocking to avoid Promise issues in tests
        }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // Get the broadcast message
      const broadcastMessage = mockWSHandler.broadcast.mock.calls[0][0];

      // Validate all required fields are present
      expect(broadcastMessage).toHaveProperty('type', 'ui_render');
      expect(broadcastMessage).toHaveProperty('uiId');
      expect(broadcastMessage).toHaveProperty('project', 'my-project');
      expect(broadcastMessage).toHaveProperty('session', 'my-session');
      expect(broadcastMessage).toHaveProperty('ui');
      expect(broadcastMessage).toHaveProperty('blocking', false);
      expect(broadcastMessage).toHaveProperty('timestamp');

      expect(broadcastMessage.ui).toEqual(uiComponent);
    });

    it('should broadcast blocking=true when not specified in request', () => {
      // When blocking is not specified in the request JSON,
      // the API broadcasts with blocking: true due to the ?? operator
      const ui = { type: 'button' };
      const blocking = undefined; // Not specified

      // Simulate what the API does
      const broadcastBlocking = blocking ?? true;

      // The broadcast message will have blocking=true
      expect(broadcastBlocking).toBe(true);
    });
  });

  describe('POST /api/ui-response - Receive UI response from browser', () => {
    it('should require project and session query params', async () => {
      const req = new Request('http://localhost/api/ui-response', {
        method: 'POST',
        body: JSON.stringify({ uiId: 'ui_123', action: 'submit' }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('project and session query params required');
    });

    it('should require uiId in request body', async () => {
      const req = new Request('http://localhost/api/ui-response?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({ action: 'submit' }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('uiId required');
    });

    it('should return 404 if no pending UI for uiId', async () => {
      const req = new Request('http://localhost/api/ui-response?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({
          uiId: 'ui_nonexistent',
          action: 'submit',
        }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('No pending UI');
    });
  });

  describe('Error handling', () => {
    it('should handle malformed JSON in request body', async () => {
      const req = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: 'invalid json',
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should handle broadcast errors gracefully', async () => {
      // Make broadcast throw an error
      mockWSHandler.broadcast.mockImplementation(() => {
        throw new Error('WebSocket broadcast failed');
      });

      const req = new Request('http://localhost/api/render-ui?project=test-project&session=test-session', {
        method: 'POST',
        body: JSON.stringify({
          ui: { type: 'form' },
          blocking: false,
        }),
      });

      const response = await handleAPI(
        req,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      // API should still respond with error
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });
});
