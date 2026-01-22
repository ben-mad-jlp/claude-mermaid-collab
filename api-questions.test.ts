import { test, expect, describe, beforeEach, vi } from 'bun:test';
import { handleAPI } from './src/routes/api';
import { DiagramManager } from './src/services/diagram-manager';
import { DocumentManager } from './src/services/document-manager';
import { MetadataManager } from './src/services/metadata-manager';
import { Validator } from './src/services/validator';
import { Renderer } from './src/services/renderer';
import { WebSocketHandler } from './src/websocket/handler';
import { questionManager } from './src/services/question-manager';
import type { Question } from './src/services/question-manager';

// Mock all dependencies
vi.mock('./src/services/diagram-manager', () => ({}));
vi.mock('./src/services/document-manager', () => ({}));
vi.mock('./src/services/metadata-manager', () => ({}));
vi.mock('./src/services/validator', () => ({}));
vi.mock('./src/services/renderer', () => ({}));
vi.mock('./src/services/session-registry', () => ({
  sessionRegistry: {
    register: vi.fn(),
    list: vi.fn(),
    unregister: vi.fn(),
    resolvePath: (project: string, session: string, type: string) => `/tmp/${project}/${session}/${type}`,
  },
}));

describe('Question Response API Endpoints', () => {
  let mockDiagramManager: any;
  let mockDocumentManager: any;
  let mockMetadataManager: any;
  let mockValidator: any;
  let mockRenderer: any;
  let mockWSHandler: any;

  beforeEach(() => {
    // Reset question manager state
    questionManager.clearSession('test-project:test-session');

    // Setup mock implementations
    mockDiagramManager = {};
    mockDocumentManager = {};
    mockMetadataManager = {};
    mockValidator = {};
    mockRenderer = {};
    mockWSHandler = {
      broadcast: vi.fn(),
    };
  });

  describe('GET /api/question', () => {
    test('should return null when no pending question exists', async () => {
      const request = new Request(
        'http://localhost:3737/api/question?project=test-project&session=test-session',
        { method: 'GET' }
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

      const data = await response.json() as { question: Question | null };
      expect(data.question).toBeNull();
    });

    test('should return pending question when one exists', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-123',
        text: 'Do you want to continue?',
        timestamp: Date.now(),
        source: 'browser',
      };

      // Store a pending question
      questionManager.receiveQuestion(sessionKey, mockQuestion);

      const request = new Request(
        'http://localhost:3737/api/question?project=test-project&session=test-session',
        { method: 'GET' }
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

      const data = await response.json() as { question: Question | null };
      expect(data.question?.id).toBe('q-123');
    });

    test('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/question?session=test-session',
        { method: 'GET' }
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
    });
  });

  describe('POST /api/question-response', () => {
    test('should submit response to a pending question', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-123',
        text: 'Do you want to continue?',
        timestamp: Date.now(),
        source: 'browser',
      };

      // Store a pending question
      questionManager.receiveQuestion(sessionKey, mockQuestion);

      const request = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q-123', response: 'yes' }),
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
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);
    });

    test('should return 404 when no pending question exists', async () => {
      const request = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q-unknown', response: 'yes' }),
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

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/dismiss-ui', () => {
    test('should dismiss a pending question', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-123',
        text: 'Do you want to continue?',
        timestamp: Date.now(),
        source: 'browser',
      };

      questionManager.receiveQuestion(sessionKey, mockQuestion);

      const request = new Request(
        'http://localhost:3737/api/dismiss-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
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
      const data = await response.json() as { success: boolean; dismissed: boolean };
      expect(data.success).toBe(true);
      expect(data.dismissed).toBe(true);
    });

    test('should return dismissed false when no pending question exists', async () => {
      const request = new Request(
        'http://localhost:3737/api/dismiss-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
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
      const data = await response.json() as { success: boolean; dismissed: boolean };
      expect(data.success).toBe(true);
      expect(data.dismissed).toBe(false);
    });
  });

  describe('POST /api/update-ui', () => {
    test('should broadcast update event with patch', async () => {
      const updatePatch = { field: 'value', nested: { key: 'data' } };

      const request = new Request(
        'http://localhost:3737/api/update-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: updatePatch }),
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
      const data = await response.json() as { success: boolean };
      expect(data.success).toBe(true);
    });

    test('should return 400 when patch is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/update-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
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
    });
  });
});
