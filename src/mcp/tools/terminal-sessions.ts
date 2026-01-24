import { randomUUID } from 'crypto';
import { terminalManager } from '../../services/terminal-manager.js';
import type {
  CreateSessionResult,
  ListSessionsResult,
  KillSessionResult,
  RenameSessionResult,
  ReorderSessionsResult,
  TerminalSession,
} from '../../types/terminal.js';

/**
 * Create a new terminal session for a collab session
 */
export async function terminalCreateSession(
  project: string,
  session: string,
  name?: string
): Promise<CreateSessionResult> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }
  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }

  // Read current sessions
  const state = await terminalManager.readSessions(project, session);

  // Determine display name
  let displayName = name;
  if (!displayName || typeof displayName !== 'string') {
    displayName = `Terminal ${state.sessions.length + 1}`;
  }

  // Generate tmux session name
  const tmuxSession = terminalManager.generateTmuxSessionName(session);

  // Create tmux session
  await terminalManager.createTmuxSession(tmuxSession);

  // Create session record
  const id = randomUUID();
  const newSession: TerminalSession = {
    id,
    name: displayName,
    tmuxSession,
    created: new Date().toISOString(),
    order: state.sessions.length,
  };

  // Add to sessions array
  state.sessions.push(newSession);

  // Write updated sessions
  await terminalManager.writeSessions(project, session, state);

  // Return result
  return {
    id,
    tmuxSession,
    wsUrl: 'ws://localhost:7681/ws',
  };
}

/**
 * List all terminal sessions for a collab session
 */
export async function terminalListSessions(
  project: string,
  session: string
): Promise<ListSessionsResult> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }
  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }

  // Read sessions from storage
  const state = await terminalManager.readSessions(project, session);

  // Sort sessions by order field
  const sortedSessions = state.sessions.sort((a, b) => a.order - b.order);

  // Return result
  return {
    sessions: sortedSessions,
  };
}

/**
 * Kill a terminal session and its tmux process
 */
export async function terminalKillSession(
  project: string,
  session: string,
  id: string
): Promise<KillSessionResult> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }
  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }

  // Read current sessions
  const state = await terminalManager.readSessions(project, session);

  // Find session by id
  const sessionIndex = state.sessions.findIndex(s => s.id === id);
  if (sessionIndex === -1) {
    throw new Error('Session not found');
  }

  const sessionToKill = state.sessions[sessionIndex];

  // Kill tmux session
  await terminalManager.killTmuxSession(sessionToKill.tmuxSession);

  // Remove from sessions array
  state.sessions.splice(sessionIndex, 1);

  // Recompute order for remaining sessions
  for (let i = 0; i < state.sessions.length; i++) {
    state.sessions[i].order = i;
  }

  // Write updated sessions
  await terminalManager.writeSessions(project, session, state);

  // Return result
  return { success: true };
}

/**
 * Rename a terminal session
 */
export async function terminalRenameSession(
  project: string,
  session: string,
  id: string,
  name: string
): Promise<RenameSessionResult> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }
  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  if (typeof name !== 'string') {
    throw new Error('name must be a string');
  }

  // Read current sessions
  const state = await terminalManager.readSessions(project, session);

  // Find session by id
  const sessionToRename = state.sessions.find(s => s.id === id);
  if (!sessionToRename) {
    throw new Error('Session not found');
  }

  // Update name field
  let trimmedName = name.trim();
  if (!trimmedName) {
    trimmedName = 'Terminal';
  }
  sessionToRename.name = trimmedName;

  // Write updated sessions
  await terminalManager.writeSessions(project, session, state);

  // Return result
  return { success: true };
}

/**
 * Reorder terminal sessions
 */
export async function terminalReorderSessions(
  project: string,
  session: string,
  orderedIds: string[]
): Promise<ReorderSessionsResult> {
  // Validate inputs
  if (!project || typeof project !== 'string') {
    throw new Error('project must be a non-empty string');
  }
  if (!session || typeof session !== 'string') {
    throw new Error('session must be a non-empty string');
  }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('orderedIds must be a non-empty array');
  }

  // Read current sessions
  const state = await terminalManager.readSessions(project, session);

  // Validate orderedIds
  // Must contain all session IDs (no missing, no extras)
  const sessionIds = new Set(state.sessions.map(s => s.id));
  const orderedIdSet = new Set(orderedIds);

  // Check for duplicates
  if (orderedIds.length !== orderedIdSet.size) {
    throw new Error('orderedIds contains duplicate IDs');
  }

  // Check for missing sessions
  for (const id of sessionIds) {
    if (!orderedIdSet.has(id)) {
      throw new Error('orderedIds is missing a session ID');
    }
  }

  // Check for unknown IDs
  for (const id of orderedIds) {
    if (!sessionIds.has(id)) {
      throw new Error('orderedIds contains unknown session ID');
    }
  }

  // Reorder sessions array and update order fields
  const newSessions: TerminalSession[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const foundSession = state.sessions.find(s => s.id === id);
    if (foundSession) {
      foundSession.order = i;
      newSessions.push(foundSession);
    }
  }

  state.sessions = newSessions;

  // Write updated sessions
  await terminalManager.writeSessions(project, session, state);

  // Return result
  return { success: true };
}

// Tool schemas for MCP registration
export const terminalToolSchemas = {
  terminal_create_session: {
    name: 'terminal_create_session',
    description: 'Create a new terminal session for a collab session',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path to project' },
        session: { type: 'string', description: 'Collab session name' },
        name: { type: 'string', description: 'Optional display name' },
      },
      required: ['project', 'session'],
    },
  },
  terminal_list_sessions: {
    name: 'terminal_list_sessions',
    description: 'List terminal sessions for a collab session',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path to project' },
        session: { type: 'string', description: 'Collab session name' },
      },
      required: ['project', 'session'],
    },
  },
  terminal_kill_session: {
    name: 'terminal_kill_session',
    description: 'Kill a terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path to project' },
        session: { type: 'string', description: 'Collab session name' },
        id: { type: 'string', description: 'Terminal session ID' },
      },
      required: ['project', 'session', 'id'],
    },
  },
  terminal_rename_session: {
    name: 'terminal_rename_session',
    description: 'Rename a terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path to project' },
        session: { type: 'string', description: 'Collab session name' },
        id: { type: 'string', description: 'Terminal session ID' },
        name: { type: 'string', description: 'New display name' },
      },
      required: ['project', 'session', 'id', 'name'],
    },
  },
  terminal_reorder_sessions: {
    name: 'terminal_reorder_sessions',
    description: 'Reorder terminal sessions',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Absolute path to project' },
        session: { type: 'string', description: 'Collab session name' },
        orderedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Session IDs in new order',
        },
      },
      required: ['project', 'session', 'orderedIds'],
    },
  },
};
