/**
 * Terminal API Routes Test Suite
 * Tests for /api/terminal/sessions endpoints (PTY-based)
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

// Mock terminal manager (for session persistence)
const mockTerminalManager = {
  readSessions: vi.fn(),
  writeSessions: vi.fn(),
  generateTmuxSessionName: vi.fn(),
};
vi.mock('../../services/terminal-manager', () => ({
  terminalManager: mockTerminalManager,
}));

// Mock PTY manager (for PTY operations)
const mockPtyManager = {
  create: vi.fn(),
  has: vi.fn(),
  kill: vi.fn(),
};
vi.mock('../../terminal/index', () => ({
  ptyManager: mockPtyManager,
}));

// Mock crypto for UUID generation
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-1234'),
}));

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

    // Default mock implementations
    mockTerminalManager.readSessions.mockResolvedValue({ sessions: [], lastModified: '' });
    mockTerminalManager.writeSessions.mockResolvedValue(undefined);
    mockPtyManager.create.mockResolvedValue({
      id: 'mock-uuid-1234',
      shell: '/bin/zsh',
      cwd: '/test/project',
      createdAt: new Date(),
      lastActivity: new Date(),
      connectedClients: 0,
    });
    mockPtyManager.has.mockReturnValue(false);
  });

  describe('GET /api/terminal/sessions', () => {
    it('should list terminal sessions', async () => {
      const sessions: TerminalSession[] = [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'session-1',
          created: new Date().toISOString(),
          order: 0,
        },
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'session-2',
          created: new Date().toISOString(),
          order: 1,
        },
      ];

      mockTerminalManager.readSessions.mockResolvedValue({
        sessions,
        lastModified: new Date().toISOString(),
      });
      mockPtyManager.has.mockReturnValue(true);

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
      const data = await response.json() as any;
      expect(data.sessions).toHaveLength(2);
      expect(data.sessions[0].id).toBe('session-1');
      expect(data.sessions[0].alive).toBe(true);
      expect(data.sessions[1].id).toBe('session-2');
    });

    it('should return empty array when no sessions exist', async () => {
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [],
        lastModified: new Date().toISOString(),
      });

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
      const data = await response.json() as any;
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
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [],
        lastModified: new Date().toISOString(),
      });

      const request = new Request('http://localhost:3737/api/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      expect(response.status).toBe(201);
      const data = await response.json() as CreateSessionResult;
      expect(data.id).toBe('mock-uuid-1234');
      expect(data.wsUrl).toContain('/terminal/mock-uuid-1234');
      expect(mockPtyManager.create).toHaveBeenCalledWith('mock-uuid-1234', { cwd: '/test/project' });
    });

    it('should create session without name', async () => {
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [],
        lastModified: new Date().toISOString(),
      });

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

      expect(response.status).toBe(201);

      // Should use default name "Terminal 1"
      expect(mockTerminalManager.writeSessions).toHaveBeenCalledWith(
        '/test/project',
        'test-session',
        expect.objectContaining({
          sessions: expect.arrayContaining([
            expect.objectContaining({ name: 'Terminal 1' }),
          ]),
        })
      );
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
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [
          { id: 'session-1', name: 'Terminal 1', tmuxSession: 'session-1', created: '', order: 0 },
        ],
        lastModified: '',
      });

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

      expect(response.status).toBe(204);
      expect(mockPtyManager.kill).toHaveBeenCalledWith('session-1');
    });

    it('should return 404 when session not found', async () => {
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [],
        lastModified: '',
      });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/nonexistent?project=/test/project&session=test-session',
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

      expect(response.status).toBe(404);
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

  describe('POST /api/terminal/sessions/:id/rename', () => {
    it('should rename a terminal session', async () => {
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [
          { id: 'session-1', name: 'Terminal 1', tmuxSession: 'session-1', created: '', order: 0 },
        ],
        lastModified: '',
      });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1/rename?project=/test/project&session=test-session',
        {
          method: 'POST',
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

    it('should return 404 when session not found', async () => {
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [],
        lastModified: '',
      });

      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/nonexistent/rename?project=/test/project&session=test-session',
        {
          method: 'POST',
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

      expect(response.status).toBe(404);
    });

    it('should return 400 when project param is missing', async () => {
      const request = new Request(
        'http://localhost:3737/api/terminal/sessions/session-1/rename?session=test-session',
        {
          method: 'POST',
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
        'http://localhost:3737/api/terminal/sessions/session-1/rename?project=/test/project',
        {
          method: 'POST',
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
      mockTerminalManager.readSessions.mockResolvedValue({
        sessions: [
          { id: 'session-1', name: 'Terminal 1', tmuxSession: 'session-1', created: '', order: 0 },
          { id: 'session-2', name: 'Terminal 2', tmuxSession: 'session-2', created: '', order: 1 },
          { id: 'session-3', name: 'Terminal 3', tmuxSession: 'session-3', created: '', order: 2 },
        ],
        lastModified: '',
      });

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
