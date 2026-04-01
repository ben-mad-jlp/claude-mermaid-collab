/**
 * Session Types - Core types for session management
 */

export interface Session {
  project: string;
  name: string;
  displayName?: string;
  lastActivity?: string;
  itemCount?: number;
}

export interface CollabState {
  displayName?: string;
  state?: string;
  lastActivity: string;
  pendingVerificationIssues?: VerificationIssue[];
  worktreePath?: string;
  batches?: Array<{ id: string; tasks: Array<{ id: string; status: string; dependsOn: string[] }>; status: string }>;
  completedTasks?: string[];
  pendingTasks?: string[];
}

export interface VerificationIssue {
  type: 'drift';
  phase: string;
  description: string;
  file: string;
  detectedAt: string;
}

export interface BatchTask {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependsOn: string[];
}

export interface TaskBatch {
  id: string;
  tasks: BatchTask[];
  status: 'pending' | 'in_progress' | 'completed';
}
