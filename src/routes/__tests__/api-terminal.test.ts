/**
 * Terminal API Routes Test Suite
 * Tests for /api/terminal/sessions endpoints
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleAPI } from '../api';
import type { TerminalSession, ListSessionsResult, CreateSessionResult } from '../../types/terminal';

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

// Mock MCP tools
vi.mock('../../mcp/tools/terminal-sessions', () => ({
  terminalListSessions: vi.fn(),
  terminalCreateSession: vi.fn(),
  terminalKillSession: vi.fn(),
  terminalRenameSession: vi.fn(),
  terminalReorderSessions: vi.fn(),
}));

import * as terminalTools from '../../mcp/tools/terminal-sessions';

describe('Terminal API Routes', () => {
  let mockWSHandler: any;
  const mockManagers = { diagramManager: {}, documentManager: {}, metadataManager: {} };
  const mockValidator = {};
  const mockRenderer = {};

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    mockWSHandler = {
      broadcast: vi.fn(),
      getConnectionCount: vi.fn().mockReturnValue(0),
    };
  });

  describe('GET /api/terminal/sessions', () => {
    it('should list terminal sessions', async () => {
      const sessions: TerminalSession[] = [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-test-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'mc-test-c3d4',
          created: new Date().toISOString(),
          order: 1,
        },
      ];

      const listSessionsMock = vi.spyOn(terminalTools, 'terminalListSessions').mockResolvedValue({
        sessions,
      } as ListSessionsResult);

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions?project=/test/project&session=test-session'
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as ListSessionsResult;
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].id).toBe('session-1');
      expect(data.sessions[1].id).toBe('session-2');

      expect(listSessionsMock).toHaveBeenCalledWith('/test/project', 'test-session');
    });

    it('should return empty array when no sessions exist', async () => {
      vi.spyOn(terminalTools, 'terminalListSessions').mockResolvedValue({
        sessions: [],
      } as ListSessionsResult);

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions?project=/test/project&session=test-session'
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as ListSessionsResult;
      expect(data.sessions).toEqual([]);
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request('http://localhost:3737/api/terminal/sessions?session=test-session');

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should return 400 when session param is missing', async () => {
      const request = new Request('http://localhost:3737/api/terminal/sessions?project=/test/project');

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/terminal/sessions', () => {
    it('should create a new terminal session', async () => {
      const createResult: CreateSessionResult = {
        id: 'session-1',
        tmuxSession: 'mc-test-a1b2',
        wsUrl: 'ws://localhost:7681/ws',
      };

      vi.spyOn(terminalTools, 'terminalCreateSession').mockResolvedValue(createResult);

      const request = new Request('http://localhost:3737/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({
          project: '/test/project',
          session: 'test-session',
          name: 'My Terminal',
        }),
      });

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as CreateSessionResult;
      expect(data.id).toBe('session-1');
      expect(data.tmuxSession).toBe('mc-test-a1b2');
      expect(data.wsUrl).toBe('ws://localhost:7681/ws');
    });

    it('should create session without name', async () => {
      const createResult: CreateSessionResult = {
        id: 'session-1',
        tmuxSession: 'mc-test-a1b2',
        wsUrl: 'ws://localhost:7681/ws',
      };

      const createSessionMock = vi.spyOn(terminalTools, 'terminalCreateSession').mockResolvedValue(createResult);

      const request = new Request('http://localhost:3737/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({
          project: '/test/project',
          session: 'test-session',
        }),
      });

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      expect(createSessionMock).toHaveBeenCalledWith('/test/project', 'test-session', undefined);
    });

    it('should return 400 when project is missing', async () => {
      const request = new Request('http://localhost:3737/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({
          session: 'test-session',
          name: 'My Terminal',
        }),
      });

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should return 400 when session is missing', async () => {
      const request = new Request('http://localhost:3737/api/terminal/sessions', {
        method: 'POST',
        body: JSON.stringify({
          project: '/test/project',
          name: 'My Terminal',
        }),
      });

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/terminal/sessions/:id', () => {
    it('should delete a terminal session', async () => {
      vi.spyOn(terminalTools, 'terminalKillSession').mockResolvedValue({ success: true });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?project=/test/project&session=test-session',
        { method: 'DELETE' }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?session=test-session',
        { method: 'DELETE' }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should return 400 when session param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?project=/test/project',
        { method: 'DELETE' }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /api/terminal/sessions/:id', () => {
    it('should rename a terminal session', async () => {
      vi.spyOn(terminalTools, 'terminalRenameSession').mockResolvedValue({ success: true });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?project=/test/project&session=test-session',
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed Terminal' }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?session=test-session',
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed Terminal' }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should return 400 when session param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1?project=/test/project',
        {
          method: 'PATCH',
          body: JSON.stringify({ name: 'Renamed Terminal' }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/terminal/sessions/reorder', () => {
    it('should reorder terminal sessions', async () => {
      vi.spyOn(terminalTools, 'terminalReorderSessions').mockResolvedValue({ success: true });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/reorder?project=/test/project&session=test-session',
        {
          method: 'PUT',
          body: JSON.stringify({ orderedIds: ['session-2', 'session-1', 'session-3'] }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(200);
      const data = await response.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/reorder?session=test-session',
        {
          method: 'PUT',
          body: JSON.stringify({ orderedIds: ['session-2', 'session-1'] }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });

    it('should return 400 when session param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/reorder?project=/test/project',
        {
          method: 'PUT',
          body: JSON.stringify({ orderedIds: ['session-2', 'session-1'] }),
        }
      );

      const response = await handleAPI(
        request,
        mockManagers.diagramManager,
        mockManagers.documentManager,
        mockManagers.metadataManager,
        mockValidator,
        mockRenderer,
        mockWSHandler
      );

      expect(response.status).toBe(400);
    });
  });
});
