/**
 * Session Types - Core types for session management
 */

export interface Session {
  project: string;
  name: string;
  phase?: string;
  displayName?: string;
  lastActivity?: string;
  itemCount?: number;
}

export interface CollabState {
  phase: string;
  lastActivity: string;
  currentItem: number | null;
  pendingVerificationIssues?: VerificationIssue[];
  worktreePath?: string;
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}

export interface VerificationIssue {
  type: 'drift';
  phase: string;
  description: string;
  file: string;
  detectedAt: string;
}
