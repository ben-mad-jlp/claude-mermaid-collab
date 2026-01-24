/**
 * Tests for terminal sessions MCP tools
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  terminalCreateSession,
  terminalListSessions,
  terminalKillSession,
  terminalRenameSession,
  terminalReorderSessions,
  terminalToolSchemas,
} from '../terminal-sessions';
import { terminalManager } from '../../../services/terminal-manager.js';
import type { TerminalSession, TerminalSessionsState } from '../../../types/terminal.js';

// Mock the terminalManager
vi.mock('../../../services/terminal-manager.js', () => ({
  terminalManager: {
    readSessions: vi.fn(),
    writeSessions: vi.fn(),
    generateTmuxSessionName: vi.fn(),
    createTmuxSession: vi.fn(),
    killTmuxSession: vi.fn(),
  },
}));

describe('terminalCreateSession', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'open-bold-meadow';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new terminal session with auto-generated name', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };
    const mockTmuxSession = 'mc-openboldmeadow-a1b2';

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.generateTmuxSessionName).mockReturnValueOnce(mockTmuxSession);
    vi.mocked(terminalManager.createTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalCreateSession(mockProject, mockSession);

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('tmuxSession', mockTmuxSession);
    expect(result).toHaveProperty('wsUrl', 'ws://localhost:7681/ws');

    expect(terminalManager.readSessions).toHaveBeenCalledWith(mockProject, mockSession);
    expect(terminalManager.generateTmuxSessionName).toHaveBeenCalledWith(mockSession);
    expect(terminalManager.createTmuxSession).toHaveBeenCalledWith(mockTmuxSession);
    expect(terminalManager.writeSessions).toHaveBeenCalled();
  });

  it('should create a new terminal session with custom name', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };
    const mockTmuxSession = 'mc-openboldmeadow-x9y8';
    const customName = 'My Terminal';

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.generateTmuxSessionName).mockReturnValueOnce(mockTmuxSession);
    vi.mocked(terminalManager.createTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalCreateSession(mockProject, mockSession, customName);

    expect(result).toHaveProperty('id');
    expect(terminalManager.writeSessions).toHaveBeenCalled();

    // Verify the written state has the custom name
    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[0].name).toBe(customName);
  });

  it('should generate Terminal N name when no name provided', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };
    const mockTmuxSession = 'mc-openboldmeadow-c3d4';

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.generateTmuxSessionName).mockReturnValueOnce(mockTmuxSession);
    vi.mocked(terminalManager.createTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalCreateSession(mockProject, mockSession);

    expect(result).toHaveProperty('id');

    // Verify the name is "Terminal 2"
    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[1].name).toBe('Terminal 2');
  });

  it('should add session with correct order', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };
    const mockTmuxSession = 'mc-openboldmeadow-c3d4';

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.generateTmuxSessionName).mockReturnValueOnce(mockTmuxSession);
    vi.mocked(terminalManager.createTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    await terminalCreateSession(mockProject, mockSession);

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[1].order).toBe(1);
  });

  it('should throw error if tmux creation fails', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };
    const mockTmuxSession = 'mc-openboldmeadow-a1b2';

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.generateTmuxSessionName).mockReturnValueOnce(mockTmuxSession);
    vi.mocked(terminalManager.createTmuxSession).mockRejectedValueOnce(
      new Error('tmux not found')
    );

    await expect(terminalCreateSession(mockProject, mockSession)).rejects.toThrow('tmux not found');

    // Should not write sessions if tmux fails
    expect(terminalManager.writeSessions).not.toHaveBeenCalled();
  });

  it('should validate inputs', async () => {
    await expect(terminalCreateSession('', mockSession)).rejects.toThrow();
    await expect(terminalCreateSession(mockProject, '')).rejects.toThrow();
  });
});

describe('terminalListSessions', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'open-bold-meadow';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list all terminal sessions sorted by order', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'mc-openboldmeadow-c3d4',
          created: new Date().toISOString(),
          order: 1,
        },
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    const result = await terminalListSessions(mockProject, mockSession);

    expect(result).toHaveProperty('sessions');
    expect(result.sessions).toHaveLength(2);
    // Should be sorted by order
    expect(result.sessions[0].order).toBe(0);
    expect(result.sessions[1].order).toBe(1);
  });

  it('should return empty array when no sessions exist', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    const result = await terminalListSessions(mockProject, mockSession);

    expect(result).toHaveProperty('sessions');
    expect(result.sessions).toHaveLength(0);
  });

  it('should validate inputs', async () => {
    await expect(terminalListSessions('', mockSession)).rejects.toThrow();
    await expect(terminalListSessions(mockProject, '')).rejects.toThrow();
  });
});

describe('terminalKillSession', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'open-bold-meadow';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should kill a terminal session', async () => {
    const sessionId = 'session-1';
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: sessionId,
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.killTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalKillSession(mockProject, mockSession, sessionId);

    expect(result).toEqual({ success: true });
    expect(terminalManager.killTmuxSession).toHaveBeenCalledWith('mc-openboldmeadow-a1b2');

    // Verify session was removed
    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions).toHaveLength(0);
  });

  it('should recompute order after killing session', async () => {
    const sessionIdToKill = 'session-1';
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: sessionIdToKill,
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'mc-openboldmeadow-c3d4',
          created: new Date().toISOString(),
          order: 1,
        },
        {
          id: 'session-3',
          name: 'Terminal 3',
          tmuxSession: 'mc-openboldmeadow-e5f6',
          created: new Date().toISOString(),
          order: 2,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.killTmuxSession).mockResolvedValueOnce(undefined);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    await terminalKillSession(mockProject, mockSession, sessionIdToKill);

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions).toHaveLength(2);
    expect(writtenState.sessions[0].order).toBe(0);
    expect(writtenState.sessions[1].order).toBe(1);
  });

  it('should throw error if session not found', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    await expect(terminalKillSession(mockProject, mockSession, 'nonexistent-id')).rejects.toThrow(
      'Session not found'
    );
  });

  it('should validate inputs', async () => {
    await expect(terminalKillSession('', mockSession, 'id')).rejects.toThrow();
    await expect(terminalKillSession(mockProject, '', 'id')).rejects.toThrow();
    await expect(terminalKillSession(mockProject, mockSession, '')).rejects.toThrow();
  });
});

describe('terminalRenameSession', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'open-bold-meadow';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should rename a terminal session', async () => {
    const sessionId = 'session-1';
    const newName = 'My Custom Terminal';
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: sessionId,
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalRenameSession(mockProject, mockSession, sessionId, newName);

    expect(result).toEqual({ success: true });

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[0].name).toBe(newName);
  });

  it('should trim whitespace from name', async () => {
    const sessionId = 'session-1';
    const newName = '  Trimmed Name  ';
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: sessionId,
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    await terminalRenameSession(mockProject, mockSession, sessionId, newName);

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[0].name).toBe('Trimmed Name');
  });

  it('should use "Terminal" as fallback for empty name', async () => {
    const sessionId = 'session-1';
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: sessionId,
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    await terminalRenameSession(mockProject, mockSession, sessionId, '   ');

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;
    expect(writtenState.sessions[0].name).toBe('Terminal');
  });

  it('should throw error if session not found', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    await expect(
      terminalRenameSession(mockProject, mockSession, 'nonexistent-id', 'New Name')
    ).rejects.toThrow('Session not found');
  });

  it('should validate inputs', async () => {
    await expect(terminalRenameSession('', mockSession, 'id', 'name')).rejects.toThrow();
    await expect(terminalRenameSession(mockProject, '', 'id', 'name')).rejects.toThrow();
    await expect(terminalRenameSession(mockProject, mockSession, '', 'name')).rejects.toThrow();
    await expect(terminalRenameSession(mockProject, mockSession, 'id', '')).rejects.toThrow();
  });
});

describe('terminalReorderSessions', () => {
  const mockProject = '/path/to/project';
  const mockSession = 'open-bold-meadow';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reorder terminal sessions', async () => {
    const session1 = {
      id: 'session-1',
      name: 'Terminal 1',
      tmuxSession: 'mc-openboldmeadow-a1b2',
      created: new Date().toISOString(),
      order: 0,
    };
    const session2 = {
      id: 'session-2',
      name: 'Terminal 2',
      tmuxSession: 'mc-openboldmeadow-c3d4',
      created: new Date().toISOString(),
      order: 1,
    };
    const session3 = {
      id: 'session-3',
      name: 'Terminal 3',
      tmuxSession: 'mc-openboldmeadow-e5f6',
      created: new Date().toISOString(),
      order: 2,
    };

    const mockState: TerminalSessionsState = {
      sessions: [session1, session2, session3],
      lastModified: new Date().toISOString(),
    };

    const newOrder = ['session-3', 'session-1', 'session-2'];

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);
    vi.mocked(terminalManager.writeSessions).mockResolvedValueOnce(undefined);

    const result = await terminalReorderSessions(mockProject, mockSession, newOrder);

    expect(result).toEqual({ success: true });

    const callArgs = vi.mocked(terminalManager.writeSessions).mock.calls[0];
    const writtenState = callArgs[2] as TerminalSessionsState;

    expect(writtenState.sessions[0].id).toBe('session-3');
    expect(writtenState.sessions[0].order).toBe(0);
    expect(writtenState.sessions[1].id).toBe('session-1');
    expect(writtenState.sessions[1].order).toBe(1);
    expect(writtenState.sessions[2].id).toBe('session-2');
    expect(writtenState.sessions[2].order).toBe(2);
  });

  it('should throw error if orderedIds has duplicate IDs', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    await expect(
      terminalReorderSessions(mockProject, mockSession, ['session-1', 'session-1'])
    ).rejects.toThrow();
  });

  it('should throw error if orderedIds is missing a session', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
        {
          id: 'session-2',
          name: 'Terminal 2',
          tmuxSession: 'mc-openboldmeadow-c3d4',
          created: new Date().toISOString(),
          order: 1,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    await expect(
      terminalReorderSessions(mockProject, mockSession, ['session-1'])
    ).rejects.toThrow();
  });

  it('should throw error if orderedIds has unknown ID', async () => {
    const mockState: TerminalSessionsState = {
      sessions: [
        {
          id: 'session-1',
          name: 'Terminal 1',
          tmuxSession: 'mc-openboldmeadow-a1b2',
          created: new Date().toISOString(),
          order: 0,
        },
      ],
      lastModified: new Date().toISOString(),
    };

    vi.mocked(terminalManager.readSessions).mockResolvedValueOnce(mockState);

    await expect(
      terminalReorderSessions(mockProject, mockSession, ['session-1', 'unknown-id'])
    ).rejects.toThrow();
  });

  it('should validate inputs', async () => {
    await expect(terminalReorderSessions('', mockSession, ['id1'])).rejects.toThrow();
    await expect(terminalReorderSessions(mockProject, '', ['id1'])).rejects.toThrow();
    await expect(terminalReorderSessions(mockProject, mockSession, [])).rejects.toThrow();
  });
});

describe('terminalToolSchemas', () => {
  it('should define terminal_create_session schema', () => {
    const schema = terminalToolSchemas.terminal_create_session;
    expect(schema.name).toBe('terminal_create_session');
    expect(schema.description).toBeDefined();
    expect(schema.inputSchema.type).toBe('object');
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
  });

  it('should define terminal_list_sessions schema', () => {
    const schema = terminalToolSchemas.terminal_list_sessions;
    expect(schema.name).toBe('terminal_list_sessions');
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
  });

  it('should define terminal_kill_session schema', () => {
    const schema = terminalToolSchemas.terminal_kill_session;
    expect(schema.name).toBe('terminal_kill_session');
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('id');
  });

  it('should define terminal_rename_session schema', () => {
    const schema = terminalToolSchemas.terminal_rename_session;
    expect(schema.name).toBe('terminal_rename_session');
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('id');
    expect(schema.inputSchema.required).toContain('name');
  });

  it('should define terminal_reorder_sessions schema', () => {
    const schema = terminalToolSchemas.terminal_reorder_sessions;
    expect(schema.name).toBe('terminal_reorder_sessions');
    expect(schema.inputSchema.required).toContain('project');
    expect(schema.inputSchema.required).toContain('session');
    expect(schema.inputSchema.required).toContain('orderedIds');
  });
});
