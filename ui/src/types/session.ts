/**
 * Session Types - Core types for session management
 */

export interface Session {
  project: string;
  name: string;
  phase?: string;
  lastActivity?: string;
  itemCount?: number;
}

export interface CollabState {
  phase: string;
  lastActivity: string;
  currentItem: number | null;
  pendingVerificationIssues?: VerificationIssue[];
  worktreePath?: string;
}

export interface VerificationIssue {
  type: 'drift';
  phase: string;
  description: string;
  file: string;
  detectedAt: string;
}
