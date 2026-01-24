/**
 * Terminal session type definitions
 * Shared between backend and can be imported by frontend
 */

export interface TerminalSession {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name (e.g., "Terminal 1") */
  name: string;
  /** tmux session name (e.g., "mc-openboldmeadow-a1b2") */
  tmuxSession: string;
  /** ISO timestamp when created */
  created: string;
  /** Tab order for UI (0-indexed) */
  order: number;
}

export interface TerminalSessionsState {
  sessions: TerminalSession[];
  lastModified: string;
}

// MCP Tool Response Types

export interface CreateSessionResult {
  id: string;
  tmuxSession: string;
  wsUrl: string;
}

export interface ListSessionsResult {
  sessions: TerminalSession[];
}

export interface KillSessionResult {
  success: boolean;
}

export interface RenameSessionResult {
  success: boolean;
}

export interface ReorderSessionsResult {
  success: boolean;
}
