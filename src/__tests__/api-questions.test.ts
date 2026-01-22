/**
 * Comprehensive tests for question response API endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAPI } from '../routes/api';
import { DiagramManager } from '../services/diagram-manager';
import { DocumentManager } from '../services/document-manager';
import { MetadataManager } from '../services/metadata-manager';
import { Validator } from '../services/validator';
import { Renderer } from '../services/renderer';
import { WebSocketHandler } from '../websocket/handler';
import { questionManager } from '../services/question-manager';
import type { Question } from '../services/question-manager';

// Mock dependencies
vi.mock('../services/diagram-manager');
vi.mock('../services/document-manager');
vi.mock('../services/metadata-manager');
vi.mock('../services/validator');
vi.mock('../services/renderer');
vi.mock('../services/session-registry', () => ({
  sessionRegistry: {
    register: vi.fn(),
    list: vi.fn(),
    unregister: vi.fn(),
    resolvePath: vi.fn((project, session, type) => `/tmp/${project}/${session}/${type}`),
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
    vi.clearAllMocks();

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

    // Mock constructors to return mock instances
    vi.mocked(DiagramManager).mockImplementation(() => mockDiagramManager);
    vi.mocked(DocumentManager).mockImplementation(() => mockDocumentManager);
    vi.mocked(MetadataManager).mockImplementation(() => mockMetadataManager);
    vi.mocked(Validator).mockImplementation(() => mockValidator);
    vi.mocked(Renderer).mockImplementation(() => mockRenderer);
  });

  describe('GET /api/question', () => {
    it('should return null when no pending question exists', async () => {
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

    it('should return pending question when one exists', async () => {
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
      expect(data.question).toEqual(mockQuestion);
    });

    it('should return 400 when project param is missing', async () => {
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });

    it('should return 400 when session param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/question?project=test-project',
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });
  });

  describe('POST /api/question-response', () => {
    it('should submit response to a pending question', async () => {
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

      // Verify WebSocket broadcast was called
      expect(mockWSHandler.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'question_responded',
          questionId: 'q-123',
          response: 'yes',
          project: 'test-project',
          session: 'test-session',
        })
      );
    });

    it('should return 404 when no pending question exists', async () => {
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('No pending question found');
    });

    it('should return 404 when question ID does not match', async () => {
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
          body: JSON.stringify({ questionId: 'q-wrong-id', response: 'yes' }),
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('No pending question found');
    });

    it('should return 400 when questionId is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: 'yes' }),
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
      expect(data.error).toContain('questionId and response required');
    });

    it('should return 400 when response is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q-123' }),
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
      expect(data.error).toContain('questionId and response required');
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/question-response?session=test-session',
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

      expect(response.status).toBe(400);
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });

    it('should handle empty string response', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-123',
        text: 'Question?',
        timestamp: Date.now(),
      };

      questionManager.receiveQuestion(sessionKey, mockQuestion);

      const request = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q-123', response: '' }),
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
  });

  describe('POST /api/dismiss-ui', () => {
    it('should dismiss a pending question', async () => {
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

      // Verify WebSocket broadcast was called
      expect(mockWSHandler.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ui_dismissed',
          project: 'test-project',
          session: 'test-session',
        })
      );

      // Verify question was removed
      const question = questionManager.getQuestion(sessionKey);
      expect(question).toBeNull();
    });

    it('should return dismissed false when no pending question exists', async () => {
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

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/dismiss-ui?session=test-session',
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('project and session query params required');
    });

    it('should broadcast dismiss event to all connected clients', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-123',
        text: 'Question?',
        timestamp: Date.now(),
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

      await handleAPI(
        request,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(mockWSHandler.broadcast).toHaveBeenCalled();
      const broadcastCall = mockWSHandler.broadcast.mock.calls[0][0];
      expect(broadcastCall.type).toBe('ui_dismissed');
      expect(broadcastCall.project).toBe('test-project');
      expect(broadcastCall.session).toBe('test-session');
    });
  });

  describe('POST /api/update-ui', () => {
    it('should broadcast update event with patch', async () => {
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

      // Verify WebSocket broadcast was called
      expect(mockWSHandler.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ui_updated',
          patch: updatePatch,
          project: 'test-project',
          session: 'test-session',
        })
      );
    });

    it('should return 400 when patch is missing', async () => {
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
      const data = await response.json() as { error: string };
      expect(data.error).toContain('patch required');
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/update-ui?session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: { test: true } }),
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

    it('should return 400 when session param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/update-ui?project=test-project',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: { test: true } }),
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

    it('should handle complex nested patch objects', async () => {
      const complexPatch = {
        type: 'update',
        changes: {
          diagrams: [
            { id: 'diag-1', changes: { name: 'New Name' } },
            { id: 'diag-2', changes: { content: 'new content' } },
          ],
        },
      };

      const request = new Request(
        'http://localhost:3737/api/update-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: complexPatch }),
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

      expect(mockWSHandler.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ui_updated',
          patch: complexPatch,
          project: 'test-project',
          session: 'test-session',
        })
      );
    });

    it('should handle empty patch object', async () => {
      const request = new Request(
        'http://localhost:3737/api/update-ui?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: {} }),
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
  });

  describe('Integration Tests', () => {
    it('should handle multiple sessions independently', async () => {
      const sessionKey1 = 'test-project:session1';
      const sessionKey2 = 'test-project:session2';

      const question1: Question = {
        id: 'q-1',
        text: 'Question for session 1?',
        timestamp: Date.now(),
      };

      const question2: Question = {
        id: 'q-2',
        text: 'Question for session 2?',
        timestamp: Date.now(),
      };

      questionManager.receiveQuestion(sessionKey1, question1);
      questionManager.receiveQuestion(sessionKey2, question2);

      // Get question from session 1
      const req1 = new Request(
        'http://localhost:3737/api/question?project=test-project&session=session1',
        { method: 'GET' }
      );

      const resp1 = await handleAPI(
        req1,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      const data1 = await resp1.json() as { question: Question | null };
      expect(data1.question?.id).toBe('q-1');

      // Get question from session 2
      const req2 = new Request(
        'http://localhost:3737/api/question?project=test-project&session=session2',
        { method: 'GET' }
      );

      const resp2 = await handleAPI(
        req2,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      const data2 = await resp2.json() as { question: Question | null };
      expect(data2.question?.id).toBe('q-2');
    });

    it('should handle question lifecycle: create, respond, clear', async () => {
      const sessionKey = 'test-project:test-session';
      const mockQuestion: Question = {
        id: 'q-lifecycle',
        text: 'Lifecycle test?',
        timestamp: Date.now(),
      };

      // 1. Create question
      questionManager.receiveQuestion(sessionKey, mockQuestion);
      let question = questionManager.getQuestion(sessionKey);
      expect(question).not.toBeNull();

      // 2. Respond to question
      const respondReq = new Request(
        'http://localhost:3737/api/question-response?project=test-project&session=test-session',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: 'q-lifecycle', response: 'yes' }),
        }
      );

      const respondResp = await handleAPI(
        respondReq,
        mockDiagramManager,
        mockDocumentManager,
        mockMetadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(respondResp.status).toBe(200);

      // 3. Question should be cleared from pending
      question = questionManager.getQuestion(sessionKey);
      expect(question).toBeNull();

      // 4. Verify another question can be asked
      const newQuestion: Question = {
        id: 'q-new',
        text: 'Another question?',
        timestamp: Date.now(),
      };
      questionManager.receiveQuestion(sessionKey, newQuestion);
      question = questionManager.getQuestion(sessionKey);
      expect(question?.id).toBe('q-new');
    });
  });
});
