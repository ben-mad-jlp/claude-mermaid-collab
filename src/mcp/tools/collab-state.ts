/**
 * Collab State Management Tools
 *
 * Provides MCP tools for managing collab session state and context snapshots.
 * Skills use these tools instead of direct file I/O.
 */

import { readFile, writeFile, mkdir, unlink, access } from 'fs/promises';
import { join } from 'path';
import type { WebSocketHandler } from '../../websocket/handler.js';
import type { TaskBatch, WorkItem, WorkItemType } from '../workflow/types.js';

// ============= Type Definitions =============

export interface CollabState {
  state?: string; // Current state machine state ID
  phase: string;
  lastActivity: string;
  currentItem: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  hasSnapshot: boolean;
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}

export interface ContextSnapshot {
  version: number;
  timestamp: string;
  activeSkill: string;
  currentStep: string;
  pendingQuestion: string | null;
  inProgressItem: number | null;
  recentContext: Array<{ type: string; content: string }>;
}

export interface StateUpdateParams {
  state?: string; // Current state machine state ID
  phase?: string;
  currentItem?: number | null;
  currentItemType?: WorkItemType; // Type of current item for routing
  hasSnapshot?: boolean;
  workItems?: WorkItem[]; // Work items for the session
  batches?: TaskBatch[]; // Execution batches
  currentBatch?: number; // Index of current batch
  completedTasks?: string[];
  pendingTasks?: string[];
  totalItems?: number;
  documentedItems?: number;
}

// ============= Helper Functions =============

function getStatePath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'collab-state.json');
}

function getSnapshotPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'context-snapshot.json');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ============= State Management Functions =============

export async function getSessionState(project: string, session: string): Promise<CollabState> {
  const path = getStatePath(project, session);

  if (!(await fileExists(path))) {
    throw new Error(`Session not found: ${session}`);
  }

  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as CollabState;
}

export async function updateSessionState(
  project: string,
  session: string,
  updates: StateUpdateParams,
  wsHandler?: WebSocketHandler
): Promise<{ success: boolean }> {
  const path = getStatePath(project, session);

  // Read current state or create empty
  let currentState: Partial<CollabState> = {};
  if (await fileExists(path)) {
    const content = await readFile(path, 'utf-8');
    currentState = JSON.parse(content);
  }

  // Merge updates
  const newState: CollabState = {
    phase: updates.phase ?? currentState.phase ?? 'brainstorming',
    lastActivity: new Date().toISOString(),
    currentItem: updates.currentItem !== undefined ? updates.currentItem : (currentState.currentItem ?? null),
    hasSnapshot: updates.hasSnapshot ?? currentState.hasSnapshot ?? false,
    // New state machine fields
    ...(updates.state && { state: updates.state }),
    ...(currentState.state && !updates.state && { state: currentState.state }),
    // Work items
    ...(updates.workItems && { workItems: updates.workItems }),
    ...(currentState.workItems && !updates.workItems && { workItems: currentState.workItems }),
    ...(updates.currentItemType && { currentItemType: updates.currentItemType }),
    ...(currentState.currentItemType && !updates.currentItemType && { currentItemType: currentState.currentItemType }),
    // Batches
    ...(updates.batches && { batches: updates.batches }),
    ...(currentState.batches && !updates.batches && { batches: currentState.batches }),
    ...(updates.currentBatch !== undefined && { currentBatch: updates.currentBatch }),
    ...(currentState.currentBatch !== undefined && updates.currentBatch === undefined && { currentBatch: currentState.currentBatch }),
    // Existing fields
    ...(updates.completedTasks && { completedTasks: updates.completedTasks }),
    ...(updates.pendingTasks && { pendingTasks: updates.pendingTasks }),
    ...(currentState.completedTasks && !updates.completedTasks && { completedTasks: currentState.completedTasks }),
    ...(currentState.pendingTasks && !updates.pendingTasks && { pendingTasks: currentState.pendingTasks }),
    ...(updates.totalItems !== undefined && { totalItems: updates.totalItems }),
    ...(updates.documentedItems !== undefined && { documentedItems: updates.documentedItems }),
    ...(currentState.totalItems !== undefined && updates.totalItems === undefined && { totalItems: currentState.totalItems }),
    ...(currentState.documentedItems !== undefined && updates.documentedItems === undefined && { documentedItems: currentState.documentedItems }),
  };

  // Ensure directory exists
  const dir = join(project, '.collab', 'sessions', session);
  await mkdir(dir, { recursive: true });

  await writeFile(path, JSON.stringify(newState, null, 2));

  // Broadcast session state update via WebSocket if handler is provided
  if (wsHandler) {
    try {
      wsHandler.broadcast({
        type: 'session_state_updated',
        phase: newState.phase,
        lastActivity: newState.lastActivity,
        currentItem: newState.currentItem,
        hasSnapshot: newState.hasSnapshot,
        ...(newState.state && { state: newState.state }),
        ...(newState.workItems && { workItems: newState.workItems }),
        ...(newState.currentItemType && { currentItemType: newState.currentItemType }),
        ...(newState.batches && { batches: newState.batches }),
        ...(newState.currentBatch !== undefined && { currentBatch: newState.currentBatch }),
        ...(newState.completedTasks && { completedTasks: newState.completedTasks }),
        ...(newState.pendingTasks && { pendingTasks: newState.pendingTasks }),
        ...(newState.totalItems !== undefined && { totalItems: newState.totalItems }),
        ...(newState.documentedItems !== undefined && { documentedItems: newState.documentedItems }),
      });
    } catch (error) {
      console.error('Failed to broadcast session state update:', error);
    }
  }

  return { success: true };
}

// ============= Snapshot Management Functions =============

export async function hasSnapshot(project: string, session: string): Promise<boolean> {
  const path = getSnapshotPath(project, session);
  return fileExists(path);
}

export async function saveSnapshot(
  project: string,
  session: string,
  activeSkill: string,
  currentStep: string,
  inProgressItem: number | null,
  pendingQuestion?: string | null,
  recentContext?: Array<{ type: string; content: string }>
): Promise<{ success: boolean }> {
  const path = getSnapshotPath(project, session);

  const snapshot: ContextSnapshot = {
    version: 1,
    timestamp: new Date().toISOString(),
    activeSkill,
    currentStep,
    pendingQuestion: pendingQuestion ?? null,
    inProgressItem,
    recentContext: recentContext ?? [],
  };

  // Ensure directory exists
  const dir = join(project, '.collab', 'sessions', session);
  await mkdir(dir, { recursive: true });

  await writeFile(path, JSON.stringify(snapshot, null, 2));

  // Also update hasSnapshot in state
  await updateSessionState(project, session, { hasSnapshot: true });

  return { success: true };
}

export async function loadSnapshot(project: string, session: string): Promise<ContextSnapshot | null> {
  const path = getSnapshotPath(project, session);

  if (!(await fileExists(path))) {
    return null;
  }

  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as ContextSnapshot;
}

export async function deleteSnapshot(project: string, session: string): Promise<{ success: boolean }> {
  const path = getSnapshotPath(project, session);

  try {
    await unlink(path);
  } catch (error: any) {
    // Idempotent - ignore if file doesn't exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Also update hasSnapshot in state
  try {
    await updateSessionState(project, session, { hasSnapshot: false });
  } catch {
    // State file might not exist, that's ok
  }

  return { success: true };
}
